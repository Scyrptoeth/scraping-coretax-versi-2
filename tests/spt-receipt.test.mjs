import assert from 'node:assert/strict';
import test from 'node:test';
import {receiptNumber} from '../extension/analisis/model.js';
import {linkedPaymentGroups} from '../extension/analisis/profile.js';

test('read the SPT receipt in source order and preserve its digits as text',()=>{
  const record=Object.freeze({DocumentReceiptNumber:'00012',BpsNo:'00034'});
  assert.equal(receiptNumber(record),'00012');
  assert.equal(receiptNumber({DocumentReceiptNumber:' ',BpsNo:'00034'}),'00034');
  assert.equal(receiptNumber({BpsNo:'BPE-FIKTIF'}),'BPE-FIKTIF');
  assert.equal(receiptNumber({DocumentReceiptNumber:123}),'123');
  for(const row of [null,{}, {BpsNo:' '},{BpsNo:null},{RecordId:'not-a-receipt'}])
    assert.equal(receiptNumber(row),'');
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
