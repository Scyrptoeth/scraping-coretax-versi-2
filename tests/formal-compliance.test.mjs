import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filingAndPaymentRows} from '../extension/analisis/formal-compliance.js';
import {kkaCompliance} from '../extension/analisis/kka-compliance.js';

test('formal workpaper distinguishes the actual due date, monthly screen, assessments and missing filings',()=>{
  const form={year:'2025',type:'PPN',period:'2025-01',version:0,reportDate:'2025-03-03',dueDate:'2025-02-28',filingDueDate:'2025-02-28',filingLate:true,meta:{DocumentReceiptNumber:'00009',BpsNo:'BPE-FIKTIF'}};
  const payment={AccountingTypeCode:'Payment',PeriodCode:'12122025',TransactionDate:'2026-01-18',RevenueCode:'411121',PaymentCode:'100',Amount:250};
  const data=[{...payment,RecordId:'1'},{...payment,RecordId:'2',PaymentCode:'300',ReferenceNumber:'tagihan'},
    {...payment,RecordId:'3',RevenueCode:'411211'}, {...payment,RecordId:'4',IsCancelled:true},
    {...payment,RecordId:'5',DueDate:'2026-01-20'}, {...payment,RecordId:'6',PeriodCode:'11122025'}];
  const pkg={forms:[form,{...form,version:1}],entries:[{path:'bukubesar/2025-12.json',cap:{sumber:'bb'},pages:[{Payload:{Data:data}}]}]};
  const rows=filingAndPaymentRows(pkg,'2025');
  assert.equal(rows[2][7],3);
  assert.equal(rows[2][2],'BPE-FIKTIF');assert.equal(rows[2][9],'00009');
  const timeline=rows.find(r=>r[0]==='PPN'&&r[1]==='P1');assert.equal(timeline.length,13);assert.equal(timeline[2],'Tidak tercantum');
  const checks=rows.filter(r=>r[7]==='Tanggal 15 sebelum penyesuaian hari libur');
  assert.deepEqual(checks.map(r=>r.slice(0,7)),[['411121','100','12122025','2026-01-18','2026-01-15',3,250]]);
  assert.equal(rows.find(r=>r[8]==='tagihan')[6],'');
});

test('formal workpaper can use the submitted directory and visible ledger independently of return form coverage',()=>{
  const filed={'Nomor Bukti Penerimaan':'BPE-FIKTIF','Jenis Surat Pemberitahuan Pajak':'SPT Masa PPh Pasal 21/26',
    'Masa Pajak':'Januari 2025','Model SPT':'Normal','Status SPT':'Dilaporkan',
    'Tanggal Penerimaan':'18-02-2025','Tanggal Jatuh Tempo':'17-02-2025'};
  const payment={'Nomor Transaksi':'FIKTIF','Jenis Pencatatan':'Pembayaran','Detail Jenis Pencatatan':'Pemindahbukuan',
    'Masa Pajak':'Januari 2025','Tanggal Transaksi':'18-02-2025 08:01:00','Tanggal Posting':'19-02-2025 08:02:00',
    'Tanggal Jatuh Tempo Pembayaran':'17-02-2025',Jumlah:'10.000,50','Nilai Sisa':'0',Dibatalkan:'Tidak',
    KAP:'411121',KJS:'100',Referensi:'RUJUKAN-FIKTIF'};
  const entry=(path,record)=>({path,cap:{lengkap:false},pages:[{Payload:{Data:[record]}}]});
  const pkg={manifest:{},forms:[],entries:[entry('spt/daftar.json',filed),entry('bukubesar/2025-01.json',payment)]};
  const rows=filingAndPaymentRows(pkg,'2025');
  assert.deepEqual(rows[2].slice(1,9),[
    '2025-01','BPE-FIKTIF','2025-02-18','2025-02-17','2025-02-17','Lewat batas',1,'spt/daftar.json'
  ]);
  assert.equal(rows[2][11],'Daftar pelaporan');
  assert.equal(rows[2][0],'PPh 21/26');
  assert.deepEqual(rows.find(row=>row[8]==='RUJUKAN-FIKTIF').slice(0,8),[
    '411121','100','01012025','2025-02-18','2025-02-19',10000.5,'2025-02-17',1
  ]);
  assert.equal(payment.Jumlah,'10.000,50');
  assert.equal(Object.hasOwn(payment,'Amount'),false);
});

test('KKA formal attachment groups recorded filing types and distinguishes zero late cases from unavailable dates',()=>{
  const form={year:'2025',type:'PPN',period:'2025-01',version:0,reportDate:'2025-02-17',dueDate:'2025-02-15',
    reportSource:'spt/PPN/2025-01/contoh/induk.json',meta:{BpsNo:'BPE-CONTOH-1'}};
  const rows=[
    {ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'02022025',ReturnSheetModel:'Normal',ReturnDate:'2025-03-17',
      ExpectedReturnDate:'2025-03-17',BpsNo:'BPE-CONTOH-2'},
    {ReturnSheetTypeCode:'ICT_WTR',TaxPeriodCode:'02022025',ReturnSheetModel:'Normal',BpsNo:'BPE-CONTOH-3'},
    {ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'03032025',ReturnSheetModel:'Amendment 1',BpsNo:'BPE-CONTOH-4'},
    {ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012024',ReturnSheetModel:'Normal',BpsNo:'BPE-CONTOH-5'}
  ];
  const pkg={forms:[form],entries:[{path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:rows}}]}]};
  const attachment=kkaCompliance(pkg,'2025');
  assert.deepEqual(attachment.rows.slice(1),[['PPh Unifikasi',1,null,null,1],['PPN',2,2,0,0]]);
  assert.equal(attachment.workbook.name,'L-4a Kepatuhan Formal');
  assert.ok(attachment.workbook.rows.some(r=>r[2]==='BPE-CONTOH-1'&&r[5]==='2025-02-17'));
  assert.ok(attachment.workbook.rows.some(r=>r[2]==='BPE-CONTOH-2'&&r[8]==='spt/daftar.json'));
  assert.ok(!attachment.workbook.rows.some(r=>r.includes('BPE-CONTOH-4')||r.includes('BPE-CONTOH-5')));
  assert.deepEqual(kkaCompliance({forms:[],entries:[]},'2025').rows.at(-1),
    ['SPT normal belum tercantum dalam paket',null,null,null,null]);
});
