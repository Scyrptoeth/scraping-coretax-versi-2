import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage} from '../extension/analisis/model.js';
import {buildIndex,assessLine,completeIndexBook,indexStatus} from '../extension/analisis/kkp-index.js';

const id='0000000000000017',year='2025',aggregate='contoh-op';
const record=(number,base,tax,extra={})=>({EmployeeTin:id,WitholderTin:'0000000000000018',FiscalYear:year,TaxPeriodCode:'04042025',
  WithholdingSlipsNumber:number,TaxObjectCode:'21-100-07',WithholdingSlipsStatus:'NORMAL',TaxArticle:'Pasal 21',TaxBase:base,IncomeTax:tax,...extra});
const table=(path,sumber,rows,context,query)=>({path,cap:{sumber,lengkap:true,konteks:context,payload:{Filters:[],First:0,...query},total:rows.length},
  pages:[{IsSuccessful:true,Payload:{Data:rows,TotalRecords:rows.length}}]});
function fixture(){
  const lists=table('spt/daftar.json','sptdaftar',[],{npwp:id},{TaxpayerAggregateIdentifier:aggregate,isArchieved:false});
  const profile={path:'profil/informasi-umum.json',cap:{sumber:'info'},pages:[{Payload:{GeneralInformation:{TaxpayerType:'TA001',UniqueIdentificationNumber:id,AggregateIdentifier:aggregate}}}]};
  const groups={BP21:[record('umum',100,10),record('umum',120,12,{WithholdingSlipsStatus:'AMENDMENT'}),
    record('umum',120,12,{WithholdingSlipsStatus:'AMENDMENT'}),record('batal',500,50,{WithholdingSlipsStatus:'CANCELLED'})],
    BPA1:[record('gaji',600,60,{TaxObjectCode:'21-100-01'})],BPA2:[],BPPU:[record('final',300,30,{TaxObjectCode:'28-403-02',IncomeTaxStatus:'FINAL',TaxArticle:'Pasal 4 Ayat 2'})],
    BPCY:[],BPSP:[record('setor-sendiri',900,90,{IncomeTaxStatus:'TIDAK FINAL'})],
    NPMP:[record('rincian-gaji',600,60)],BP26:[record('asing',300,30)]};
  const slips=Object.entries(groups).map(([jenis,rows])=>table('bukti-potong-lawan/'+year+'/'+jenis+'.json','bplawan',rows,{npwp:id,tahun:2025,jenis},
    {IncomeRecipientTin:id,TaxYear:'2025-01-01',WithholdingSlipsType:jenis}));
  return indexPackage({manifest:{wp:{npwp:id},opsi:{periode:{from:{y:2025,m:1},to:{y:2025,m:12}},jenisSpt:['ICT_PITR']},gagal:[]},
    report:{valid:true,manifestHash:'contoh'},entries:[profile,lists,...slips]});
}
const find=(index,ref)=>index.groups.find(g=>g.ref===ref)?.lines[0];
const source=(pkg,kind)=>pkg.entries.find(e=>e.path.endsWith('/'+kind+'.json'));

