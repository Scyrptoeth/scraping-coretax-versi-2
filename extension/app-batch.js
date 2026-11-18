import {sources, forms, rowsInColumnOrder, visibleTables} from './app-data.js';

const names = {
  info:['profil utama','informasi umum','general information'],
  pihak:['pihak terkait','related persons'], bank:['rekening bank','bank accounts'],
  alamat:['alamat','addresses'], klu:['klu','klasifikasi lapangan usaha'],
  flag:['penanda wp'], jenispajak:['jenis pajak','tax types'], pbb:['objek pbb'],
  nomorlain:['nomor identitas lain'], sertel:['sertifikat elektronik'], login:['login terakhir'],
  dokumen:['dokumen wp'], sptdaftar:['spt dilaporkan','submitted returns'],
  sptbelum:['spt belum dilaporkan'], sptarsip:['spt diarsipkan'],
  bb:['buku besar','general ledger'], bplawan:['bukti potong lawan transaksi']
};
const temporal = new Set(['sptdaftar','sptbelum','sptarsip','sptisi','bb','bbtotal','bplawan']);
const cleanLabel = value => value.toLowerCase().replace(/\s+/g,' ').trim();

export function suggestedSource(title, permitted) {
  const candidates=permitted.filter(s=>[sources[s],...(names[s] || [])].some(v=>cleanLabel(v)===cleanLabel(title)));
  return candidates.length===1 ? candidates[0] : '';
}

