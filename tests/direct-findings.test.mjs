import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexPackage} from '../extension/analisis/model.js';
import {directBusinessDay,directRelief,paymentDeadline,paymentInterest} from '../extension/analisis/direct-finding-calendar.js';
import {directStp} from '../extension/analisis/direct-finding-stp.js';
import {directFindings} from '../extension/analisis/direct-findings.js';
import {observedTransferRows} from '../extension/analisis/direct-finding-transfers.js';

const npwp='0000000000000031';
function source(rows,more={}){
  return {cap:{lengkap:true,konteks:{npwp},total:rows.length,baris:rows.length,...more},pages:[{Payload:{TotalRecords:rows.length,Data:rows}}]};
}
function demo({period='2025-04',type='PPN',filed='2025-06-08',deadline='2025-05-31',date='2025-06-08',
  amount=100000,balance=0,notice=false,changeLedger=()=>{},changeList=()=>{},changeParts=()=>{}}={}){
  const year=period.slice(0,4),m=period.slice(5),periodCode=m+m+year;
  const kind={PPN:'VAT_VATR',PPH2126:'ICT_WITR',UNIFIKASI:'ICT_WTR'}[type],account={PPN:'411211',PPH2126:'411121',UNIFIKASI:'411124'}[type];
  const listRow={RecordId:'doc',ReturnSheetTypeCode:kind,TaxPeriodCode:periodCode,ReturnSheetModel:'Normal',ReturnSheetStatusCode:'Submitted',ReturnDate:filed,ExpectedReturnDate:deadline};
  const list={path:'spt/daftar.json',...source([listRow])};changeList(list);
  const parent={path:'spt/'+type+'/'+period+'/p00_doc/induk.json',cap:{lengkap:true,konteks:{npwp,bagian:'induk',spt:{npwp,jenis:kind,masa:periodCode,
    pemb:0,tahun:Number(year),recordId:'doc',status:'Submitted',tanggal:filed,batas:deadline}}},pages:[{Payload:{FormData:'{}'}}]};changeParts(parent);
  const base={PeriodCode:periodCode,IsCancelled:false,RevenueCode:account};
  const liens=[{...base,RecordId:'debt',AccountingTypeCode:'TaxReturn',PaymentCode:'200',ReferenceType:kind,Amount:-amount,AmountLeft:-balance}];
  if(amount>balance)liens.push({...base,RecordId:'pay',AccountingTypeCode:'Payment',AccountingTypeDetailCode:'CASH',PaymentCode:'100',
    ReferenceNumber:'NT-FIKTIF',TransactionDate:date,Amount:amount-balance,AmountLeft:0});
  if(notice)liens.push({...base,RecordId:'notice',AccountingTypeCode:'TaxNotice',PaymentCode:'300',Amount:-500000,AmountLeft:-500000,
    ReferenceNumber:'STP-FIKTIF',RevenueCodeDescription:'Denda Pasal 7'});
  const ledger={path:'bukubesar/'+period+'.json',...source(liens)};
  changeLedger(ledger,liens);
  return indexPackage({manifest:{wp:{npwp},dibuat:'2026-06-01'},entries:[list,parent,ledger],report:{valid:true}});
}
const work=end=>({simulation:{end}});
test('Hari terakhir bulan, akhir pekan dan cuti nasional mengubah tanggal pembanding secara deterministik',()=>{
  assert.equal(paymentDeadline('PPN','2025-02'),'2025-04-08');
  assert.equal(paymentDeadline('PPN','2025-04'),'2025-06-02');
  assert.equal(paymentDeadline('UNIFIKASI','2025-10'),'2025-11-17');
  assert.equal(paymentDeadline('PPH2126','2026-01'),'2026-02-18');
  assert.equal(directBusinessDay('2025-08-17'),'2025-08-19');
  assert.equal(paymentDeadline('PPN','2026-12'),null);assert.equal(paymentDeadline('PPN','2025-13'),null);
  assert.equal(directBusinessDay('2025-02-29'),null);
});
test('KMK Pasal 9 dibaca untuk awal keterlambatan; sebagian bulan, pergantian bulan, 24 bulan dan tarif yang kosong',()=>{
  const before=paymentInterest(100000,'2025-04-15','2025-05-15');assert.equal(before.months,1);assert.equal(before.amount,1000);
  assert.equal(paymentInterest(10999,'2025-04-15','2025-05-15').amount,109);
  assert.equal(paymentInterest(100000,'2025-04-15','2025-05-16').months,2);
  assert.equal(paymentInterest(100000,'2025-08-31','2025-09-01').rate,0.95);
  assert.equal(paymentInterest(100000,'2025-01-31','2025-02-28').months,1);
  assert.equal(paymentInterest(100000,'2025-02-15','2030-06-01').months,24);
  assert.equal(paymentInterest(100000,'2027-02-15','2027-02-16').amount,null);
  assert.equal(paymentInterest(1.25,'2025-04-15','2025-04-17'),null);
  assert.equal(paymentInterest(100,'2025-04-15','2025-04-15'),null);
});
test('Masa transisi Coretax menahan calon denda/bunga pada batas tanggal yang diumumkan',()=>{
  assert.ok(directRelief('UNIFIKASI','2025-01','payment','2025-02-28'));
  assert.equal(directRelief('UNIFIKASI','2025-01','payment','2025-03-01'),'');
  assert.ok(directRelief('PPN','2025-03','filing','2025-05-10'));
  assert.equal(directRelief('PPN','2025-03','payment','2025-05-10'),'');
  assert.ok(directRelief('PPH2126','2025-12','filing','2026-02-28'));
  assert.equal(directRelief('PPH2126','2025-12','filing','2026-03-01'),'');
  const p=demo({type:'PPH2126',period:'2025-03',filed:'2025-04-25',deadline:'2025-04-20',date:'2025-04-15'});
  assert.equal(directStp(p,'2025').facts.length,0);assert.match(directStp(p,'2025').notes.join(' '),/penghapusan/);
});
test('Tanggal lapor dan setoran memiliki fakta terpisah, kunci stabil, serta STP terbit tidak diusulkan kembali',()=>{
  const p=demo({notice:true}),a=directStp(p,'2025',work('2026-06-01')),b=directStp(p,'2025',work('2026-11-01'));
  assert.equal(a.facts.length,2);assert.deepEqual(a.facts.map(f=>f.key),b.facts.map(f=>f.key));
  assert.equal(a.facts[0].formKey,p.forms[0].key);assert.equal(a.facts[0].bookedAmount,500000);assert.equal(a.facts[0].sanctionAmount,null);
  assert.equal(a.facts[1].sanctionAmount,990);assert.equal(a.facts[1].amount,null);
  const noNotice=directStp(demo(),'2025');assert.equal(noNotice.facts[0].sanctionAmount,500000);
  const empty=directStp(p,'2025',work('2025-06-02'));assert.equal(empty.facts.length,0);
  const claimed=demo({notice:true,changeLedger:(_,liens)=>{liens.at(-1).RevenueCodeDescription='STP';}});
  assert.ok(directStp(claimed,'2025').facts.every(f=>f.sanctionAmount===null));
});
test('Pelunasan memakai bagian yang sudah dialokasikan, memisahkan kredit tersisa, dan menahan transaksi yang ambigu',()=>{
  const options={type:'UNIFIKASI',period:'2025-10',filed:'2025-11-19',deadline:'2025-11-20',date:'2025-11-18'};
  const p=demo({...options,changeLedger:(e,rows)=>{
    rows.push({...rows[1],RecordId:'extra',ReferenceNumber:'NT-2',Amount:70000,AmountLeft:70000,TransactionDate:'2025-11-13'});
    e.cap.total=e.cap.baris=e.pages[0].Payload.TotalRecords=rows.length;
  }});
  const r=directStp(p,'2025');assert.equal(r.facts.length,1);assert.equal(r.facts[0].sanctionAmount,920);
  const partial=demo({...options,changeLedger:(_,rows)=>{rows[1].AmountLeft=5000;}});
  assert.equal(directStp(partial,'2025').facts.length,0);
  const noReceipt=demo({...options,changeLedger:(_,rows)=>{rows[1].ReferenceNumber='';}});
  assert.equal(directStp(noReceipt,'2025').facts.length,0);
});
test('Sisa PPN dan PPh pemotongan ditampilkan sebagai pembukuan, tanpa tambahan pokok atau bunga otomatis',()=>{
  for(const type of ['PPN','PPH2126']){
    const p=demo({type,balance:100000,filed:'2025-05-18',deadline:'2025-05-20'}),report=directFindings(p,'2025',work('2026-07-01'));
    const debt=report.facts.find(f=>f.ledgerId==='debt');
    assert.equal(debt.ledgerBalance,100000);assert.equal(debt.amount,null);assert.equal(debt.sanctionAmount,null);
    assert.equal(report.totals.at(-1).value,100000);
    assert.equal(directStp(p,'2025',work('2025-11-01')).facts.length,0);
  }
});
test('A generic VAT ledger reference needs a matched original return to establish the outstanding amount',()=>{
  const input=(declared,detail='N')=>demo({balance:40000,filed:'2025-05-18',deadline:'2025-05-20',
    changeLedger:(_,rows)=>Object.assign(rows[0],{ReferenceType:'TaxReturn',AccountingTypeDetailCode:detail,ReferenceNumber:'PPN-FIKTIF'}),
    changeParts:entry=>{entry.pages[0].Payload.FormData=JSON.stringify({VATUnderOrOverPaid:{VAT:declared}});}});
  const facts=directStp(input(100000),'2025').facts;
  assert.equal(facts.length,1);
  assert.equal(facts[0].ledgerBalance,40000);
  assert.equal(facts[0].sanctionAmount,null);
  assert.match(facts[0].source,/induk\.json · VATUnderOrOverPaid\.VAT/);
  for(const pkg of [input(99999),input(null),input(100000,'A')]){
    assert.equal(directStp(pkg,'2025').facts.length,0);
  }
});
test('Buku besar parsial, salah WP, gagal, tembus bulan, tertapis, atau valuta berbeda tidak dianggap bukti setoran',()=>{
  for(const changeLedger of [
    e=>{e.cap.lengkap=false;},e=>{e.cap.konteks.npwp='0000000000000032';},e=>{e.pages[0].IsSuccessful=false;},
    e=>{e.cap.payload={Filters:[{PropertyName:'RevenueCode',Value:'411211',MatchMode:'equals'}]};},e=>{e.cap.total++;},
    (_,r)=>{r[1].PeriodCode='05052025';},(_,r)=>{r[1].Currency='USD';},(_,r)=>{r[1].IsCancelled=true;}
  ]){
    const result=directStp(demo({changeLedger}),'2025');
    assert.ok(!result.facts.some(f=>f.key.includes('/payment/')));
  }
  assert.equal(directStp(demo({changeList:e=>{e.cap.lengkap=false;}}),'2025').facts.length,0);
  assert.equal(directStp(demo({changeParts:e=>{e.cap.konteks.npwp='0000000000000032';}}),'2025').facts.length,0);
});
test('Pembetulan yang baru tercantum di daftar menahan pemasangan setoran dengan SPT normal',()=>{
  const p=demo({changeList:e=>{
    const rows=e.pages[0].Payload.Data;rows.push({...rows[0],RecordId:'next',ReturnSheetModel:'Amendment_1'});
    e.pages[0].Payload.TotalRecords=e.cap.baris=e.cap.total=rows.length;
  }});
  const result=directStp(p,'2025');
  assert.ok(result.facts.some(f=>f.formKey));assert.ok(!result.facts.some(f=>f.key.includes('/payment/')));
  assert.match(result.notes.join(' '),/pembetulan/i);
});
test('Pemindahbukuan dengan rincian berpasangan tetap dapat ditelusuri ketika respons tidak memberi total pasti',()=>{
  const sequence=()=>{
    const p=demo({type:'PPH2126',period:'2025-05',date:'2025-06-18',deadline:'2025-06-20',filed:'2025-06-19'});
    const e=p.entries.at(-1);e.cap.total=null;e.cap.payload={Rows:10000};e.pages[0].Payload.TotalRecords=10000;
    const [debt,pay]=e.pages[0].Payload.Data;debt.AccountingTypeDetailCode='A';
    Object.assign(pay,{RelatedRecordId:debt.RecordId,AccountingTypeDetailCode:'BT',ReferenceType:'Balance Transfer In',TaxpayerTIN:npwp,
      TaxpayerAccountingDetails:[{HeaderRecordId:pay.RecordId,ReconciledRecordId:debt.RecordId,AccountingTypeCode:'TaxReturn',
        PeriodCode:debt.PeriodCode,RevenueCode:debt.RevenueCode,ReferenceType:debt.ReferenceType,Amount:-pay.Amount}]});
    return {p,e,debt,pay};
  };
  const {p,e,pay}=sequence(),report=directFindings(p,'2025');
  const r=report.tables.find(t=>t.title.startsWith('Pemindahbukuan')).rows;
  assert.equal(r.length,1);assert.deepEqual(r[0].slice(2,6),['Pembetulan SPT','2025-06-18','2025-06-16',100000]);
  assert.equal(report.facts.length,0);assert.equal(report.totals.find(x=>x.label.startsWith('Estimasi sanksi')).value,null);
  assert.equal(observedTransferRows(p,2025,'2025-06-17').rows.length,0);
  e.pages[0].Payload.Data.push({...pay,Amount:1});assert.equal(observedTransferRows(p,2025).rows.length,0);
  for(const change of [c=>{c.pay.TaxpayerTIN='0000000000000032';},c=>{c.debt.IsCancelled=true;},c=>{c.pay.RelatedRecordId='lain';},
    c=>{c.pay.TaxpayerAccountingDetails[0].Amount=-9;},c=>{c.pay.TaxpayerAccountingDetails[0].ReconciledRecordId='lain';},
    c=>{c.pay.TaxpayerAccountingDetails[0].Currency='USD';},c=>{c.pay.TaxpayerAccountingDetails=[];}]){
    const set=sequence();change(set);assert.equal(observedTransferRows(set.p,2025).rows.length,0);
  }
});
