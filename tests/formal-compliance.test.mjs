import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filingAndPaymentRows} from '../extension/analisis/formal-compliance.js';

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