export function batchCollector({ext, origin, context, isBusy, enqueue, refresh, log}) {
  const $ = id => document.getElementById(id);
  const rowsBox=$('batch-rows'), status=$('batch-status');
  const targets=[];
  let active=false, scanning=false, paused=false, stopped=false;
  function buttons() {
    $('batch-scan').disabled=!ext || active;
    $('batch-add').disabled=active || !targets.length;
    $('batch-pause').hidden=!active || scanning;$('batch-stop').hidden=!active;
    $('batch-pause').textContent=paused?'Lanjutkan pembacaan':'Jeda';
  }
  async function inspect() {
    if(!ext || active || isBusy()) return;
    const scope=context();
    active=true;scanning=true;buttons();targets.length=0;rowsBox.replaceChildren();
    status.textContent='Mencari tabel di tab Coretax yang terbuka…';
    let missed=0;
    try {
      const tabs=await ext.tabs.query({url:origin+'/*'});
      for(const [index,tab] of tabs.entries()) {
        if(stopped) break;
        if(!tab.url || new URL(tab.url).origin!==origin) continue;
        let frame;
        try { [frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[null]}); }
        catch {missed++; continue;}
        for(const table of frame?.result || []) {
          if(!table.rows) continue;
          const line=document.createElement('div');line.className='batch-row';
          const label=document.createElement('strong');label.textContent='Tab '+(index+1)+' · '+table.title+' · '+table.rows+' baris';
          const category=document.createElement('select');category.setAttribute('aria-label','Sumber '+label.textContent);
          category.add(new Option('Lewati tabel ini',''));
          for(const id of scope.allowed) category.add(new Option(sources[id],id));
          category.value=scope.allowed.includes(table.indexSource)?table.indexSource:suggestedSource(table.title,scope.allowed);
          const type=document.createElement('select');type.setAttribute('aria-label','Jenis SPT '+label.textContent);
          type.add(new Option('Pilih jenis SPT',''));
          for(const [id,caption] of forms.filter(([id])=>scope.types.includes(id))) type.add(new Option(caption,id));
          const undated=document.createElement('input'), periodChoice=document.createElement('label');
          undated.type='checkbox';periodChoice.className='check';periodChoice.append(undated,document.createTextNode('Sumber tidak mencantumkan masa pajak.'));
          const update=()=>{type.hidden=category.value!=='sptisi';periodChoice.hidden=category.value!=='tabelumum';undated.checked=false;};
          category.onchange=update;update();
          const state=document.createElement('small');
          line.append(label,category,type,periodChoice,state);rowsBox.append(line);
          targets.push({tabId:tab.id,url:tab.url,table,category,type,undated,state});
        }
      }
      status.textContent=targets.length+' tabel berisi data ditemukan. Pilih sumber untuk tabel yang ingin dibaca.'+(missed?' '+missed+' tab tidak dapat diperiksa.':'');
    } finally {active=false;scanning=false;stopped=false;paused=false;buttons();}
  }
  async function collect() {
    if(active || isBusy()) return;
    const pageLimit=Number($('batch-page-limit').value);
    if(!Number.isInteger(pageLimit) || pageLimit<1 || pageLimit>100) throw Error('Pilih batas antara 1 dan 100 halaman per tabel.');
    const chosen=context(), selected=targets.filter(t=>t.category.value && !t.category.disabled);
    if(!selected.length) throw Error('Pilih sumber untuk sedikitnya satu tabel.');
    const plan=selected.map(t=>({target:t,source:t.category.value,spt:t.type.hidden?'':t.type.value,
      undated:t.category.value==='tabelumum' && t.undated.checked}));
    if(plan.some(item=>!chosen.allowed.includes(item.source) ||
      (item.source==='sptisi' && !chosen.types.includes(item.spt)) ||
      (item.source.startsWith('spt') && !chosen.types.length))) throw Error('Periksa pilihan sumber dan jenis SPT pada setiap tabel.');
    active=true;paused=false;stopped=false;buttons();let added=0, skipped=0;
    $('batch-page-limit').disabled=true;
    for(const t of targets){t.category.disabled=true;t.type.disabled=true;t.undated.disabled=true;}
    try {
      for(const {target:t,source,spt,undated} of plan) {
        while(paused && !stopped) await new Promise(resolve=>setTimeout(resolve,100));
        if(stopped) break;
        if(JSON.stringify(context())!==JSON.stringify(chosen)) throw Error('Cakupan penugasan berubah. Pindai ulang tab sebelum melanjutkan.');
        try {
          const tab=await ext.tabs.get(t.tabId);
          if(tab.url!==t.url || new URL(tab.url).origin!==origin) throw Error('Alamat tab berubah. Pindai ulang tabel.');
          const selector={...t.table,url:t.url,scope:{source,wp:chosen.wp,from:chosen.from,to:chosen.to,periodRequired:temporal.has(source)}};
          let options=selector, result, more=false;
          const pages=[], seen=new Set();
          while(pages.length<pageLimit) {
            while(paused && !stopped) await new Promise(resolve=>setTimeout(resolve,100));
            if(stopped) break;
            if(JSON.stringify(context())!==JSON.stringify(chosen)) throw Error('Cakupan penugasan berubah. Pindai ulang tab.');
            const [frame]=await ext.scripting.executeScript({target:{tabId:t.tabId},func:visibleTables,args:[options]});
            if(frame?.result?.end) {more=false;break;}
            result=frame?.result;
            if(!result || result.skip || !Array.isArray(result.rows)) throw Error(result?.skip || 'Tabel belum dapat dibaca.');
            const rows=rowsInColumnOrder(result.rows,t.table.labels), serialized=JSON.stringify(rows);
            if(seen.has(serialized)) throw Error('Halaman berulang. Periksa posisi tabel dan pindai ulang.');
            seen.add(serialized);pages.push(rows);more=result.canAdvance;
            t.state.textContent=pages.length+' halaman terbaca.';
            if(!more) break;
            options={...selector,advance:true,rows:result.rows.length,owner:chosen.wp,expected:serialized};
          }
          if(stopped) break;
          if(JSON.stringify(context())!==JSON.stringify(chosen)) throw Error('Cakupan penugasan berubah. Pindai ulang tab.');
          const data=pages.flat();
          const proof={columns:t.table.labels,owner:result?.ownerColumns || [],period:result?.periodColumns || [],
            ...(result?.indexScope?{indexScope:result.indexScope,ownerEvidence:result.ownerEvidence}:{}),
            pageRows:pages.map(page=>page.length),morePagesAvailable:Boolean(more)};
          const info={wp:chosen.wp,period:undated?null:chosen.period,source,spt,proof};
          enqueue(info,{Payload:{Data:data}},t.table.title,'Tabel tampak');
          t.added=true;t.state.textContent='Masuk antrean · '+pages.length+' halaman · '+data.length+' baris'+(more?' · masih ada halaman berikutnya':'');added++;refresh();
        } catch(error) {skipped++;t.state.textContent=error.message;log(t.table.title+' · '+error.message,true);}
        status.textContent=added+' masuk antrean, '+skipped+' dilewati.';
      }
    } finally {
      active=false;paused=false;
      $('batch-page-limit').disabled=false;
      for(const t of targets){ t.category.disabled=Boolean(t.added);t.type.disabled=Boolean(t.added);t.undated.disabled=Boolean(t.added); }
      status.textContent=(stopped?'Pembacaan dihentikan. ':'')+added+' tabel masuk antrean, '+skipped+' dilewati. Lihat rincian tiap tabel.';
      stopped=false;buttons();
    }
  }
  $('batch-scan').onclick=()=>inspect().catch(e=>{status.textContent=e.message;});
  $('batch-add').onclick=()=>collect().catch(e=>{status.textContent=e.message;});
  $('batch-pause').onclick=()=>{paused=!paused;buttons();};
  $('batch-stop').onclick=()=>{stopped=true;paused=false;};
  buttons();
  return {get active(){return active;}};
}
