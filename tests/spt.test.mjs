import assert from 'node:assert/strict';
import test from 'node:test';
import {financialPosition,findFields,formSheets,indicativeDates,partRows} from '../extension/analisis/spt-forms.js';

const entry=(path,body)=>({path,pages:[{Payload:body}]});
function form(type,data,version=0){
  return {type,period:'2025-01',version,id:'f'+version,meta:{},key:'spt/'+type+'/2025-01/p0'+version+'_f'+version,
    parts:new Map([['induk',entry('induk.json',{FormData:JSON.stringify(data)})]])};
}
test('Induk balances retain missing, zero and sign independently of gross withholding',()=>{
  for(const [f,expected] of [[form('PPN',{VATUnderOrOverPaid:{VAT:-42}}),'Lebih bayar'],
    [form('OP',{UnderOrOverPaymentTax:0}),'Nihil'],[form('BADAN',{MainFormData:{UnderpaymentIncomeTax:99,OverpaymentIncomeTax:0}}),'Kurang bayar'],
    [form('BADAN',{MainFormData:{UnderpaymentIncomeTax:99,OverpaymentIncomeTax:1}}),'Belum tersedia'],
    [form('BADAN',{MainFormData:{UnderpaymentIncomeTax:0}}),'Belum tersedia'],[form('PPH2126',{A21IncomeTaxWithheld:99}),'Belum tersedia'],
    [form('UNIFIKASI',{TotalWithholding:99,TotalIncomeTaxPaid:99}),'Belum tersedia']])assert.equal(financialPosition(f).status,expected);
});
test('Content search covers annexes, source codes and Indonesian names without losing zero or false',()=>{
  const f=form('PPN',{TaxPeriodYear:2025,VATUnderOrOverPaid:{VAT:0},IsDraft:false});
  f.parts.set('a2',entry('a2.json',{Data:[{TIN:'00000007',DocumentNumber:'FIKTIF-0007'}]}));
  assert.equal(findFields(f,'kurang atau lebih bayar')[0].Nilai,0);
  assert.equal(findFields(f,'VATUnderOrOverPaid')[0]['Kode isian'],'VATUnderOrOverPaid.VAT');
  assert.equal(findFields(f,'fiktif-0007')[0].Bagian,'a2');
  assert.equal(findFields(f,'tidak')[0].Nilai,'Tidak');
  assert.equal(partRows(f,'induk').find(r=>r['Kode isian']==='TaxPeriodYear').Nilai,'2025');
  assert.equal(partRows(f,'a2',true)[0].TIN,'00000007');
});
test('Combined sheets label each revision and source, and preserve the taxpayer identifier as text',()=>{
  const a=form('PPN',{VATUnderOrOverPaid:{VAT:0}}),b=form('PPN',{VATUnderOrOverPaid:{VAT:-42}},1);
  b.parts.set('b2',entry('b2.json',{Data:[{VAT:42}]}));
  const sheets=formSheets([a,b],{manifest:{wp:{npwp:'0000000000000007',nama:'WP Fiktif'}}});
  assert.equal(sheets.length,3);
  assert.match(sheets[2].name,/P1 b2/);
  assert.equal(sheets[0].rows.find(r=>r[0]==='Versi')[1],'Normal');
  assert.equal(sheets[1].rows.find(r=>r[0]==='Versi')[1],'Pembetulan 1');
  assert.equal(sheets[2].rows.find(r=>r[0]==='NPWP')[1],'0000000000000007');
  assert.equal(sheets[2].rows.find(r=>r[0]==='Sumber')[1],'b2.json');
});
test('Payment dates require the same KAP and period as a liability linked to the form',()=>{
  const a=form('PPN',{}),b=form('PPN',{},1);
  const base={PeriodCode:'01012025',RevenueCode:'411211'};
  const payment={...base,Amount:10,AccountingTypeCode:'Payment',PostingDate:'2025-02-9T00:00:00'};
  const ledger=[{...base,ReferenceNumber:'SPT-f0',AccountingTypeCode:'TaxReturn',Amount:-10},payment,
    {...payment,RevenueCode:'411121',PostingDate:'2025-02-07'},{...payment,PeriodCode:'02022025',PostingDate:'2025-02-15'},
    {...payment,IsCancelled:true,PostingDate:'2025-02-20'}];
  const dates=indicativeDates([a,b],{entries:[entry('bukubesar/2025-01.json',{Data:ledger})]});
  assert.equal(dates.get(a),'2025-02-09');assert.equal(dates.has(b),false);
});