test('OP without an annual return keeps third-party amounts separate until reviewed',()=>{
  const pkg=fixture(),idx=buildIndex(pkg,year),b8=find(idx,'B-8'),b17=find(idx,'B-17');
  assert.deepEqual(idx.groups.map(g=>g.ref),['B-8','B-17']);
  assert.equal(b8.prefill,120);assert.equal(b17.prefill,72);assert.equal(b17.details.length,2);
  assert.equal(b8.amount,0);assert.match(b8.id,new RegExp(id+'/'+year));
  assert.equal(indexStatus(idx.groups[0],new Map()).tested,0);
  const book=completeIndexBook(pkg,year,idx,new Map(),{});
  assert.equal(book.find(s=>s.name==='Temuan Sementara').rows.length,1);
  assert.equal(book.find(s=>s.name==='INDUK').rows.length,1);
  const r=book.find(s=>s.name.startsWith('B-8 ')).rows[6];
  assert.equal(r[3],0);assert.equal(r[4],null);assert.equal(r[5].cached,null);assert.equal(r[11],120);
  assert.match(r[12],/neto perlu diuji/);
  assert.throws(()=>assessLine(b8,{value:0,document:'K1',officer:'Penguji'}),/penjelasan/);
  const assessed=assessLine(b8,{value:0,document:'K1',officer:'Penguji',note:'DPP telah ditelaah.'});
  assert.match(assessed.simpulan,/pembanding nol/);assert.equal(assessed.principal,null);
});
test('a partial, filtered, wrong-owner or ambiguous annual list never establishes absence',()=>{
  for(const mutate of [
    p=>p.report.valid=false,p=>p.manifest.opsi.periode.from.m=2,p=>p.manifest.opsi.jenisSpt=['VAT_VATR'],
    p=>source(p,'daftar').cap.lengkap=false,p=>source(p,'daftar').pages[0].Payload.TotalRecords=1,
    p=>source(p,'daftar').cap.payload.Filters.push('terbatas'),p=>source(p,'daftar').cap.konteks.npwp='0000000000000018',
    p=>p.manifest.gagal.push({path:'spt/daftar.json'}),p=>source(p,'informasi-umum').pages[0].Payload.GeneralInformation.TaxpayerType='TA002',
    p=>{const e=source(p,'daftar');e.pages[0].Payload.Data=[{RecordId:'file',ReturnSheetTypeCode:'ICT_PITR',TaxPeriodCode:'01122025'}];e.cap.total=e.pages[0].Payload.TotalRecords=1;},
    p=>{const e=source(p,'daftar');e.pages[0].Payload.Data=[{RecordId:'file',ReturnSheetTypeCode:'ICT_PITR'}];e.cap.total=e.pages[0].Payload.TotalRecords=1;}
  ]){const p=fixture();mutate(p);assert.equal(buildIndex(p,year).groups.length,0);}
});
test('coverage, identity, revisions, status and missing amounts qualify each proposed comparison',()=>{
  for(const mutate of [
    p=>source(p,'BP21').cap.lengkap=false,p=>source(p,'BP21').pages[0].IsSuccessful=false,
    p=>source(p,'BP21').pages[0].Payload.Data[1].IncomeRecipientTin='0000000000000088',
    p=>source(p,'BP21').pages[0].Payload.Data[1].TaxPeriodCode='04042024',
    p=>source(p,'BP21').pages[0].Payload.Data[2].IncomeTax=18,
    p=>source(p,'BP21').pages[0].Payload.Data[1].WithholdingSlipsNumber='',
    p=>source(p,'BP21').pages[0].Payload.Data[3].WithholdingSlipsStatus='UNKNOWN',
    p=>p.manifest.gagal.push({path:'bukti-potong-lawan/2025/BP21.json'})
  ]){const p=fixture();mutate(p);const idx=buildIndex(p,year);assert.ok(idx.warnings.length);assert.equal(find(idx,'B-17')?.prefill,null);}
  const p=fixture();source(p,'BPA1').pages[0].Payload.Data[0].IncomeTax=null;
  assert.equal(find(buildIndex(p,year),'B-8').prefill,120);assert.equal(find(buildIndex(p,year),'B-17').prefill,null);
  source(p,'BPA1').pages[0].Payload.Data[0].IncomeTax=0;
  assert.equal(find(buildIndex(p,year),'B-17').prefill,12);
});
test('both official fictitious OP examples reproduce unsupported-return Studio comparisons',async t=>{
  const dir=new URL('../01-VERITAX_v1.32.0/',import.meta.url);
  let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')return t.skip('Paired fictitious examples are local');throw e;}
  const cases=[['FIKTIF-OP-PEKERJAAN-BEBAS.zip','2025',1020000000,81300000,25],['FIKTIF-OP.zip','2023',undefined,7000000,1]];
  for(const [suffix,y,dpp,withheld,n] of cases){
    const filename=files.find(f=>f.endsWith(suffix));assert.ok(filename);
    const pkg=indexPackage(await readPackage(await readFile(new URL(filename,dir)))),idx=buildIndex(pkg,y);
    assert.equal(find(idx,'B-8')?.prefill,dpp);assert.equal(find(idx,'B-17').prefill,withheld);assert.equal(find(idx,'B-17').details.length,n);
  }
});
