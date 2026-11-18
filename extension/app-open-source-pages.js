// Each peer is a visible copy of the same source. Capture only their common, verified pages.
export async function collectOpenPages({peers,existing,anchors=[],read,save,check,limit}){
  const initial=peers.map(item=>item.result),head=initial[0],total=head.range.total;
  const uncertain='Rentang, filter, atau isi salinan tabel berbeda. Periksa kembali sumber.';
  const interrupted='Halaman berikutnya belum dapat dibuktikan. Halaman yang sudah cocok tetap tersimpan.';
  const saved=existing.map(e=>e.proof.pratinjauSumber);
  const firstMissing=initial.some(p=>!p.atStart&&!p.canFirst);
  if(initial.some(p=>!p.range||p.range.total!==total||p.filterHash!==head.filterHash)||!peers.every(p=>JSON.stringify(p.table.labels)===JSON.stringify(peers[0].table.labels)))return uncertain;
  if(firstMissing && saved.length)return 'Halaman pertama diperlukan untuk mencocokkan kembali tarikan yang tersimpan.';
  let states=initial;
  const seenRows=new Set(),matchedInitial=new Set(),matchedAnchors=new Set(),initialRows=new Map();
  const rowKey=r=>JSON.stringify(Object.keys(r).sort().map(k=>[k,r[k]]));
  async function move(index,kind){
    const previous=states[index],peer=peers[index];
    const click=await read(peer,previous.stamp,false,{afterMove:true,move:kind});
    if(!click.moved)return {skip:click.skip||interrupted};
    const until=Date.now()+5000;
    while(Date.now()<until){
      await check();
      const next=await read(peer,null,false,{afterMove:true});
      if(next.skip && !next.loading)return next;
      if(!next.skip && next.stamp!==previous.stamp && next.pageHash!==previous.pageHash)return next;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {skip:'Tampilan belum berubah setelah tombol halaman dipilih. '+interrupted};
  }
  async function navigate(kind){
    const next=[];
    for(const [i,state] of states.entries()){
      const p=kind==='first' && state.atStart?state:await move(i,kind);
      if(p.skip)return p.skip;
      next.push(p);
    }
    states=next;
    return '';
  }
  if(!firstMissing){
    for(const [i,state] of initial.entries()){
      if(state.atStart)continue;
      const pinned=await read(peers[i],state.stamp,true,{});
      if(pinned.skip||!pinned.slices?.every(s=>Array.isArray(s.rows)))return pinned.skip||uncertain;
      for(const s of pinned.slices)for(const row of s.rows){
        const key=rowKey(row);
        if(initialRows.has(key)&&initialRows.get(key)!==state.range.first)return uncertain;
        initialRows.set(key,state.range.first);
      }
    }
    const problem=await navigate('first');if(problem)return problem;
  }
  let first=firstMissing?head.range.first:1,series;
  for(let number=1;number<=limit;number++){
    const reference=states[0],range=reference.range;
    if(!range || range.first!==first || range.total!==total || range.last<first || range.last>total)return uncertain;
    for(const [i,state] of states.entries()){
      if(state.filterHash!==head.filterHash || state.pageHash!==reference.pageHash || JSON.stringify(state.range)!==JSON.stringify(range))return uncertain;
      if(range.first===initial[i].range.first){
        if(state.stamp!==initial[i].stamp)return 'Tampilan awal berubah setelah kembali ke halaman pertama.';
        matchedInitial.add(i);
      }
      const anchor=anchors[i];
      if(anchor&&range.first===anchor.range.first){
        if(state.stamp!==anchor.stamp)return 'Halaman yang telah dipratinjau berubah. Cocokkan kembali sumber.';
        matchedAnchors.add(i);
      }
    }
    if(!series){
      // The first page binds saved progress to the source, filters, schema and reported total.
      const value=JSON.stringify([peers[0].source,peers[0].table.labels,reference.pageHash,head.filterHash,total]);
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
      series=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(saved.some(v=>v.paginasi.sidikRangkaian!==series || !v.paginasi.awal&&v.paginasi.halaman===1))return 'Halaman pertama atau filter berbeda dari tarikan yang tersimpan.';
    }
    // Read actual rows only after checking all comparable peers. Verify their stamps again before accepting.
    const current=await read(peers[0],reference.stamp,true,{afterMove:true});
    if(current.skip || !current.slices?.every(s=>Array.isArray(s.rows)&&s.rows.length===s.count))return current.skip||interrupted;
    const copies=[current];
    for(let i=1;i<peers.length;i++){
      const copy=await read(peers[i],states[i].stamp,false,{afterMove:true});
      if(copy.skip || copy.pageHash!==current.pageHash)return copy.skip||uncertain;
      copies.push(copy);
    }
    const rows=current.slices.flatMap(s=>s.rows),keys=rows.map(rowKey);
    if(rows.length!==range.last-range.first+1)return uncertain;
    if(keys.some(k=>seenRows.has(k)||initialRows.has(k)&&initialRows.get(k)!==range.first))return 'Baris yang sama muncul lagi pada halaman berbeda. Halaman tersebut belum ditambahkan.';
    keys.forEach(k=>seenRows.add(k));
    const end=range.last===total && copies.every(p=>p.atEnd&&!p.canAdvance);
    if(end && !firstMissing && (matchedInitial.size!==peers.length||matchedAnchors.size!==anchors.length))return uncertain;
    const proof={versi:1,halaman:number,awal:number===1&&range.first===1,akhir:end,rentang:range,
      sidikFilter:current.filterHash,sidikHalaman:current.pageHash,sidikRangkaian:series};
    const stored=saved.filter(v=>v.paginasi.halaman===number);
    if(stored.some(v=>v.paginasi.sidikHalaman!==proof.sidikHalaman || JSON.stringify(v.paginasi.rentang)!==JSON.stringify(range) ||
      !current.slices.some(s=>s.month===v.masa && s.hash===v.sidikIsi)))return 'Isi halaman berbeda dari hasil yang tersimpan. Periksa ulang sumber.';
    for(const slice of current.slices){
      if(stored.some(v=>v.masa===slice.month))continue;
      await check();
      await save(peers[0],slice,current,proof);
    }
    if(firstMissing)return 'Tombol halaman pertama tidak tersedia. Hanya halaman yang terlihat dapat dicocokkan.';
    if(end)return '';
    if(range.last===total||copies.some(p=>!p.canAdvance))return interrupted;
    if(number===limit)return 'Batas '+limit+' halaman tercapai. Halaman berikutnya belum dibaca.';
    first=range.last+1;
    const problem=await navigate('next');if(problem)return problem;
  }
}
