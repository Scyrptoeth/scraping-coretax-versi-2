import assert from 'node:assert/strict';
import test from 'node:test';
import {kkaObligationsAppendix} from '../extension/analisis/kka-obligations.js';
import {indexPackage} from '../extension/analisis/model.js';

const owner='0000000000000071',other='0000000000000072';
const vat='VAT_VATR',pph21='ICT_WITR',annual='ICT_RCITR';
const entry=(path,sumber,data,npwp=owner)=>({path,cap:{sumber,lengkap:true,konteks:{npwp}},
  pages:[{Payload:{Data:data}}]});
const record=(id,type,month,info={})=>({RecordId:id,ReturnSheetTypeCode:type,TaxPeriodCode:month,
  ReturnSheetModel:'Normal',ReturnDate:'2025-03-03',ExpectedReturnDate:'2025-03-01',...info});
const main=(type,period,id,body,version=0,wp=owner)=>entry(
  `spt/${type}/${period}/p${version}_${id}/induk.json`,'sptisi',[body],wp);
const payment=(id,period,amount,cap,info={})=>({RecordId:id,PeriodCode:period,Amount:amount,RevenueCode:cap,
  AccountingTypeCode:'Payment',IsCancelled:false,TransactionDate:'2025-03-01',...info});
function fixture(entries){
  return indexPackage({manifest:{wp:{npwp:owner},opsi:{periode:{from:{y:2024,m:11},to:{y:2025,m:6}}}},
    entries,report:{valid:true}});
}
const lookup=(report,type,period)=>report.workbook.rows.find(row=>row[1]===type&&row[2]===period);

test('KKA L-4b preserves the filing period, scope, latest return and matching payment evidence independently',()=>{
  const daftar=entry('spt/daftar.json','sptdaftar',[
    record('ppn-n',vat,'02022025'),
    record('ppn-a',vat,'02022025',{ReturnSheetModel:'Amendment 1'}),
    record('late',vat,'03032025',{ReturnDate:'2025-03-10'}),
    record('amend',vat,'04042025',{ReturnSheetModel:'Amendment 1',ReturnDate:'0001-01-01'}),
    record('outside',vat,'07072025'),
    record('alternate',pph21,'02022025'),
    record('annual',annual,'01122024',{ReturnDate:'2025-04-20',ExpectedReturnDate:'2025-04-30'})
  ]);
  const active=entry('bukubesar/2025-02.json','bb',[
    payment('matching','02022025',5,'411211'),
    payment('reversed','02022025',10,'411121',{IsCancelled:true}),
    payment('zero','02022025',0,'411121'),
    payment('other-account','02022025',10,'411211',{TaxpayerTIN:other})
  ]);
  const result=kkaObligationsAppendix(fixture([
    daftar,active,main('PPN','2025-02','ppn-n',{VATUnderOrOverPaid:{VAT:500}}),
    main('PPN','2025-02','ppn-a',{VATUnderOrOverPaid:{VAT:0}},1),
    main('PPH2126','2025-02','alternate',{A21IncomeTaxWithheld:12}),
    main('BADAN','2024','annual',{MainFormData:{UnderpaymentIncomeTax:-12}})
  ]),'2025');
  const rows=result.workbook.rows,head=rows.findIndex(r=>r[0]==='Tahun 2025');
  const matrix=rows[head+2];
  assert.equal(matrix[0],'PPN');
  assert.equal(matrix[1],'Belum tercantum');
  assert.match(matrix[2],/^Tepat · Nihil · Ada setoran sejenis$/);
  assert.match(matrix[3],/^Terlambat · Induk versi terakhir belum terverifikasi$/);
  assert.match(matrix[4],/^Hanya pembetulan · Induk versi terakhir belum terverifikasi$/);
  assert.equal(matrix[7],null);
  assert.equal(matrix[12],null);
  const feb=lookup(result,'PPN','2025-02');
  assert.deepEqual(feb.slice(3,9),['Tepat','Nihil',0,'PPN kurang/(lebih) bayar','Ada setoran sejenis','spt/daftar.json']);
  assert.match(feb[9],/p1_ppn-a/);
  assert.equal(feb[10],'bukubesar/2025-02.json');
  const withheld=lookup(result,'PPh 21/26','2025-02');
  assert.equal(withheld[4],'Angka pemotongan pada induk');
  assert.equal(withheld[7],'Setoran sejenis belum terlihat');
  assert.equal(withheld[10],'');
  const annualRow=lookup(result,'PPh Badan','2024');
  assert.equal(annualRow[4],'Lebih bayar');
  assert.equal(annualRow[5],-12);
  assert.match(annualRow[3],/^Tepat · 20-04-2025$/);
  assert.deepEqual(result.rows.find(r=>r[0]==='Ada setoran sejenis'),['Ada setoran sejenis',1]);
});

test('KKA L-4b withholds a prior filing position when the latest version, ownership, or package trust cannot be verified',()=>{
  const list=entry('spt/daftar.json','sptdaftar',[
    record('jan-old',vat,'01012025'),record('jan-amend',vat,'01012025',{ReturnSheetModel:'Amendment 1'}),
    record('feb',vat,'02022025',{ReturnDate:'0001-01-01'}),
    record('unknown',vat,'03032025',{TaxpayerIdentificationNumber:other})
  ]);
  const packageData=fixture([
    list,main('PPN','2025-01','jan-old',{VATUnderOrOverPaid:{VAT:999}}),
    main('PPN','2025-02','feb',{TIN:other,VATUnderOrOverPaid:{VAT:17}}),
    entry('bukubesar/2025-01.json','bb',[payment('wrong','01012025',5,'411211')],other)
  ]);
  const result=kkaObligationsAppendix(packageData,'2025');
  assert.deepEqual(lookup(result,'PPN','2025-01').slice(4,8),
    ['Induk versi terakhir belum terverifikasi',null,null,'Setoran sejenis belum terlihat']);
  assert.deepEqual(lookup(result,'PPN','2025-02').slice(3,6),
    ['Tanggal belum lengkap','Induk belum dapat dibandingkan',null]);
  assert.equal(lookup(result,'PPN','2025-03'),undefined);
  assert.match(kkaObligationsAppendix({...packageData,report:{valid:false}},'2025').rows.at(-1)[0],/belum cukup/);
});
