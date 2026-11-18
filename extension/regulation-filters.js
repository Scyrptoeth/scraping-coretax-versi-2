const types=[
  ['UU','Undang-Undang'],['PP','Peraturan Pemerintah'],['PMK','Peraturan Menteri Keuangan'],['KMK','Keputusan Menteri Keuangan'],
  ['PER','Peraturan Dirjen Pajak'],['SE','Surat Edaran Dirjen Pajak'],['KEP','Keputusan Dirjen Pajak'],['ND','Nota Dinas Direktur Jenderal Pajak'],['SDSN','SDSN']
];
const collator=new Intl.Collator('id',{numeric:true,sensitivity:'base'});
const clean=value=>String(value??'').trim().toLowerCase();
const compact=value=>clean(value).replace(/\b(tahun|nomor)\b/g,'').replace(/[^a-z0-9]/g,'');
export const regulationColumns=['Nomor','Judul','Jenis','Tanggal peraturan','Status pada sumber','Isi pokok','Topik','Peraturan terkait','Naskah resmi'];
export const emptyFilters={keyword:'',number:'',type:'',status:'',start:'',end:'',sort:'newest'};

export function prepareRegulations(base,focus) {
  const index=new Map();
  for(const input of base.concat(focus.map(item=>item.cells))){
    const [number,title,type,date,status,url]=input;
    const key=type+'|'+compact(number);
    const record=focus.find(f=>f.cells[2]===type&&compact(f.cells[0])===compact(number))||{};
    const typeIndex=types.findIndex(([,name])=>clean(name)===clean(type));
    const short=types[typeIndex]?.[0]||type;
    const category=/sudah dicabut|^dicabut$|tidak aktif|berakhir|diganti/i.test(status)?'ended':/dicabut sebagian|diubah/i.test(status)?'changed':/^(aktif|berlaku)$/i.test(status)?'active':'other';
    const aliases=[number,short+' '+number];
    const seq=number.match(/^(?:[a-z]+-)?([0-9]+)(?:\s+TAHUN\s+|(?:\/[^/]+)*\/)(\d{4})$/i);
    if(seq)aliases.push(seq[1]+'/'+seq[2],short+' '+seq[1]+'/'+seq[2]);
    const related=record.related||[];
    index.set(key,{number,title,type,short,typeIndex:typeIndex<0?types.length:typeIndex,date,status,url,category,
      summary:record.summary||'',topics:record.topics||[],related,numberKeys:aliases.map(compact),
      search:clean([number,title,type,short,record.summary,...(record.topics||[]),...related.map(r=>r.label)].join(' '))});
  }
  return [...index.values()];
}
export function regulationTypes(records) {
  const groups=new Map(types.map(([short,name])=>[name,{short,name,count:0}]));
  for(const {type:name,short} of records) {
    if(!groups.has(name))groups.set(name,{short,name,count:0});
    groups.get(name).count++;
  }
  return [...groups.values()].map(({name,short,count})=>[name,(name===short?short:short+' · '+name)+' ('+count+')']);
}
export function filterRegulations(records,filters) {
  const f={...emptyFilters,...filters},terms=clean(f.keyword).split(/\s+/).filter(Boolean),number=compact(f.number);
  const rows=records.filter(row=>(!f.type||row.type===f.type)&&(!f.status||row.category===f.status)&&(!f.start||row.date>=f.start)&&(!f.end||row.date<=f.end)
    &&terms.every(t=>row.search.includes(t))&&(!number||row.numberKeys.some(k=>k.includes(number))));
  const byNumber=(a,b)=>collator.compare(a.number,b.number);
  return rows.sort((a,b)=>f.sort==='oldest'?a.date.localeCompare(b.date)||byNumber(a,b):
    (f.sort==='type'?a.typeIndex-b.typeIndex||collator.compare(a.type,b.type):0)||b.date.localeCompare(a.date)||byNumber(a,b));
}
export const regulationCells=r=>[r.number,r.title,r.type,r.date,r.status,r.summary,r.topics.join(' · '),r.related.map(x=>x.label+' '+x.url).join('\n'),r.url];
