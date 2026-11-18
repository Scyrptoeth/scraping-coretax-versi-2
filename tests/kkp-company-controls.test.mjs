import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indexPackage} from '../extension/analisis/model.js';
import {buildIndex,indexSheets} from '../extension/analisis/kkp-index.js';
import {createXlsx,signedSumCell} from '../extension/archive/table.js';
import {readZip,decodeText} from '../extension/archive/zip.js';

const owner='0000000000000019';
function example(variant='L1a'){
  const balances={'4020':110000,'5020':45000,'4199':1000,'5400':24000,'4600':8000,'5500':3000};
  return {MainFormData:{CurrencyCode:'IDR',TotalNetIncomeReduction:1000,TotalGrossIncomeVocational:500,TotalGrossIncomeResearch:0,
    TotalCarriedForward:900,IncomeTaxInAYear:4200,TotalIncomeTaxOverseas:300,TotalIncomeTaxDeduction:200,
    InstallmentOfIncome:1200,NoticeOfCollection:100,FiscalNetIncomeAfterTax:48500,TaxableIncome:46000,UnderpaymentIncomeTax:2400},
  [variant+'FormData']:{[variant+'TreeData']:Object.entries(balances).map(([AccountCode,Amount])=>({Data:{AccountCode,Amount},Children:[]})),
    [variant+'TreeTotalRow']:{Amount:47000,SubjectToFinalTax:2000,NonTaxableObject:1000,PositiveFiscalCorrection:6000,NegativeFiscalCorrection:1500}}};
}
function group(body,options={}){
  const {ownerOfSource=owner,id='spt-fiktif',partial=false,extras=[]}=options;
  const item=(data,key,rev=0)=>({path:`spt/BADAN/2025/p0${rev}_${key}/induk.json`,
    pages:[{IsSuccessful:true,Payload:{CurrentFormData:JSON.stringify(data)}}],
    cap:{lengkap:!partial,halaman:1,konteks:{npwp:ownerOfSource,bagian:'induk',spt:{recordId:key,jenis:'ICT_RCITR',tahun:2025,pemb:rev}}}});
  const pkg=indexPackage({entries:[item(body,id),...extras.map(([f,k,v])=>item(f,k,v))],manifest:{wp:{npwp:owner}},report:{valid:true}});
  return buildIndex(pkg,'2025').groups.find(g=>g.key==='BADAN/B');
}
const get=(g,code)=>g.support.find(row=>row.Kode===code);
test('four declared-value checks reconcile a complete L1a and L1c independently of an officer result',()=>{
  for(const variant of ['L1a','L1c']){
    const g=group(example(variant));
    assert.deepEqual(['LABA','NETO','PKP','SALDO'].map(k=>get(g,k).Nilai),[47000,48500,46000,2400]);
    assert.deepEqual(['K1','K2','K3','K4'].map(k=>get(g,k).Nilai),[0,0,0,0]);
    assert.match(get(g,'A4020').Sumber,new RegExp(variant+'TreeData'));
    assert.match(get(g,'REF-LABA').Sumber,new RegExp(variant+'TreeTotalRow.Amount'));
    assert.ok(g.lines.every(l=>!l.id.includes('K1')));
  }
});
test('missing, conflicting, or incomplete sources do not become zero or use a different version',()=>{
  const data=example(),main=data.MainFormData;
  delete main.TotalIncomeTaxDeduction;data.L1aFormData.L1aTreeData.find(n=>n.Data.AccountCode==='4199').Data.Amount=null;
  const g=group(data);
  assert.deepEqual(['K1','K2','K3','K4'].map(k=>get(g,k).Nilai),[null,null,null,null]);
  assert.match(get(g,'K1').Keterangan,/4199/);
  assert.match(get(g,'K4').Keterangan,/TotalIncomeTaxDeduction/);
  assert.equal(g.lines.find(l=>l.topic==='PPh kurang/(lebih) bayar').amount,2400);
  const alternate=example();alternate.MainFormData.TaxableIncome=45700;
  const changed=group(data,{extras:[[alternate,'revisi',1]]});
  assert.equal(get(changed,'K3').Nilai,300);assert.match(get(changed,'K3').Sumber,/p01_revisi/);
  assert.ok(['K1','K2','K3','K4'].every(k=>get(group(example(),{partial:true}),k)?.Nilai==null));
  assert.ok(['K1','K2','K3','K4'].every(k=>get(group(example(),{ownerOfSource:'0000000000000099'}),k)?.Nilai==null));
  const dup=example();dup.L1aFormData.L1aTreeData.push(dup.L1aFormData.L1aTreeData[0]);
  assert.equal(get(group(dup),'K1').Nilai,null);
  const nested=example(),list=nested.L1aFormData.L1aTreeData;
  const child=list.splice(list.findIndex(n=>n.Data.AccountCode==='4199'),1)[0];
  list.find(n=>n.Data.AccountCode==='4020').Children=[child];
  assert.equal(get(group(nested),'K1').Nilai,null);
  const clash=example();for(const n of clash.L1aFormData.L1aTreeData)n.Data.PositiveFiscalCorrection=0;
  const conflict=group(clash);assert.equal(get(conflict,'K2').Nilai,null);assert.match(get(conflict,'POSITIF').Keterangan,/bertentangan/);
  assert.equal(get(conflict,'K4').Nilai,0);
  const restored=example();delete restored.L1aFormData.L1aTreeTotalRow.PositiveFiscalCorrection;
  for(const n of restored.L1aFormData.L1aTreeData)n.Data.PositiveFiscalCorrection=1000;
  assert.equal(get(group(restored),'K2').Nilai,0);
});
test('a signed balance, a fiscal loss, and explicit zeros retain their different meanings',()=>{
  const b=example(),m=b.MainFormData;m.IncomeTaxInAYear=0;m.UnderpaymentIncomeTax=-1800;m.TotalCarriedForward=60000;m.TaxableIncome=0;
  const g=group(b);assert.equal(get(g,'PKP').Nilai,0);assert.equal(get(g,'SALDO').Nilai,-1800);
  assert.equal(get(g,'K4').Nilai,0);
});
test('standalone KKP Excel computes the chain with guarded formula cells and keeps external strings literal',async()=>{
  const b=example();delete b.MainFormData.TotalIncomeTaxDeduction;
  const workbook=await createXlsx({sheets:[indexSheets(group(b),new Map())]});
  const xml=decodeText((await readZip(workbook)).get('xl/worksheets/sheet1.xml').data);
  assert.match(xml,/MAX\(0,ROUNDDOWN\(/);assert.match(xml,/IF\(COUNT\(C\d+,C\d+\)=2,C\d+-C\d+/);
  assert.match(xml,/<c r="C\d+" t="str"><f>IF\(COUNT\(/);
  assert.throws(()=>signedSumCell([{row:'3+1',sign:1}],3,4),RangeError);
  assert.throws(()=>signedSumCell([{row:3,sign:'-1+2'}],3,4),RangeError);
});
test('rupiah rounding is inactive for a different currency, and conflicting currency claims stop arithmetic',async()=>{
  const b=example();b.MainFormData.CurrencyCode='USD';const g=group(b);
  assert.deepEqual(['K1','K2','K3','K4'].map(k=>get(g,k).Nilai),[0,0,null,0]);
  assert.equal(get(g,'K4').Satuan,'USD');assert.match(get(g,'K3').Keterangan,/satuan rupiah/);
  const exported=await createXlsx({sheets:[indexSheets(g,new Map())]});
  const xml=decodeText((await readZip(exported)).get('xl/worksheets/sheet1.xml').data);
  assert.doesNotMatch(xml,/ROUNDDOWN/);
  delete b.MainFormData.CurrencyCode;const missing=group(b);
  assert.equal(get(missing,'K3').Nilai,null);assert.equal(get(missing,'K3').Satuan,'Belum dinyatakan');assert.equal(get(missing,'K4').Nilai,0);
  b.MainFormData.CurrencyCode='USD';
  b.CurrencyCode='IDR';const conflict=group(b);
  assert.ok(['K1','K2','K3','K4'].every(k=>get(conflict,k).Nilai===null));
});
