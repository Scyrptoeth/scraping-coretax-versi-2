import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
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
const tax22=(withheld,paid=999)=>({data:{Type:'Tax Article',Name:'Article 22',TotalWithholding:withheld,TotalIncomeTaxPaid:paid},
  children:[{data:{Type:'Tax Object',Name:'Objek contoh',TotalWithholding:1234}}]});
const main22=(items,opts,fields={})=>entry('UNIFIKASI','induk',{FormData:JSON.stringify({IncomeTaxes:items,...fields})},opts);
const doc22=(base,number,fields={})=>({...slip('Pasal 22',base),WithholdingSlipsNumber:number,IncomeTax:700,...fields});

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

test('article 22 uses active D1 bases and the latest separate parent subtotal, with stable review keys and cancellation evidence',()=>{
  const revision={version:1},feb={period:'2025-02'},mar={period:'2025-03'},may={period:'2025-05'};
  const other={data:{Type:'Tax Article',Name:'Article 23',TotalWithholding:80}};
  const p=pack([grid([doc22(800,'old')]),main22([tax22(800)],{}),
    grid([doc22('35','N01'),doc22(55,'C01',{IsCancelled:true}),doc22(10,'N02',{TaxIdentificationNumber:'0000000000000002'})],revision),
    main22([other,tax22('13')],revision),
    grid([doc22(0,'Z')],feb),main22([tax22(0)],feb),
    grid([doc22(null,'U')],mar),main22([tax22(null)],mar),
    grid([doc22(60,'C02',{WithholdingSlipsStatus:'NORMAL',Status:'CANCELLED'})],may),main22([tax22(12)],may)]);
  const index=buildIndex(p,'2025'),baseRows=lines(index,'E.2.1'),taxRows=lines(index,'E.2.2');
  const month=(list,period)=>list.find(l=>l.period==='2025-'+period);
  assert.deepEqual(baseRows.map(l=>[l.period,l.amount]).sort(),[['2025-01',45],['2025-02',0],['2025-03',null],['2025-05',0]]);
  assert.deepEqual(taxRows.map(l=>[l.period,l.amount]).sort(),[['2025-01',13],['2025-02',0],['2025-03',null],['2025-05',12]]);
  for(const list of [baseRows,taxRows]){
    assert.equal(month(list,'01').version,1);assert.equal(month(list,'02').partial,false);assert.equal(month(list,'03').partial,true);
  }
  const baseLine=month(baseRows,'01'),taxLine=month(taxRows,'01');assert.match(baseLine.source,/baris 1, 3/);
  assert.match(taxLine.source,/p01_demo-1\/induk\.json.*IncomeTaxes\[1\]\.data\.TotalWithholding/);
  const checks=[baseLine,taxLine].map(l=>assessLine(l,{value:l.amount,document:'Dokumen uji',officer:'Fiktif'}));
  assert.deepEqual(restoreIndexedRows(checks,checks,index),checks);
  const reordered=buildIndex(pack([main22([tax22(13),other],revision),grid([doc22(45,'X')],revision)]),'2025');
  assert.equal(lines(reordered,'E.2.2')[0].id,taxLine.id);assert.match(lines(reordered,'E.2.2')[0].source,/IncomeTaxes\[0\]/);
  assert.equal(lines(reordered,'E.2.1')[0].id,baseLine.id);
  const group=index.groups.find(g=>g.ref==='E.2.1'),jan=group.support.filter(s=>s.Masa==='2025-01');
  assert.deepEqual(jan.map(s=>s.Nilai),[55,100]);assert.match(jan[0].Sumber,/baris 2/);
  const sheets=completeIndexBook(p,'2025',index,new Map(),{});
  assert.ok(sheets.find(s=>s.name.startsWith('E.2.1 ')).rows.some(r=>r.includes(jan[1].Uraian)&&r.includes(100)));
  const taxCell=sheets.find(s=>s.name.startsWith('E.2.2 ')).rows.find(r=>r.includes(taxLine.source))[3];
  assert.equal(taxCell.cached,13);assert.equal(taxCell.target.name,'SPT Data');
});

