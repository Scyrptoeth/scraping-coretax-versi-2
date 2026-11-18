import assert from 'node:assert/strict';
import test from 'node:test';
import {dashboardMetrics} from '../extension/analisis/dashboard-metrics.js';
import {indexPackage} from '../extension/analisis/model.js';

const entry=(path,body,complete=true)=>({path,cap:{lengkap:complete},pages:[{IsSuccessful:true,Payload:body}]});
const result=(entries,year='2025')=>Object.fromEntries(dashboardMetrics(indexPackage({manifest:{},entries}),year).map(item=>[item.id,item]));
const vat=(period,revision,sales,balance)=>entry('spt/PPN/'+period+'/p'+revision+'_demo/induk.json',{
  TotalDeliveryOfGoodsAndServices:{SellingPrice:sales}, VATUnderOrOverPaid:{VAT:balance}
});
const annual=(revision,sales,tax)=>entry('spt/BADAN/2025/p'+revision+'_demo/induk.json',{
  L1cFormData:{L1cTreeData:[{Data:{AccountCode:'4020',Amount:sales}}]},
  MainFormData:{IncomeTaxInAYear:tax}
});
test('corporate and VAT cards take latest filings, keep zero and link the contributing main forms',()=>{
  const a=annual('01',1000,0),jan=vat('2025-01','01',260,30),feb=vat('2025-02','00',300,-20);
  const m=result([annual('00',800,70),a,vat('2025-01','00',200,50),jan,feb,vat('2024-12','00',2000,500)]);
  assert.equal(m.sales.value,1000);assert.equal(m.tax.value,0);assert.deepEqual(m.sales.sources,[a.path]);
  assert.equal(m.supplies.value,560);assert.equal(m.vatDue.value,30);
  assert.deepEqual(m.vatDue.sources.slice().sort(),[jan.path,feb.path].sort());
  const missing=result([jan,vat('2025-02','00',null,null)]);
  assert.equal(missing.sales.value,null);assert.equal(missing.tax.value,null);
  assert.equal(missing.supplies.value,null);assert.equal(missing.vatDue.value,null);
  assert.equal(result([feb]).vatDue.value,0);
});

test('ledger cards use distinct transactions, document each year criterion, threshold and sign',()=>{
  const pay={RecordId:'payment-1',PeriodCode:'12122025',PostingDate:'2026-01-05',AccountingTypeCode:'Payment',Amount:60,AmountLeft:30};
  const annualOnly={RecordId:'pay-2',PeriodCode:'01122025',PostingDate:'2025-04-15',AccountingTypeCode:'Payment',Amount:-8,AmountLeft:0};
  const debt={RecordId:'d',PeriodCode:'12122025',AccountingTypeCode:'TaxReturn',Amount:-50,AmountLeft:-12};
  const paidDebt={...debt,RecordId:'d2',AmountLeft:1};
  const cancellation={...pay,RecordId:'cancel',Amount:99,IsCancelled:true};
  const ordinary=entry('bukubesar/2025-12.json',{Data:[pay,debt,paidDebt,cancellation]});
  const all=entry('bukubesar/2025-setahun.json',{Data:[pay,annualOnly,debt,paidDebt,cancellation]});
  const m=result([ordinary,all]);
  assert.equal(m.payments.value,68);assert.equal(m.outstanding.value,12);
  assert.deepEqual(m.payments.sources,[ordinary.path,all.path]);
  const postingYear=result([ordinary,all],'2026');
  assert.equal(postingYear.payments.value,60);assert.equal(postingYear.outstanding.value,0);
  const empty=result([]);assert.equal(empty.payments.value,null);assert.equal(empty.outstanding.value,null);
});

test('ledger cards distinguish unknown amount or overlapping unidentified rows from a measured zero',()=>{
  const r={PeriodCode:'01012025',AccountingTypeCode:'Payment',Amount:0,AmountLeft:0};
  const month=entry('bukubesar/2025-01.json',{Data:[r]},false);
  const all=entry('bukubesar/2025-setahun.json',{Data:[r]});
  assert.equal(result([month]).payments.value,0);
  assert.equal(result([month,all]).payments.value,null);
  assert.match(result([month,all]).payments.detail,/tanpa ID/);
  assert.equal(result([entry('bukubesar/2025-01.json',{Data:[{...r,Amount:null}]})]).payments.value,null);
  assert.equal(result([entry('bukubesar/2025-01.json',{Data:[{...r,Amount:-7,AmountLeft:null}]})]).outstanding.value,null);
});
