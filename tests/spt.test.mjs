import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyAnnexes,financialPosition,findFields,formSheets,indicativeDates,partRows,partTitle,sptFieldLabel,sptFieldValue,vatFormSummary} from '../extension/analisis/spt-forms.js';

const entry=(path,body)=>({path,pages:[{Payload:body}]});
function form(type,data,version=0){
  return {type,period:'2025-01',version,id:'f'+version,meta:{},key:'spt/'+type+'/2025-01/p0'+version+'_f'+version,
    parts:new Map([['induk',entry('induk.json',{FormData:JSON.stringify(data)})]])};
}
test('Returns distinguish signed balances from a corporate overpayment option',()=>{
  for(const [kind,data,expected,amount] of [
    ['PPN',{VATUnderOrOverPaid:{VAT:-42}},'Lebih bayar',-42],
    ['OP',{UnderOrOverPaymentTax:0},'Nihil',0],
    ['BADAN',{MainFormData:{UnderpaymentIncomeTax:99,OverpaymentIncomeTax:null}},'Kurang bayar',99],
    ['BADAN',{MainFormData:{UnderpaymentIncomeTax:-37,OverpaymentIncomeTax:1}},'Lebih bayar',-37],
    ['BADAN',{MainFormData:{UnderpaymentIncomeTax:0}},'Nihil',0],
    ['BADAN',{MainFormData:{UnderpaymentIncomeTax:'16.75'}},'Kurang bayar',16.75],
    ['BADAN',{MainFormData:{OverpaymentIncomeTax:2}},'Belum tersedia',null],
    ['BADAN',{MainFormData:{UnderpaymentIncomeTax:'',OverpaymentIncomeTax:0}},'Belum tersedia',null]
  ]){
    const result=financialPosition(form(kind,data));assert.equal(result.status,expected);assert.equal(result.amount,amount);
  }
});
test('Article 21/26 reads the balance of each version before considering withholding',()=>{
  const normal=form('PPH2126',{A21IncomeTaxUnderpaidOverpaid:0,A26IncomeTaxUnderpaidOverpaid:0,A21IncomeTaxWithheld:99});
  const changed=form('PPH2126',{A21IncomeTaxUnderpaidOverpaid:-50,A26IncomeTaxUnderpaidOverpaid:20,
    A21IncomeTaxUnderpaidOverpaidDueToAmendment:75},1);
  assert.equal(financialPosition(normal).amount,0);
  assert.equal(financialPosition(changed).amount,-30);assert.equal(financialPosition(changed).status,'Lebih bayar');
  const withheld=financialPosition(form('PPH2126',{A21IncomeTaxWithheld:95,A26IncomeTaxWithheld:10,A21IncomeTaxBorneByGovernment:5}));
  assert.equal(withheld.amount,100);assert.equal(withheld.status,'Kurang bayar');assert.match(withheld.basis,/potongan/i);
  const oneComponent=financialPosition(form('PPH2126',{A26IncomeTaxUnderpaidOverpaid:12}));
  assert.equal(oneComponent.amount,12);assert.match(oneComponent.basis,/26/);assert.doesNotMatch(oneComponent.basis,/21/);
  const noPositiveComponent=financialPosition(form('PPH2126',{A21IncomeTaxBorneByGovernment:5}));
  assert.equal(noPositiveComponent.amount,null);
  assert.equal(financialPosition(form('PPH2126',{})).amount,null);
});
test('Unified withholding reports the payment as a payment including zero',()=>{
  for(const amount of [0,99]){
    const result=financialPosition(form('UNIFIKASI',{TotalWithholding:123,TotalIncomeTaxPaid:amount}));
    assert.equal(result.amount,amount);assert.equal(result.status,amount===0?'Nihil':'Kurang bayar');assert.match(result.basis,/disetor/i);
  }
  assert.equal(financialPosition(form('UNIFIKASI',{TotalWithholding:123})).amount,null);
  assert.equal(financialPosition(form('UNIFIKASI',{TotalIncomeTaxPaid:false})).amount,null);
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
test('Indonesian captions preserve source fields, account codes, unknown values and zero',()=>{
  const data={TaxType:'ICT_RCIT',L1AFormData:{DebtMonth2:0},Status:'NORMAL',SignerTin:'0000000000000001',FutureEntry:null};
  const f=form('BADAN',data);
  f.parts.set('l1',Object.assign(entry('l1.json',{Data:[{TaxType:'ICT_RCIT',Status:'AMENDMENT'}]}),
    {cap:{konteks:{labelBagian:'Lampiran laporan keuangan'}}}));
  assert.equal(partTitle(f,'l1'),'Lampiran laporan keuangan');
  assert.equal(sptFieldLabel('L1AFormData.DebtMonth2'),'Lampiran 1A › Saldo utang bulan ke-2');
  assert.equal(sptFieldValue('ReturnSheetStatus','SUBMITTED'),'Dilaporkan');
  assert.equal(sptFieldValue('TaxType','FUTURE_TAX'),'Pilihan lain pada sumber');
  const visible=partRows(f,'induk'),raw=partRows(f,'induk',true);
  assert.ok(visible.every(row=>!Object.keys(row).includes('Kode isian')));
  assert.equal(visible.find(row=>row.Isian.endsWith('Saldo utang bulan ke-2')).Nilai,0);
  assert.equal(visible.find(row=>row.Isian==='NPWP penanda tangan').Nilai,data.SignerTin);
  assert.equal(visible.find(row=>row['Kode isian']==='FutureEntry').Nilai,null);
  assert.equal(raw.find(row=>row['Kode isian']==='TaxType').Nilai,'ICT_RCIT');
  assert.deepEqual(partRows(f,'l1'),[{'Jenis pajak':'PPh Badan',Status:'Pembetulan'}]);
});
test('Only annexes with an explicit empty table and matching zero count are grouped',()=>{
  const f=form('PPN',{});
  for(const [key,rows,total,cap] of [['a1',[],0,{}],['a2',[],8,{}],['b1',[{VAT:0}],0,{}],
    ['b2',[],null,{}],['b3',[],null,{lengkap:true,baris:0}],['c',[],0,{lengkap:false}],['c-total',[],0,{}]]){
    f.parts.set(key,{...entry(key,{Data:rows,TotalRecords:total}),cap});
  }
  f.parts.set('invalid',{pages:[{IsSuccessful:false,Payload:{Data:[],TotalRecords:0}}]});
  assert.deepEqual(emptyAnnexes(f),['a1','b3']);
});
test('VAT summary reads amounts in the selected return without rounding or interpreting missing values',()=>{
  const data={TotalDeliveryOfGoodsAndServices:{SellingPrice:976,OtherTaxBase:null,VAT:'17.25'},
    VATUnderOrOverPaid:{VAT:-35},ImportOfTaxableGoods:{VAT:0},IsDraft:true,Skipped:[{VAT:140}]};
  assert.deepEqual(vatFormSummary(form('PPN',data)),[
    {Uraian:'Jumlah penyerahan','Harga jual':976,'DPP nilai lain':null,PPN:'17.25'},
    {Uraian:'PPN kurang atau lebih bayar',PPN:-35},{Uraian:'Impor barang kena pajak',PPN:0}]);
  assert.deepEqual(vatFormSummary(form('PPH2126',data)),[]);
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