test('article 22 is scoped to source evidence within the same return and year',()=>{
  const index=(entries)=>buildIndex(pack(entries),'2025');
  const refs=i=>i.groups.map(g=>g.ref).filter(s=>s.startsWith('E.2.'));
  assert.deepEqual(refs(index([grid([doc22(0,'N')]),main22([tax22(0)])])),[]);
  assert.deepEqual(refs(index([grid([]),main22([tax22(12)])])),['E.2.2']);
  assert.deepEqual(refs(index([grid([doc22(100,'N')]),main22([tax22(0)])])),['E.2.1','E.2.2']);
  const orphan=index([grid([doc22(100,'N')]),main22([])]);
  assert.deepEqual(refs(orphan),[]);assert.ok(orphan.warnings.some(s=>s.includes('D1-BPU 2025-01')));
  const feb={period:'2025-02'},mixed=index([grid([doc22(100,'N')]),main22([]),grid([doc22(20,'S')],feb),main22([tax22(4)],feb)]);
  assert.deepEqual(refs(mixed),['E.2.1','E.2.2']);
  for(const ref of refs(mixed))assert.equal(lines(mixed,ref).find(l=>l.period==='2025-01').amount,null);
  assert.equal(mixed.groups.find(g=>g.ref==='E.2.1').support[0].Nilai,100);
  for(const main of [
    main22([tax22(12)],{}, {TaxIdentificationNumber:'0000000000000055'}),main22([tax22(12)],{},{TaxPeriodCode:'02022025'}),
    main22([tax22(12)],{},{ReturnSheetRecordIdentifier:'other'}),main22([tax22(12)],{ok:false}),main22([tax22(12),tax22(12)]),
    main22([tax22(12)],{cap:{lengkap:false}})
  ]){
    const p=index([grid([doc22(100,'N')]),main,main22([tax22(1)],{period:'2025-02'})]);
    const jan=lines(p,'E.2.2').find(l=>l.period==='2025-01');assert.equal(jan.amount,null);assert.equal(jan.partial,true);
    assert.equal(lines(p,'E.2.1').length,0);
  }
  const tied=index([main22([tax22(12)],{id:'a'}),main22([tax22(12)],{id:'b'}),grid([doc22(1,'N')],{id:'a'})]);
  assert.deepEqual(refs(tied),[]);assert.equal(tied.warnings.length,1);
});

test('article 22 preserves a supported tax amount when the annex is missing, duplicated, filtered or for another WP',()=>{
  const otherMonth={period:'2025-03'};
  for(const bad of [null,grid([doc22(10,'A'),doc22(10,'A')]),grid([doc22(10,'A',{RecordId:'same'}),doc22(25,'B',{RecordId:'same'})]),
    grid([doc22(10,'A',{Status:'UNKNOWN'})]),grid([doc22(10,'A',{Status:'AMENDED',WithholdingSlipsStatus:'NORMAL'})]),
    grid([doc22(10,'A')],{cap:{payload:{First:20}}}),
    grid([doc22(10,'A')],{cap:{konteks:{npwp:'0000000000000091'}}})]){
    const p=pack([main22([tax22(19)]),main22([tax22(12)],otherMonth),grid([doc22(45,'Z')],otherMonth),...(bad?[bad]:[])]);
    const index=buildIndex(p,'2025');
    assert.equal(lines(index,'E.2.1').find(l=>l.period==='2025-01').amount,null);
    assert.equal(lines(index,'E.2.2').find(l=>l.period==='2025-01').amount,19);
  }
});

test('article 22 annual totals report known coverage, preserve active and gross bases, and do not create reviewable principal',()=>{
  const jan={period:'2025-01'},mar={period:'2025-03'};
  const entries=[grid([doc22(50,'A'),doc22(20,'B',{Status:'CANCELLED'})],jan),main22([tax22(10)],jan),
    grid([doc22(0,'C')],mar),main22([tax22(0)],mar)];
  const annual=(index,ref)=>index.groups.find(g=>g.ref===ref).support.filter(s=>s.Masa==='2025');
  const p=pack(entries),i=buildIndex(p,'2025'),totals=[...annual(i,'E.2.1'),...annual(i,'E.2.2')];
  assert.deepEqual(totals.map(s=>s.Nilai),[50,70,10]);
  for(const s of totals){
    assert.equal(s.Satuan,'Rp (format KKP)');
    assert.equal(s['Masa SPT dalam paket'],2);assert.equal(s['Masa terkonfirmasi'],2);
    assert.equal(s['Masa belum terkonfirmasi'],'');assert.equal(s['Masa tanpa rekaman SPT di paket'].split(', ').length,10);
    assert.match(s.Sumber,/2025-01.*\.json/);assert.match(s.Sumber,/2025-03.*\.json/);
  }
  assert.equal(lines(i,'E.2.1').length,2);assert.equal(lines(i,'E.2.2').length,2);
  const sheets=completeIndexBook(p,'2025',i,new Map(),{});
  assert.ok(sheets.find(s=>s.name.startsWith('E.2.1 ')).rows.some(r=>r.includes(totals[1].Uraian)&&r.includes(70)));
  assert.ok(sheets.find(s=>s.name.startsWith('E.2.2 ')).rows.some(r=>r.includes(totals[2].Uraian)&&r.includes(10)));
  assert.equal(sheets.find(s=>s.name==='Temuan Sementara').rows.length,1);
  const filed=(period,model,id)=>({RecordId:id,TaxPeriodCode:period,ReturnSheetTypeCode:'ICT_WTR',ReturnSheetModel:model,ReturnSheetStatusCode:'SUBMITTED'});
  const list={path:'spt/daftar.json',cap:{konteks:{npwp:wp}},pages:[{Payload:{Data:[filed('02022025','Normal','missing'),filed('03032025','Amendment 001','newer')]}}]};
  const uncertain=buildIndex(pack([...entries,list]),'2025');
  const march=lines(uncertain,'E.2.1').find(l=>l.period==='2025-03');assert.equal(march.amount,null);assert.match(march.source,/Pembetulan terakhir/);
  for(const s of [...annual(uncertain,'E.2.1'),...annual(uncertain,'E.2.2')]){
    assert.equal(s.Nilai,null);assert.equal(s['Masa SPT dalam paket'],3);assert.equal(s['Masa terkonfirmasi'],1);
    assert.equal(s['Masa belum terkonfirmasi'],'2025-02, 2025-03');assert.match(s.Sumber,/daftar\.json/);
  }
  const torn=buildIndex(pack([...entries,grid([],{period:'2025-04',id:'a'}),grid([],{period:'2025-04',id:'b'})]),'2025');
  assert.equal(annual(torn,'E.2.2')[0].Nilai,null);assert.equal(annual(torn,'E.2.2')[0]['Masa belum terkonfirmasi'],'2025-04');
});

