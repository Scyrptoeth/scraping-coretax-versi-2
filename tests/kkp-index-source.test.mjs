import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {indexPackage} from '../extension/analisis/model.js';
import {assessLine,buildIndex,completeIndexBook,restoreIndexedRows} from '../extension/analisis/kkp-index.js';
import {readPackage} from '../extension/archive/package.js';

const wp='0000000000000017';
function entry(type,part,payload,{period='2025-01',version=0,id='demo-'+version,cap={},ok=true}={}){
  const grid=part==='d1-bpu',meta={lengkap:true,halaman:1,konteks:{npwp:wp,bagian:part,spt:{npwp:wp,recordId:id,
    jenis:type==='PPN'?'VAT_VATR':'ICT_WTR',masa:period,pemb:version,tahun:2025}}};
  if(grid){meta.total=payload.Data.length;meta.baris=payload.Data.length;}
  return {path:'spt/'+type+'/'+period+'/p'+String(version).padStart(2,'0')+'_'+id+'/'+part+'.json',
    cap:{...meta,...cap},pages:[{IsSuccessful:ok,Payload:payload}]};
}
function base(dpp){return {DomesticDeliveriesUsingOtherValue:{SellingPrice:dpp,OtherTaxBase:999,VAT:3},
  DeliveryOfTaxableGoodsSubjectToVAT:{SellingPrice:dpp+20},ExportTangibleTaxableGoods:{SellingPrice:20}};}
function slip(article,n){return {TaxArticle:article,TaxBase:n};}
function grid(rows,opts){return entry('UNIFIKASI','d1-bpu',{Data:rows,TotalRecords:rows.length},opts);}
function vat(body,opts){return entry('PPN','induk',{FormData:JSON.stringify(body)},opts);}
function pack(entries){return indexPackage({manifest:{wp:{npwp:wp}},entries,report:{valid:true}});}
function lines(index,ref){return index.groups.find(g=>g.ref===ref)?.lines||[];}

test('zero self-collected sales stay zero when a different VAT delivery group accounts for all sales',()=>{
  const row={DeliveryOfTaxableGoodsSubjectToVAT:{SellingPrice:150},DomesticDeliveriesUncollectedVAT:{SellingPrice:150},
    TotalDeliveryOfGoodsAndServices:{SellingPrice:150},ExportTangibleTaxableGoods:{SellingPrice:0}};
  for(const field of ['DomesticDeliveriesOtherThanOtherValue','DomesticDeliveriesUsingOtherValue','DomesticDeliveriesToTourist','DomesticDeliveriesSelfCollected'])row[field]={SellingPrice:0};
  const pkg=pack([vat(row)]);
  const index=buildIndex(pkg,'2025'),[own]=lines(index,'N.3');
  assert.equal(own.amount,0);assert.equal(own.partial,false);
  assert.ok(!own.source.includes('DomesticDeliveriesUncollectedVAT'));
  const detail=index.groups.find(g=>g.ref==='N.3').support;
  assert.equal(detail.length,1);assert.equal(detail[0].Nilai,150);assert.equal(detail[0].Masa,'2025-01');
  assert.match(detail[0].Sumber,/induk\.json.*DeliveryOfTaxableGoodsSubjectToVAT\.SellingPrice.*ExportTangibleTaxableGoods\.SellingPrice/);
  const sheet=completeIndexBook(pkg,'2025',index,new Map(),{}).find(s=>s.name.startsWith('N.3 '));
  assert.ok(sheet.rows.some(cells=>cells.includes(detail[0].Uraian)&&cells.includes(150)));
  for(const incomplete of [vat({...row,ExportTangibleTaxableGoods:{SellingPrice:null}}),vat(row,{cap:{lengkap:false}})]){
    const group=buildIndex(pack([incomplete]),'2025').groups.find(g=>g.ref==='N.3');
    assert.equal(group.support?.length||0,0);
  }
});

