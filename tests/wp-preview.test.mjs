import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {forms} from '../extension/app-data.js';
import {readPackage} from '../extension/archive/package.js';
import {wpPreview} from '../extension/app-wp-preview.js';

const wp='0000000000000016',other='0000000000000025';
const period={from:{y:2024,m:1},to:{y:2025,m:12}},types=forms.map(([id])=>id);
const json=(source,data)=>({source,wp,page:{Payload:{Data:data,TotalRecords:data.length}}});
const entry=(source,path,data)=>({path,cap:{sumber:source,lengkap:true,konteks:{npwp:wp}},pages:[{Payload:{Data:data,TotalRecords:data.length}}]});
const filing=(type,code,revision,id)=>({ReturnSheetTypeCode:type,TaxPeriodCode:code,ReturnSheetModel:revision,RecordId:id,ReturnSheetStatusCode:'SUBMITTED'});
const profile=()=>({GeneralInformation:{UniqueIdentificationNumber:wp,Name:'Badan Fiktif',TaxpayerType:'TA002',TaxpayerStatus:'ACTIVE'},MainEconomicCode:{TradeClassificationCode:'01234'}});
const current=(items,overrides={})=>wpPreview({wp,period,types,items,...overrides});

test('two years preserve types and count unique normal and amendment filings; filters and archive drafts do not add tax returns',()=>{
  const a=filing('VAT_VATR','01012025','Normal','vat'),b=filing('VAT_VATR','01012025','Amendment 1','vat-a');
  const list=[a,b,a,filing('ICT_RCITR','01122024','Normal','corp'),filing('VAT_VATR','02022023','Normal','old')];
  const r=current([json('info',[profile()]),json('sptdaftar',list),json('sptarsip',[a]),json('sptbelum',[b])]);
  assert.deepEqual([r.profile.name,r.profile.type,r.profile.status,r.profile.klu],['Badan Fiktif','Badan','Aktif','01234']);
  assert.equal(r.spt.total,3);assert.equal(r.spt.complete,true);
  assert.deepEqual(r.spt.rows,[{year:'2025',type:'VAT_VATR',normal:1,amendments:1},{year:'2024',type:'ICT_RCITR',normal:1,amendments:0}]);
  const filtered=json('sptdaftar',list);filtered.page.Payload.Request={Filters:[{field:'month'}]};
  assert.equal(current([filtered]).spt.complete,false);
  assert.equal(current([filtered],{types:['ICT_RCITR']}).spt.total,1);
});

test('empty, partial, failed, ambiguous and foreign lists never imply a confirmed zero',()=>{
  for(const input of [[],[json('bank',[{Name:'Nom du tiers'}])],[{...json('sptdaftar',[]),page:{Payload:{Data:[]}}}],
    [{...json('sptdaftar',[]),wp:other}],[{...json('sptdaftar',[]),page:{IsSuccessful:false}}]]){
    const r=current(input);assert.equal(r.spt.total,null);assert.equal(r.spt.complete,false);
  }
  assert.equal(current([json('sptdaftar',[])]).spt.total,0);
  const a=filing('VAT_VATR','01012025','Normal','r1'),b={...a,RecordId:'r2'};
  const valid=filing('ICT_WITR','01012025','Normal','r3');
  let s=current([json('sptdaftar',[a,b,{...a,NPWP:other},valid])]).spt;
  assert.equal(s.total,1);assert.equal(s.complete,false);assert.ok(s.notes.length);
  s=current([json('sptdaftar',[{...a,ReturnSheetStatusCode:'DRAFT'}])]).spt;
  assert.equal(s.total,null);
});

test('profile identity and active KLU are verified and conflicting labels are withheld',()=>{
  const q=json('info',[profile()]);q.page.Payload.Data[0].GeneralInformation.UniqueIdentificationNumber=other;
  const bad=current([q]);assert.equal(bad.profile.name,null);assert.equal(bad.profile.klu,null);
  const rows=[{IsMainEconomicCode:false,TradeClassificationCode:'02000'},{IsMainEconomicCode:true,TradeClassificationCode:'01111',ValidTo:'2022-12-31'},
    {IsMainEconomicCode:true,TradeClassificationCode:'01234',ValidFrom:'2023-01-01'}];
  assert.equal(current([json('klu',rows)]).profile.klu,'01234');
  assert.equal(current([json('klu',rows.concat({IsMainEconomicCode:true,TradeClassificationCode:'05555'}))]).profile.klu,null);
  const two=current([json('info',[profile(),{NPWP:wp,'Nama WP':'Badan Lain','Jenis WP':'TA002','Status WP':'Aktif'}])]);
  assert.equal(two.profile.name,null);assert.equal(two.profile.status,'Aktif');assert.match(two.profile.notes.join(' '),/Nama WP berbeda/);
});

test('a previously scoped archive contributes dated profile only and is separate from current return counts',()=>{
  const records=[entry('info','profil/informasi-umum.json',[profile()]),entry('sptdaftar','spt/daftar.json',[filing('ICT_RCITR','01122025','Normal','r1')])];
  const previous={meta:{wp:{npwp:wp},dibuat:'2025-12-16T01:00:00Z'},entries:records};
  const r=current([],{previous});
  assert.equal(r.profile.name,'Badan Fiktif');assert.match(r.profile.notes[0],/2025-12-16/);assert.equal(r.spt.total,null);
  assert.equal(current([],{previous:{...previous,meta:{wp:{npwp:other}}}}).profile.name,null);
  const search={path:'profil/pencarian.json',cap:{konteks:{npwp:wp}},pages:[{Payload:{Taxpayers:[{Name:'NPWP berbeda',UniqueIdentificationNumber:other},{Name:'Satu WP',UniqueIdentificationNumber:wp}]}}]};
  assert.equal(current([search]).profile.name,'Satu WP');
});

test('unmodified legacy example ZIPs match their native profile and filing totals',async context=>{
  if(!process.env.VERITAX_FIXTURES)return context.skip('Optional local fictitious packages');
  for(const [file,type,klu,num] of [['CONTOH-paket-DEMO-FIKTIF.zip','Badan','25111',76],['CONTOH-paket-DEMO-FIKTIF-OP.zip','Orang Pribadi','47521',3]]){
    const pkg=await readPackage(await readFile(join(process.env.VERITAX_FIXTURES,file)));
    assert.ok(pkg.report.valid);
    const result=wpPreview({wp:pkg.manifest.wp.npwp,period:pkg.manifest.opsi.periode,types,items:pkg.entries});
    assert.deepEqual([result.profile.name,result.profile.type,result.profile.status,result.profile.klu],[pkg.manifest.wp.nama,type,'Aktif',klu]);
    assert.equal(result.spt.total,num);assert.equal(result.spt.complete,true);
    assert.equal(result.spt.rows.reduce((n,r)=>n+r.amendments,0),type==='Badan'?3:1);
  }
});
