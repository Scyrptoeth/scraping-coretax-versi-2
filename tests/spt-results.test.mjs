import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPackageEntry} from '../extension/app-package-entries.js';
import {recoverSptResult,remainingSptChecks,resultAssignment,readPreviousSptPackage} from '../extension/app-spt-results.js';
import {planSptDetails} from '../extension/app-spt-plan.js';
import {stageSptSource,finishSptSources} from '../extension/app-spt-snapshots.js';
import {createPackage} from '../extension/archive/package.js';
import {readZip,writeZip} from '../extension/archive/zip.js';

const wp='0000000000000017',type='VAT_VATR',period='2025-01 s.d. 2025-12';
const range={from:{y:2025,m:1},to:{y:2025,m:12}};
const opts={periode:range,jenisSpt:[type],sumber:['sptdaftar','sptisi']};
const row={ReturnSheetTypeCode:type,TaxPeriodCode:'01012025',ReturnSheetModel:'normal',RecordId:'fiktif',DocumentReceiptNumber:'000BPE'};
const listed=(r=row)=>({source:'sptdaftar',wp,period,page:{Payload:{Data:[r]}},rows:1,total:null,name:'Daftar',origin:'Tabel tampak',
  proof:{indexScope:'Daftar SPT lintas masa',ownerEvidence:'Panel WP pada SPT Dilaporkan'}});
