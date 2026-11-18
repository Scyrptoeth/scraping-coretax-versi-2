import test from 'node:test';
import assert from 'node:assert/strict';
import {stageSptSource,finishSptSources} from '../extension/app-spt-snapshots.js';

const wp='0000000000000001',canonical='spt/PPN/2025-01/p00_DEMO/a1.json';
const row=(value,extra={})=>({'ID SPT':'DEMO','Masa Pajak':'2025-01',Pembetulan:0,'Bagian SPT':'A1',Nilai:value,...extra});
function input(id,rows,extra={}) {
  const page=extra.page || {Payload:{Data:rows}};
  return {wp,id,name:id+'.json',spt:'VAT_VATR',source:'sptisi',origin:'Ekspor lokal',total:page.Payload.TotalRecords??null,
    rows:rows.length,page,...extra};
}
function pack(items,dedupe=true) {
  const sections=new Map(),groups=new Map(),checks=[];
  for(const item of items)assert.equal(stageSptSource(sections,item,wp),true);
  finishSptSources(sections,groups,checks,dedupe);
  return {groups,checks,primary:groups.get(canonical)};
}
test('a matching total can select a containing export; a reported total never certifies an entire SPT',()=>{
  const a=row(12),b=row(13);
  const explicit=rows=>input('native',rows,{page:{IsSuccessful:true,Payload:{Data:rows,TotalRecords:rows.length}}});
  const selected=pack([input('partial',[a]),explicit([a,b])]);
  assert.equal(selected.primary.cap.asal,'native.json');assert.equal(selected.primary.cap.lengkap,false);
  assert.match(selected.primary.cap.cuplikanSpt.alasan,/mencakup seluruh baris/);
  const conflict=pack([input('ambiguous',[a,a]),explicit([a,b])]);
  assert.equal(conflict.primary.cap.asal,'ambiguous.json');
  assert.match(conflict.primary.cap.cuplikanSpt.alasan,/belum sejalan/);
  const merelyLarger=pack([input('old',[a]),input('large',[a,b])]);
  assert.equal(merelyLarger.primary.cap.asal,'old.json');
  const later=explicit([a,b]);later.page.Payload.Index=1;
  assert.equal(pack([input('old',[a]),later]).primary.cap.asal,'old.json');
});
test('only one verified paginator pass appends pages; independent or interrupted passes are evidence files',()=>{
  const page=(run,number,values,legacy=false)=>input(run+'-'+number,values.map(v=>row(v)),{origin:'Tabel tampak',
    name:'Daftar faktur · halaman pengambilan '+number,proof:{columns:['Nilai'],owner:['NPWP'],period:['Masa Pajak'],
      ...(legacy?{}:{urutan:{id:run,halaman:number}})}});
  for(const legacy of [false,true]) {
    const {primary,groups}=pack([page('one',1,[1],legacy),page('one',2,[2],legacy),page('two',1,[1],legacy),page('two',2,[3],legacy)]);
    assert.equal(groups.size,2);assert.equal(primary.pages.length,2);assert.equal(primary.cap.baris,2);
    const [alternate]=primary.cap.cuplikanSpt.pembanding;
    assert.deepEqual(groups.get(alternate).pages.flatMap(p=>p.Payload.Data.map(r=>r.Nilai)),[1,3]);
  }
  assert.equal(pack([page('one',1,[1]),page('one',3,[2])]).groups.size,2);
});
test('identical rows retain source provenance and different revisions remain separate',()=>{
  const a=row(12),b=row(15,{Pembetulan:1});
  const {groups,primary,checks}=pack([input('one',[a]),input('copy',[a]),input('amended',[b])]);
  assert.equal(groups.size,2);assert.equal(checks.length,0);assert.deepEqual(primary.cap.sumberSalinanIdentik.map(x=>x.asal),['copy.json']);
  assert.equal(groups.get('spt/PPN/2025-01/p01_DEMO/a1.json').pages.length,1);
});
