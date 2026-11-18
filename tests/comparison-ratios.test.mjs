import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {indexPackage} from '../extension/analisis/model.js';
import {readPackage} from '../extension/archive/package.js';
import {annualRatios,measures,peerBenchmark,ratioEvidence} from '../extension/analisis/peer-analysis.js';

const year='2025';
const entry=(path,body)=>({path,cap:{lengkap:true},pages:[{Payload:body}]});
function pkg(id,code,gross,{sales=100,tag='',yearOnly=year}={}){
  const form={MainFormData:{IncomeTaxInAYear:5},L1cFormData:{
    L1cTreeData:[{Data:{AccountCode:'4020',Amount:sales},Children:[
      {Data:{AccountCode:'4300',Amount:gross}},{Data:{AccountCode:'5020',Amount:80}},
      {Data:{AccountCode:'5400',Amount:4}},{Data:{AccountCode:'4500',Amount:8}}]}],
    L1cTreeTotalRow:{Amount:10},L1cAssets:{AC1122:4,AC1123:1,AC1401:30,AC1500:40,AC1700:100},
    L1cLiabilitiesAndEquity:{AC2229:20,AC2999:40,AC3299:60}}};
  const fileKey=id+tag;
  return indexPackage({manifest:{wp:{npwp:id,nama:'Uji '+id}},report:{valid:true},fileKey,fileName:fileKey+'.zip',entries:[
    entry('profil/informasi-umum.json',{MainEconomicCode:{TradeClassificationCode:code}}),
    entry('spt/BADAN/'+yearOnly+'/p01_record/induk.json',{FormData:JSON.stringify(form)})]});
}
const ids=[1,2,3,4,5].map(n=>String(n).padStart(16,'0'));

test('same-KLU cohort excludes active, other sectors, and duplicate packages for one NPWP',()=>{
  const [a,b,c,d]=[pkg(ids[0],'01111',60),pkg(ids[1],'01111',10),pkg(ids[2],'01111',30),pkg(ids[3],'99999',100)];
  const b2=pkg(ids[1],'01111',90,{tag:'-alt'}),a2=pkg(ids[0].slice(1),'99999',0);
  const all=[a,a2,b,b2,c,d],picked=new Map([[ids[1],b.fileKey]]);
  const group=peerBenchmark(a,all,year,picked);
  assert.equal(group.alternatives.size,3);assert.equal(group.members.length,2);assert.equal(group.sameSector,true);
  const row=group.rows.find(r=>r.Ukuran.includes('GPM'));
  assert.deepEqual([row['WP aktif'],row['Median kelompok'],row.Minimum,row.Maksimum,row['WP dengan nilai'],row['Deviasi (%)']],[60,20,10,30,2,200]);assert.ok(row.Tinjauan);
  const mixed=peerBenchmark(a,all,year);assert.equal(mixed.sameSector,false);
  assert.equal(mixed.rows[0]['Median kelompok'],65);
  assert.equal(peerBenchmark(a,[a,a2,b,b2],year).rows.length,0);
  assert.equal(peerBenchmark(a,[a,b,c],year,new Map([[ids[1],'unknown']])).members.length,2);
});

test('latest unambiguous annual source, zero, absent amounts, denominator and per-metric count',()=>{
  const a=pkg(ids[0],'A',0),b=pkg(ids[1],'A',4,{sales:0}),c=pkg(ids[2],'A',0),d=pkg(ids[3],'A',null);
  const ratios=annualRatios(a,year);
  assert.equal(ratios.ratios.ppm,10);assert.equal(ratios.ratios.npm,5);assert.equal(ratios.ratios.etr,50);
  const afterTax=ratioEvidence(ratios,measures.find(m=>m[0]==='npm'));
  assert.match(afterTax['Isian pembilang'],/TreeTotalRow.Amount.*IncomeTaxInAYear/);
  assert.equal(ratios.ratios.gpm,0);assert.equal(ratios.ratios.current,2);assert.equal(ratios.ratios.dso,18.25);assert.equal(ratios.ratios.dio,136.875);
  const proof=ratioEvidence(ratios,measures.find(m=>m[0]==='cttor'));
  assert.equal(proof.Nilai,5);assert.equal(proof['Isian pembilang'],'MainFormData.IncomeTaxInAYear');assert.match(proof['Isian penyebut'],/4020/);
  assert.equal(proof.Versi,'Pembetulan 1');assert.match(proof['Berkas induk'],/p01_record/);
  const result=peerBenchmark(a,[a,b,c,d],year),gpm=result.rows[0];
  assert.equal(gpm['Median kelompok'],0);assert.equal(gpm['WP dengan nilai'],1);assert.equal(gpm['Deviasi (%)'],null);
  const amb=indexPackage({...a,entries:[...a.entries,{...a.entries.at(-1),path:a.entries.at(-1).path.replace('record','duplicate')}]});
  assert.equal(annualRatios(amb,year).ratios.gpm,null);
  const missing=annualRatios(a,'2024');assert.equal(missing.form,null);assert.equal(missing.ratios.gpm,null);
});

test('registry history takes precedence over current profile; conflicting year codes are unclassified',()=>{
  const a=pkg(ids[0],'99999',40);
  const rows=[{IsMainEconomicCode:true,TradeClassificationCode:'01111',ValidFrom:'2025-01-01',ValidTo:'2025-12-31'}];
  a.entries.push(entry('profil/klu.json',{Data:rows}));
  assert.equal(annualRatios(a,year).klu.code,'01111');
  rows.push({IsMainEconomicCode:true,TradeClassificationCode:'11119',ValidFrom:'2025-08-01'});
  assert.equal(annualRatios(a,year).klu.code,'');
});

test('ownerless historic amounts remain traceable while ratios require a validated taxpayer',()=>{
  const a=pkg(ids[0],'A',40);
  const ownerless={...a,manifest:{}};
  const raw=annualRatios(ownerless,year);
  assert.equal(raw.values.sales.value,100);assert.match(raw.values.sales.field,/4020/);
  assert.equal(raw.values.tax.value,5);assert.equal(raw.ratios.cttor,null);assert.equal(raw.complete,false);
  assert.equal(annualRatios({...a,manifest:{wp:{npwp:'invalid'}}},year).values.sales.value,null);
  const corporate=a.entries.at(-1);
  corporate.cap.konteks={npwp:ids[1]};
  for(const p of [a,ownerless])assert.equal(annualRatios(p,year).values.sales.value,null);
  delete corporate.cap.konteks;
  corporate.cap.lengkap=false;
  assert.equal(annualRatios(ownerless,year).values.sales.value,null);
});

test('two local fictitious corporate examples reproduce the gross margin from their explicit account values',async context=>{
  const dir=process.env.VERITAX_FIXTURES;
  if(!dir)return context.skip('Optional fictitious packages are local');
  const files=(await readdir(dir)).filter(f=>['CONTOH-paket-DEMO-FIKTIF.zip','CONTOH-paket-DEMO-FIKTIF-BADAN-MIGRASI.zip'].includes(f));
  assert.equal(files.length,2);
  for(const name of files){
    const current=annualRatios(indexPackage(await readPackage(await readFile(path.join(dir,name)))),year);
    const [gross,sales]=name.includes('MIGRASI')?[2000000000,10400000000]:[27375970597,97771323561];
    assert.equal(current.values.gross.value,gross);assert.equal(current.values.sales.value,sales);
    assert.equal(current.ratios.gpm,gross/sales*100);
  }
});
