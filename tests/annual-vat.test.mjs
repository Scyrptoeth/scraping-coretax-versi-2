import assert from 'node:assert/strict';
import test from 'node:test';
import {annualVat} from '../extension/analisis/annual-vat.js';

function form(period,values,latest=true) {
  const data={pages:[{Payload:{FormData:JSON.stringify(values)}}]};
  return {type:'PPN',year:period.slice(0,4),period,latest,parts:new Map([['induk',data]])};
}

test('annual VAT uses the reported period and latest version, retaining zeros and evidence of the substituted output tax',()=>{
  const input=[form('2025-05',{OutputTaxMustBeSelfCollected:{VAT:0},DeliveryOfTaxableGoodsSubjectToVAT:{VAT:45},
    CarryForwardOfInputTax:{VAT:9},InputTaxCanBeCalculated:{VAT:30},ImportOfTaxableGoods:{VAT:5},VATUnderOrOverPaid:{VAT:-18}}),
    form('2025-05',{OutputTaxMustBeSelfCollected:{VAT:900}},false),
    form('2025-06',{OutputTaxMustBeSelfCollected:{VAT:0},VATUnderOrOverPaid:{VAT:0}})];
  const {rows,notes,available}=annualVat(input,'2025');
  assert.equal(available,2);assert.equal(rows.length,13);assert.equal(Object.keys(rows[4]).length,18);
  assert.equal(rows[4]['PPN dipungut sendiri (PK)'],45);assert.equal(rows[4]['PM perolehan DN'],16);
  assert.equal(rows[4]['Penyesuaian PM lain (induk)'],0);assert.equal(rows[5]['PPN dipungut sendiri (PK)'],0);
  assert.equal(rows.at(-1)['PPN kurang/(lebih) bayar'],null);assert.equal(rows.at(-1)['PM perolehan DN'],null);
  assert.equal(Object.hasOwn(rows[0],'PPN dipungut sendiri (PK)'),false);assert.equal(notes.length,1);
  assert.equal(notes[0]['Nilai isian utama'],0);assert.equal(notes[0]['Isian yang digunakan'],'DeliveryOfTaxableGoodsSubjectToVAT.VAT');
  assert.equal(annualVat(input,'2026'),null);
});

test('primary output tax takes priority over an available substitute and unknown amounts stay missing',()=>{
  const series=annualVat([form('2025-01',{OutputTaxMustBeSelfCollected:{VAT:3},DeliveryOfTaxableGoodsSubjectToVAT:{VAT:4}}),
    form('2025-02',{})],'2025');
  assert.equal(series.rows[0]['PPN dipungut sendiri (PK)'],3);
  assert.equal(series.rows[1]['PPN dipungut sendiri (PK)'],null);
  assert.equal(series.rows.at(-1)['PPN dipungut sendiri (PK)'],null);
  assert.deepEqual(series.notes,[]);
});