test('article 22 totals accept rupiah and isolate foreign currency by supporting source',()=>{
  const jan=[main22([tax22(1)],{},{CurrencyCode:'IDR'}),grid([doc22(15,'J')])],feb={period:'2025-02'};
  const summary=(extra,ref)=>buildIndex(pack([...jan,...extra]),'2025').groups.find(g=>g.ref===ref).support.filter(r=>r.Masa==='2025');
  const foreignSlip=[main22([tax22(2)],feb),grid([doc22(4,'F',{CurrencyCode:'USD'})],feb)];
  assert.equal(summary(foreignSlip,'E.2.1')[0].Nilai,null);assert.equal(summary(foreignSlip,'E.2.2')[0].Nilai,3);
  const cancelledSlip=[main22([tax22(2)],feb),grid([doc22(8,'F',{Currency:'rupiah'}),doc22(5,'X',{Status:'CANCELLED',Currency:'USD'})],feb)];
  const gross=summary(cancelledSlip,'E.2.1');
  assert.deepEqual(gross.map(r=>r.Nilai),[23,null]);assert.match(gross[1].Sumber,/Mata uang/);
  const foreignForm=[main22([tax22(2)],feb,{CurrencyCode:'USD'}),grid([doc22(8,'F')],feb)];
  for(const ref of ['E.2.1','E.2.2']){
    const s=summary(foreignForm,ref)[0];assert.equal(s.Nilai,null);assert.match(s.Sumber,/Mata uang/);
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
const article22Books=process.env.STUDIO_PPH22_DIR;
test('physical Studio exports of controlled article 22 packages confirm worksheet presence, source choice, and evidence limits',{skip:!article22Books},async()=>{
  const excel=spawnSync(process.env.PYTHON||'python3',['-c',[
    'import sys,json,openpyxl,pathlib','p=pathlib.Path(sys.argv[1])',
    "def e22(f): return {s.title.split()[0]:[r[3] for r in list(s.values)[15:28]] for s in openpyxl.load_workbook(f,read_only=True,data_only=True) if s.title.startswith('E.2.')}",
    "print(json.dumps({f.name:e22(f) for f in p.glob('studio-*-2025.xlsx')}))"
  ].join('\n'),article22Books],{encoding:'utf8'});
  assert.equal(excel.status,0,excel.stderr);const books=JSON.parse(excel.stdout);
  const packages=(await readdir(article22Books)).filter(n=>n.startsWith('cas-')&&n.endsWith('.zip'));
  assert.ok(packages.length);packages.push('contoh-22.zip');
  for(const name of packages){
    const p=indexPackage(await readPackage(await readFile(join(article22Books,name)))),index=buildIndex(p,'2025');
    const ref=books['studio-'+name.replace('.zip','').replace('contoh-22','contoh22')+'-2025.xlsx'];
    assert.ok(ref,name);assert.deepEqual(index.groups.map(g=>g.ref).filter(k=>k.startsWith('E.2.')).sort(),Object.keys(ref).sort(),name);
    for(const key of Object.keys(ref)){
      const group=index.groups.find(g=>g.ref===key);
      for(const l of group.lines){
        const expected=ref[key][Number(l.period.slice(-2))-1];
        const listed=group.support?.find(s=>s.Masa===l.period&&s.Uraian.includes('termasuk bukti dibatalkan'));
        if(l.amount===null){
          assert.equal(expected,0);assert.ok(l.partial);assert.ok(l.source);
        }else assert.equal(listed?listed.Nilai:l.amount,expected,name+' '+key+' '+l.period);
      }
      const totals=group.support.filter(s=>s.Masa==='2025');
      assert.ok(totals.length);
      const studioComparable=totals.at(-1);
      if(studioComparable['Masa terkonfirmasi']===studioComparable['Masa SPT dalam paket']){
        assert.equal(studioComparable.Nilai,ref[key][12]);
      }else assert.equal(studioComparable.Nilai,null);
    }
  }
});
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
