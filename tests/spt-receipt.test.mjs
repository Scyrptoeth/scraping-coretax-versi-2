import assert from 'node:assert/strict';
import test from 'node:test';
import {receiptFields,receiptNumber} from '../extension/analisis/model.js';
import {linkedPaymentGroups} from '../extension/analisis/profile.js';

test('select the source value with a BPE prefix and retain each distinct number under its source label',()=>{
  const fields=(document,bps)=>receiptFields({DocumentReceiptNumber:document,BpsNo:bps});
  assert.deepEqual(fields('BPE-UJI-A','bpe/00034'),{BPE:'BPE-UJI-A','Nomor pada BpsNo':'bpe/00034'});
  assert.deepEqual(fields('00012','bpe/00034'),{BPE:'bpe/00034','Nomor penerimaan dokumen':'00012'});
  assert.deepEqual(fields('BPE-UJI-A','BPE-UJI-A'),{BPE:'BPE-UJI-A'});
  assert.deepEqual(fields('BPE-UJI-A',null),{BPE:'BPE-UJI-A'});
  assert.deepEqual(fields(' ','BPE-FIKTIF'),{BPE:'BPE-FIKTIF'});
  assert.deepEqual(fields('00012','00034'),{'Nomor penerimaan dokumen':'00012','Nomor pada BpsNo':'00034'});
  assert.deepEqual(fields(123,'123'),{'Nomor penerimaan dokumen':'123'});
  for(const raw of ['BPE','BPE123','BPS-34','X-BPE-12','BPE 123',' BPE-123','BPE:123','BPE_123'])
    assert.equal(receiptNumber({DocumentReceiptNumber:raw}),'');
  for(const row of [null,{}, {BpsNo:' '},{BpsNo:null},{RecordId:'not-a-receipt'}])assert.deepEqual(receiptFields(row),{});
});

test('only the selected receipt matches a ledger reference, preserving leading zeros',()=>{
  const form={id:'fictitious-form',meta:{BpsNo:'00012'}};
  const charge={AccountingTypeCode:'TaxReturn',PeriodCode:'01012025',RevenueCode:'411211',Amount:-3};
  const entries=['00012','12','00034'].map(ReferenceNumber=>({...charge,ReferenceNumber}));
  const matched=f=>linkedPaymentGroups(f,entries).flatMap(group=>group.charges.map(r=>r.ReferenceNumber));
  assert.deepEqual(matched(form),['00012']);
  assert.deepEqual(matched({...form,meta:{...form.meta,DocumentReceiptNumber:'00034'}}),['00034']);
  assert.deepEqual(matched({...form,meta:{}}),[]);
});
