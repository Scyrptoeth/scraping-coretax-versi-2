import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annualBusinessCodes,compareShareholders,profileSections,reconcilePayments} from '../extension/analisis/profile.js';
import {indexPackage} from '../extension/analisis/model.js';

const flags={hasRegistry:true,hasReport:true,asOf:'2026-01-01'};
const reg=(name,id,percentage,extra)=>({PersonName:name,PersonNIKTIN:id,Percentage:percentage,...extra});
const spt=(name,id,pct)=>({Name:name,TIN:id,PaidInCapitalPercentage:pct});
test('ownership matches exact identifiers, then unique names with a missing identifier',()=>{
  const left=[reg('A','001',60),reg('PT B','002',40),reg('Lama','003',11,{ValidTo:'2023-01-01'})];
  const report=[spt('Nama berbeda','001',50),spt('PT  B','',50),spt('A','999',0)];
  const r=compareShareholders(left,report,flags);
  assert.deepEqual(r.rows.map(x=>x.Status),['Porsi berbeda','Porsi berbeda','Hanya di SPT Badan']);
  assert.deepEqual(r.rows.map(x=>x.Pencocokan),['NPWP','Nama','']);
  assert.equal(r.registryTotal,100);assert.equal(r.reportTotal,100);
  assert.equal(r.rows[0]['NPWP registrasi'],'001');
  assert.equal(r.rows[2]['Porsi SPT (%)'],0);
  assert.equal(compareShareholders(left,[],{...flags,hasReport:false}).rows[0].Status,'Data SPT belum tersedia');
});
test('ambiguous names or duplicate identifiers cannot produce a claimed ownership match',()=>{
  const r=compareShareholders([reg('A','',20),reg('A','',80)],[spt('A','001',100)],flags);
  assert.ok(r.rows.every(row=>row.Status==='Perlu pencocokan'));
  const dup=compareShareholders([reg('B','007',100)],[spt('B','007',50),spt('B2','007',50)],flags);
  assert.ok(dup.rows.every(row=>row.Status==='Perlu pencocokan'));
});
const entry=(sumber,path,rows)=>({path,cap:{sumber,lengkap:true},pages:[{Payload:{Data:rows}}]});
test('unified profile recognizes native capture labels, preserves amount zero, groups bank and OP sections',()=>{
  const pkg=indexPackage({manifest:{opsi:{}},entries:[
    entry('info','info/123.json',[{GeneralInformation:{TaxpayerType:'TA001',NumberofStaff:0}}]),
    entry('bank','bank/456.json',[{BankAccountNumber:'00123'}]),
    entry('alamat','alamat/789.json',[{TypeOfAddress:'NATIONAL'},{TypeOfAddress:'TKU'}])
  ]});
  const sections=profileSections(pkg),rows=id=>sections.find(s=>s.id===id).rows;
  assert.equal(rows('utama').find(r=>r.Isian.endsWith('NumberofStaff')).Nilai,0);
  assert.equal(rows('bank')[0].BankAccountNumber,'00123');assert.equal(rows('cabang').length,1);
  assert.ok(sections.some(s=>s.id==='op-keluarga'));assert.ok(!sections.some(s=>s.id==='saham'));
});
test('latest SPT and exact ledger reference, period and KAP anchor the payment comparison',()=>{
  const form={latest:true,id:'p1',key:'spt/x/p1',type:'PPN',period:'2025-03',version:1,meta:{}};
  const bill={AccountingTypeCode:'TaxReturn',PeriodCode:'03032025',RevenueCode:'411211',ReferenceNumber:'SPT-p1',Amount:-10,'Berkas sumber':'sumber'};
  const cash={...bill,AccountingTypeCode:'Payment',ReferenceNumber:'NTPN-1',Amount:0};
  const [r]=reconcilePayments([form,{...form,id:'lama',latest:false}],[bill,cash,{...cash,RevenueCode:'lain',Amount:10}]);
  assert.equal(r['Setoran masa dan KAP'],0);assert.equal(r.Status,'Kurang setor pada pembanding');
  assert.equal(reconcilePayments([form],[bill])[0]['Setoran masa dan KAP'],null);
});
test('KLU history shows effective periods and never backfills undated registrations',()=>{
  const base={IsMainEconomicCode:true,'Berkas sumber':'klu.json'};
  const rows=annualBusinessCodes([
    {...base,TradeClassificationCode:'001',ValidFrom:'2023-01-01',ValidTo:'2024-03-31'},
    {...base,TradeClassificationCode:'002',ValidFrom:'2024-04-01',ValidTo:null},
    {...base,TradeClassificationCode:'003',ValidFrom:'0001-01-01',ValidTo:null}
  ],['2023','2024','2025','2025'],'2025-12-31');
  assert.deepEqual(rows.map(r=>[r['Tahun SPT'],r.KLU]),[['2025','002'],['2024','001'],['2024','002'],['2023','001']]);
  assert.match(rows[1].Catatan,/Beberapa/);assert.match(rows[3].Catatan,/Berbeda/);
});
