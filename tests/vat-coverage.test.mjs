import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage} from '../extension/analisis/model.js';
import {vatCoverage} from '../extension/analisis/vat-coverage.js';

const id='0000000000000017';
function form(period='2025-02',version=0,recordId='spt-a'){
  const [y,m]=period.split('-'),key='spt/PPN/'+period+'/p'+String(version).padStart(2,'0')+'_'+recordId,parts=new Map();
  for(const part of ['induk','a1','a2','b1','b2','b3','c','c-total']){
    const payload=part==='induk'?{FormData:'{"VATUnderOrOverPaid":{"VAT":0}}'}:part==='c-total'?{}:
      part==='a2'?{TotalRecords:1,Data:[{DocumentNumber:'FIKTIF',VAT:0}]}:{TotalRecords:0,Data:[]};
    parts.set(part,{path:key+'/'+part+'.json',cap:{sumber:'sptisi',lengkap:true,halaman:1,konteks:{npwp:id,bagian:part,jenisBagian:part==='induk'?'induk':part==='c-total'?'footer':'grid',
      spt:{npwp:id,jenis:'VAT_VATR',tahun:Number(y),masa:m+m+y,pemb:version,recordId}}},pages:[{IsSuccessful:true,Payload:payload}]});
  }
  return {type:'PPN',id:recordId,key,period,version,parts};
}
const pkg=()=>({manifest:{wp:{npwp:id},gagal:[]},report:{valid:true}});
const row=(coverage,label)=>coverage.rows.find(r=>r.Bagian===label);
test('single-version VAT coverage checks eight distinct sources, including empty footer evidence',()=>{
  const f=form(),p=pkg(),c=vatCoverage(f,p);
  assert.equal(c.received,8);assert.equal(c.verified,8);
  assert.equal(row(c,'A2').Status,'Lengkap');assert.equal(row(c,'B1')['Baris tersimpan'],0);
  const footer=row(c,'Total C');
  assert.equal(footer.Status,'Kosong terverifikasi');assert.equal(footer['Total menurut sumber'],null);
  assert.match(footer.Keterangan,/tanpa isian/);
  f.parts.delete('b2');const seven=vatCoverage(f,p);
  assert.equal(seven.received,7);assert.equal(seven.verified,7);assert.equal(row(seven,'B2').Status,'Belum ada');
  assert.equal(row(seven,'B2')['Baris tersimpan'],null);
  p.manifest.gagal.push({path:'data/'+f.key+'/b2.json'});
  assert.equal(row(vatCoverage(f,p),'B2').Status,'Gagal');
  assert.equal(vatCoverage({...f,type:'PPN-PEMUNGUT'},p),null);
});
test('a positive total with zero records, incomplete or failed pages and a missing C stay distinguishable',()=>{
  const f=form(),p=pkg(),c=f.parts.get('c'),a2=f.parts.get('a2'),induk=f.parts.get('induk');
  c.pages[0].Payload.TotalRecords=1;
  a2.cap.lengkap=false;induk.pages[0].IsSuccessful=false;
  const result=vatCoverage(f,p);
  assert.equal(result.received,8);assert.equal(result.verified,4);
  assert.equal(row(result,'C').Status,'Cuplikan');assert.equal(row(result,'C')['Baris tersimpan'],0);
  assert.equal(row(result,'C')['Total menurut sumber'],1);assert.equal(row(result,'Total C').Status,'Cuplikan');
  assert.equal(row(result,'A2').Status,'Cuplikan');assert.equal(row(result,'Induk').Status,'Gagal');
  f.parts.delete('c');assert.equal(row(vatCoverage(f,p),'Total C').Status,'Cuplikan');
  induk.pages=[{IsSuccessful:true,Payload:{FormData:'{"RecordId":"spt-a"}'}}];
  assert.equal(row(vatCoverage(f,p),'Induk').Status,'Cuplikan');
});
test('footer has four numeric fields or a verified empty response; zero is a reported number only when supplied',()=>{
  const f=form(),p=pkg(),foot=f.parts.get('c-total').pages[0];
  foot.Payload={VAT:0};assert.equal(row(vatCoverage(f,p),'Total C').Status,'Cuplikan');
  foot.Payload={TaxBase:0,OtherTaxBase:0,VAT:0,STLG:0};assert.equal(row(vatCoverage(f,p),'Total C').Status,'Lengkap');
  foot.Payload.VAT=9;assert.equal(row(vatCoverage(f,p),'Total C').Status,'Cuplikan');
  f.parts.get('c').pages[0].Payload={TotalRecords:1,Data:[{DocumentNumber:'FIKTIF-C'}]};assert.equal(row(vatCoverage(f,p),'Total C').Status,'Lengkap');
});
test('owner, type, identifier, period, year and revision must match the selected return',()=>{
  for(const change of [
    e=>e.cap.konteks.spt.npwp='0000000000000022',e=>e.cap.konteks.spt.jenis='VAT_VATTRNTEVATC',
    e=>e.cap.konteks.spt.masa='03032025',e=>e.cap.konteks.spt.tahun=2024,e=>e.cap.konteks.spt.pemb=1,
    e=>e.cap.konteks.spt.recordId='spt-b',e=>e.cap.konteks.bagian='b3',e=>e.cap.payload={RecordId:'spt-b'},
    e=>e.cap.payload={Filters:[{Field:'TIN'}]},e=>e.cap.konteks.spt={},e=>e.path='spt/PPN/2024-02/p00_spt-a/a2.json',
    e=>e.cap.konteks.jenisBagian='footer',e=>delete e.pages[0].IsSuccessful,e=>delete e.cap.halaman
  ]){
    const f=form();change(f.parts.get('a2'));
    assert.equal(row(vatCoverage(f,pkg()),'A2').Status,'Cuplikan');
  }
  const base=form(),later=form('2026-02',1,'spt-b'),p=pkg();
  p.manifest.gagal.push({path:later.key+'/a1.json'});
  assert.equal(row(vatCoverage(base,p),'A1').Status,'Kosong terverifikasi');
  assert.equal(row(vatCoverage(later,p),'A1').Status,'Cuplikan');
});
test('two official fictitious packages contain 72 versions and 72 successful but unpopulated C footers',async t=>{
  const folder=process.env.VERITAX_FIXTURES;if(!folder)return t.skip('Local fictitious archives are optional');
  let versions=0;
  for(const file of (await readdir(folder)).filter(n=>/^CONTOH.*FIKTIF.*\.zip$/.test(n))){
    const p=indexPackage(await readPackage(await readFile(join(folder,file))));
    for(const f of p.forms.filter(x=>x.type==='PPN')){
      const r=vatCoverage(f,p);assert.equal(r.received,8);assert.equal(r.verified,8);
      assert.equal(row(r,'C').Status,'Kosong terverifikasi');
      assert.equal(row(r,'Total C').Status,'Kosong terverifikasi');
      assert.equal(row(r,'Total C')['Total menurut sumber'],null);versions++;
    }
  }
  assert.equal(versions,72);
});