test('N.3 reads the latest self-collected base, distinct from VAT or OtherTaxBase, with source fields and amendment lineage',()=>{
  const direct=Object.fromEntries(['DomesticDeliveriesOtherThanOtherValue','DomesticDeliveriesUsingOtherValue','DomesticDeliveriesToTourist','DomesticDeliveriesSelfCollected'].map((k,i)=>[k,{SellingPrice:i+1,VAT:999}]));
  const p=pack([vat(base(13)),vat(base(30),{version:1}),vat(direct,{period:'2025-02'}),vat(base(0),{period:'2025-03'})]);
  const index=buildIndex(p,'2025'),list=lines(index,'N.3');
  assert.deepEqual(list.map(l=>[l.period,l.amount,l.version]).sort(),[['2025-01',30,1],['2025-02',10,0],['2025-03',0,0]]);
  const jan=list.find(l=>l.period==='2025-01');assert.match(jan.source,/p01_demo-1\/induk.json/);assert.match(jan.source,/SellingPrice/);
  assert.equal(lines(index,'N.3.1')[0].amount,null);
});
test('G.2.1 and K.2.1 sum D1-BPU by article, preserve genuine zero, cover only reported months and use latest grid',()=>{
  const p=pack([grid([slip('Pasal 23',300)]),grid([slip('Article 23',0),slip('Pasal 4 Ayat (2)',50),slip('Pasal 23',20)],{version:1}),
    grid([slip('Pasal 22',8)],{period:'2025-02'}),grid([],{period:'2025-03'}),
    entry('UNIFIKASI','induk',{FormData:'{}'},{period:'2025-05'}),grid([],{period:'2025-06',id:'a'}),grid([],{period:'2025-06',id:'b'})]);
  const i=buildIndex(p,'2025');
  for(const [ref,n] of [['G.2.1',20],['K.2.1',50]]){
    const rows=lines(i,ref);assert.deepEqual(rows.map(l=>[l.period,l.amount]).sort(),[['2025-01',n],['2025-02',0],['2025-03',0],['2025-05',null]]);
    const jan=rows.find(l=>l.period==='2025-01');assert.equal(jan.version,1);assert.match(jan.source,/p01_demo-1\/d1-bpu.json/);
    assert.match(jan.source,/TaxBase/);assert.match(jan.source,/baris/i);
    assert.equal(rows.find(l=>l.period==='2025-05').partial,true);assert.equal(rows.find(l=>l.period==='2025-03').partial,false);
  }
});
test('incomplete evidence, filtered pages, mismatched owners/versions, unreadable article and missing amounts never certify a zero',()=>{
  for(const mutate of [
    e=>e.cap.lengkap=false,e=>e.pages[0].IsSuccessful=false,e=>e.pages[0].Errors=['gagal'],e=>e.cap.total=8,
    e=>e.cap.payload={First:5},e=>e.cap.payload={Filters:[{}]},e=>e.cap.konteks.npwp='0000000000000098',e=>e.cap.konteks.spt.pemb=9,
    e=>e.cap.halamanSumber=[{pencocokan:{morePagesAvailable:true}}],e=>{e.cap.total=null;e.cap.payload={First:0,Rows:1};},
    e=>e.pages[0].Payload.Data[0].TaxArticle='Keterangan belum terbaca',
    e=>{e.pages.push(structuredClone(e.pages[0]));e.cap.halaman=2;e.cap.total=2;e.cap.baris=2;e.pages.forEach(p=>p.Payload.TotalRecords=2);}
  ]){
    const e=grid([slip('Pasal 23',12)]);mutate(e);const i=buildIndex(pack([e]),'2025');
    for(const ref of ['G.2.1','K.2.1']){const l=lines(i,ref)[0];assert.equal(l.amount,null);assert.equal(l.partial,true);}
  }
  const i=buildIndex(pack([grid([slip('Pasal 23',null),slip('Pasal 4 Ayat 2',0)])]),'2025');
  assert.equal(lines(i,'G.2.1')[0].amount,null);assert.equal(lines(i,'K.2.1')[0].amount,0);
  for(const e of [vat(base(99),{cap:{lengkap:false}}),vat({DomesticDeliveriesUsingOtherValue:{OtherTaxBase:45}}),
    vat({DeliveryOfTaxableGoodsSubjectToVAT:{SellingPrice:1000},ExportTangibleTaxableGoods:{SellingPrice:300}}),
    vat({...base(900),DeliveryOfTaxableGoodsSubjectToVAT:{SellingPrice:1000}})]){
    const l=lines(buildIndex(pack([e]),'2025'),'N.3')[0];assert.equal(l.amount,null);assert.equal(l.partial,true);
  }
});
test('document state, numeric strings, repeated IDs and partially overlapping pages are checked before summing',()=>{
  const doc=(id,n,status='',extra={})=>({...slip('Pasal 23',n),WithholdingSlipsNumber:id,WithholdingSlipsStatus:status,...extra});
  const input=[doc('01',90,'CANCELLED'),doc('02',8,'NORMAL',{IsCancelled:true}),doc('03',90,'DRAFT'),doc('04',75,'AMENDED'),
    doc('04','12.5','REPLACEMENT'),doc('05','7.5','REPORTED')];
  const first=lines(buildIndex(pack([grid(input)]),'2025'),'G.2.1')[0];
  assert.equal(first.amount,20);assert.match(first.source,/baris 5–6/);
  for(const rows of [[doc('A',40,'NORMAL'),doc('A',40,'APPROVED')],[doc('A',0,'CANCELLED'),doc('A',70,'NORMAL')],[doc('A',80,'unknown')]]){
    assert.equal(lines(buildIndex(pack([grid(rows)]),'2025'),'G.2.1')[0].amount,null);
  }
  for(const hasId of [true,false]){
    const maker=(k,n)=>hasId?doc(k,n):slip('Pasal 23',n);
    const e=grid([maker('X',11),maker('Y',12)]);
    e.cap.halaman=2;e.cap.total=4;e.cap.baris=4;e.pages[0].Payload.TotalRecords=4;
    e.pages.push({IsSuccessful:true,Payload:{TotalRecords:4,Data:[maker('Y',12),maker('Z',34)]}});
    const line=lines(buildIndex(pack([e]),'2025'),'G.2.1')[0];assert.equal(line.amount,null);assert.equal(line.partial,true);
  }
});
test('old reviewed row IDs survive new indexes, distinct source IDs round-trip, and unreviewed rows export with empty officer amounts',()=>{
  const p=pack([vat({...base(900),OutputTaxMustBeSelfCollected:{VAT:12}}),grid([slip('Pasal 23',9)])]),index=buildIndex(p,'2025');
  const original=lines(index,'N.3.1')[0],vatLine=lines(index,'N.3')[0],uniLine=lines(index,'G.2.1')[0];
  assert.match(original.id,/induk\.json#OutputTaxMustBeSelfCollected\.VAT$/);
  const reviewed=[original,vatLine,uniLine].map(l=>assessLine(l,{value:l.amount,document:'Bukti contoh',officer:'Contoh'}));
  assert.deepEqual(restoreIndexedRows(reviewed,JSON.parse(JSON.stringify(reviewed)),index),reviewed);
  assert.equal(index.byId.get(uniLine.id),uniLine);assert.equal(index.groups.flatMap(g=>g.lines).length,index.byId.size);
  const sheets=completeIndexBook(p,'2025',index,new Map(),{});for(const ref of ['N.3 ','G.2.1 ','K.2.1 ']){
    const rows=sheets.find(s=>s.name.startsWith(ref)).rows;assert.equal(rows[6][4],null);assert.match(rows[6][7],/\.json/);
  }
});
const fixtures=process.env.VERITAX_FIXTURES,studio=process.env.STUDIO_KKP_XLSX;
test('independent Studio workbook matches each documented period of the fictitious demo ZIP',{skip:!fixtures||!studio},async()=>{
  // Read saved worksheet values through Python, independently of the V2 model or XLSX writer.
  const py=spawnSync(process.env.PYTHON||'python3',['-c',
    "import sys,json,openpyxl; w=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True); print(json.dumps({k:[row[3] for row in list(next(s for s in w if s.title.startswith(k+' ')).values)[15:27]] for k in ['N.3','G.2.1','K.2.1']}))",studio],{encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);const reference=JSON.parse(py.stdout);
  const p=indexPackage(await readPackage(await readFile(join(fixtures,'CONTOH-paket-DEMO-FIKTIF.zip')))),index=buildIndex(p,'2025');
  for(const ref of Object.keys(reference)){
    const rows=lines(index,ref);assert.equal(rows.length,ref==='N.3'?12:11);
    for(const row of rows){assert.ok(Number.isFinite(row.amount));assert.equal(row.amount,reference[ref][Number(row.period.slice(-2))-1],ref+' '+row.period);}
    if(ref!=='N.3'){assert.equal(rows.some(l=>l.period==='2025-09'),false);assert.equal(reference[ref][8],0);}
  }
});