function fixture(){
  const list=listed(),group=new Map(),doc=planSptDetails({wp,period:range,items:[list]}).documents[0];
  const source={wp,source:'sptisi',spt:type,period,name:'Induk',origin:'Tabel tampak',rows:1,total:null,
    detailProof:{docKey:doc.key,recordId:'fiktif',receipt:'000BPE',part:'induk',label:'Induk',revision:0,period:'2025-01'},
    proof:{columns:['Uraian'],urutan:{id:'urutan',halaman:1},awalTampilan:true,akhirTampilan:true},
    page:{Payload:{Data:[{Uraian:'Isi fiktif'}]}}};
  appendPackageEntry(group,list,wp);const entry=appendPackageEntry(group,source,wp);
  const record={kind:'result',id:'hasil-fiktif',meta:{wp:{npwp:wp},dibuat:'2026-11-19T00:12:00.000Z',periode:period,opsi:opts,
    penugasan:{peran:'AR',jenis:'RUTIN',nomor:'SP-81',tanggal:'2026-11-01'},penarik:{nama:'Penguji',nip:'00001'}},entries:[...group.values()]};
  const scope={...resultAssignment(record.meta),types:type};
  return {list,record,scope,entry,source,doc};
}
const recover=(f,active=[f.list],live=[f.list])=>recoverSptResult(f.record,f.scope,opts,active,live);
test('document and BpsNo remain independent across active, live and archived rows with the same record and revision',()=>{
  const f=fixture(),both={...row,DocumentReceiptNumber:'00012',BpsNo:'BPE/00034'},full=listed(both);
  f.list=full;f.record.entries[0].pages=[full.page];f.entry.cap.konteks.spt.nomor='BPE/00034';
  assert.equal(recover(f).pages.length,1);
  assert.equal(planSptDetails({wp,period:range,items:[full,...recover(f).pages]}).counts.readyParts,1);
  const labelled={...row,'Nomor Bukti Penerimaan':'BPE/00034'};delete labelled.DocumentReceiptNumber;
  assert.equal(recover(f,[listed(labelled)],[listed(labelled)]).pages.length,1);
  for(const change of [{BpsNo:'BPE/00035'},{DocumentReceiptNumber:'12'},{DocumentReceiptNumber:'BPE/00034',BpsNo:'00012'},
    {RecordId:'lain'},{RecordId:''},{ReturnSheetModel:'amendment 1'},{TaxPeriodCode:'02022025'}]){
    assert.equal(recover(f,[full],[listed({...both,...change})]).pages.length,0);
  }
  assert.equal(recover(f,[full],[full,listed({...both,BpsNo:'BPE/00035'})]).pages.length,0);
  assert.equal(recover(f,[full],[full,listed({...both,'Nomor BPE':'TIDAK-COCOK'})]).pages.length,0);
  assert.equal(recover(f,[listed(labelled)],[listed({...labelled,RecordId:''})]).pages.length,0);
  f.entry.cap.konteks.spt.nomor='00012';assert.equal(recover(f).pages.length,1);
  f.entry.cap.konteks.spt.recordId='';assert.equal(recover(f).pages.length,0);
});
test('previous pages need matching assignment and current, live and stored directories for the same version',()=>{
  const f=fixture(),original=structuredClone(f.record);
  const restored=recover(f);assert.equal(restored.pages.length,1);assert.deepEqual(f.record,original);
  assert.deepEqual(restored.pages[0].proof.hasilSebelumnya,{waktu:original.meta.dibuat,berkas:f.entry.path,halaman:1});
  for(const field of ['wp','officer','nip','period','letter','role','basis','date']){
    assert.equal(recover({...f,scope:{...f.scope,[field]:'berbeda'}}).pages.length,0,field);
  }
  assert.equal(recover(f,[{...f.list,proof:{}}]).pages.length,0);
  for(const change of [{RecordId:'kedua'},{DocumentReceiptNumber:'000BPE2'},{TaxPeriodCode:'02022025'},{ReturnSheetModel:'amendment 1'},
    {'Nomor BPE':'LAIN'},{ReturnSheetTypeCode:'ICT_WITR'}]){
    assert.equal(recover(f,[f.list],[listed({...row,...change})]).pages.length,0);
  }
  assert.equal(recover(f,[f.list],[f.list,listed({...row,DocumentReceiptNumber:'KONFLIK'})]).pages.length,0);
  f.record.entries=f.record.entries.filter(e=>e.cap.sumber!=='sptdaftar');assert.equal(recover(f).pages.length,0);
});
test('partial, filtered and verified zero keep their own evidence; mismatched rows, counts, paths and missing comparisons are excluded',()=>{
  for(const mutate of [e=>{e.pages[0].Payload.Data[0].NPWP='0000000000000028';},e=>{e.pages[0].Payload.Data[0]['ID SPT']='salah';},
    e=>{e.cap.baris++;},e=>{e.cap.halamanSumber[0].baris++;},e=>{e.cap.konteks.spt.pemb=1;},e=>{e.cap.konteks.spt.nomor='lain';},
    e=>{e.pages[0].IsSuccessful=false;},e=>{e.path='profil/rekening-bank.json';},e=>{e.cap.cuplikanSpt={utama:e.path,pembanding:['hilang']};}]){
    const f=fixture();mutate(f.entry);assert.equal(recover(f).pages.length,0);
  }
  for(const [alter,status] of [[p=>{delete p.akhirTampilan;},'pending'],[p=>{p.filterTampilan=true;},'pending'],[()=>{},'ready']]){
    const f=fixture();alter(f.entry.cap.halamanSumber[0].pencocokan);
    const {pages}=recover(f);assert.equal(pages.length,1);
    assert.equal(planSptDetails({wp,period:range,items:[f.list,...pages]}).documents[0].parts[0].status,status);
  }
  const f=fixture();f.entry.pages[0].Payload={Data:[],TotalRecords:0};f.entry.cap.baris=f.entry.cap.halamanSumber[0].baris=0;
  assert.equal(recover(f).pages.length,0);f.entry.cap.halamanSumber[0].pencocokan.nolPadaSumber=true;
  assert.equal(recover(f).pages[0].rows,0);
});
test('structured observations preserve failures without rows and the new audit names only previously known, still unresolved parts',()=>{
  const f=fixture(),note={docKey:f.doc.key,failed:true,cap:{konteks:{...f.entry.cap.konteks,bagian:'a2'}}};
  f.record.entries[0].cap.bagianSptTeramati=[note,{...note,docKey:'dokumen-lain'}];
  note.extra='unused';const restored=recover(f);assert.equal(restored.observed.length,1);
  assert.equal(restored.observed[0].cap.konteks.bagian,'a2');assert.equal(restored.observed[0].extra,undefined);
  const items=[{...f.list,sptResultId:'contoh',sptObservedParts:restored.observed},...restored.pages];
  const [check]=remainingSptChecks(items,wp,opts);assert.match(check.pesan,/a2/);assert.doesNotMatch(check.pesan,/induk/);
  assert.deepEqual(remainingSptChecks(items,wp,{...opts,sumber:['sptdaftar']}),[]);
});
test('a shorter or disagreeing new capture preserves the previous verified whole section and its competing evidence',()=>{
  const f=fixture(),[prior]=recover(f).pages,group=new Map(),out=new Map(),checks=[];
  const newPage={...f.source,name:'Cuplikan berikutnya',page:{Payload:{Data:[{Uraian:'Berbeda'}]}},
    proof:{columns:['Uraian'],urutan:{id:'baru',halaman:1},morePagesAvailable:true}};
  stageSptSource(group,prior,wp);stageSptSource(group,newPage,wp);finishSptSources(group,out,checks,true);
  assert.equal(out.get(f.entry.path).pages[0].Payload.Data[0].Uraian,'Isi fiktif');
  const compare=out.get(out.get(f.entry.path).cap.cuplikanSpt.pembanding[0]);assert.equal(compare.pages[0].Payload.Data[0].Uraian,'Berbeda');
  const index=f.record.entries[0];f.record.entries=[index,...out.values()];
  assert.deepEqual(recover(f).pages.map(p=>p.page.Payload.Data[0].Uraian),['Isi fiktif','Berbeda']);
  const actual=recover(f).pages;f.record.entries[1].cap.baris++;
  assert.equal(actual.length,2);assert.equal(recover(f).pages.length,0);
});
test('file import checks CRC, manifest and response hashes, one assignment and one owner; encrypted archives can be read after unlocking',async()=>{
  const f=fixture();
  const input=await createPackage({...f.record,password:'sandi-paket-fiktif'});
  await assert.rejects(readPreviousSptPackage(input,'',f.scope),e=>e.code==='PASSWORD_REQUIRED');
  await assert.rejects(readPreviousSptPackage(input,'berbeda',f.scope),e=>e.code==='DECRYPT_FAILED');
  const recovered=await readPreviousSptPackage(input,'sandi-paket-fiktif',f.scope);assert.match(recovered.manifestHash,/^[a-f0-9]{64}$/);
  assert.equal(recover({...f,record:recovered}).pages[0].proof.hasilSebelumnya.shaManifest,recovered.manifestHash);
  await assert.rejects(readPreviousSptPackage(input,'sandi-paket-fiktif',{...f.scope,nip:'lain'}),/penugasan/);
  const members=await readZip(await createPackage(f.record));
  members.delete('BERITA-ACARA.txt');const corrupt=await writeZip([...members].map(([name,{data}])=>({name,data})));
  await assert.rejects(readPreviousSptPackage(corrupt,'',f.scope),/integritas/);
  f.entry.cap.shaRespons=['0'.repeat(64)];
  const mismatched=await createPackage(f.record);await assert.rejects(readPreviousSptPackage(mismatched,'',f.scope),/Sidik jari respons/);
  delete f.entry.cap.shaRespons;f.entry.cap.konteks.npwp='0000000000000064';
  const mixed=await createPackage(f.record);await assert.rejects(readPreviousSptPackage(mixed,'',f.scope),/WP dalam paket/);
});
