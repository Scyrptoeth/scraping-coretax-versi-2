import test from 'node:test';
import assert from 'node:assert/strict';
import {codeTitle,hierarchicalKlu,percentage} from '../extension/klu-calculator.js';

const evaluate=pairs=>hierarchicalKlu(pairs.map(([code,amount])=>({code,amount:String(amount)})));
const examples=[
  [['25120',7000],['28160',8000],['28210',3000],['28221',21000],['28240',8000],['29300',5000],['46100',7000],['46591',28000],['71102',13000]],
  [['46511',10000],['47411',8000],['47420',15000],['47592',4000],['47611',3000],['47620',12000],['47913',35000],['77220',13000]]
];

test('official example 1 follows the detailed allocations on pages 7–10',()=>{
  const r=evaluate(examples[0]);
  assert.equal(r.total,100000n);assert.equal(r.code,'28221');
  assert.deepEqual(r.steps.map(s=>s.winner),['C','28','282','2822','28221']);
  assert.deepEqual(r.steps.map(s=>s.candidates[0].amount),[52000n,40000n,32000n,21000n,21000n]);
});

test('official example 2 selects shop sales and checks 5% of division 47, before selecting 47420',()=>{
  const r=evaluate(examples[1]);
  assert.equal(r.total,100000n);assert.equal(r.code,'47420');
  assert.deepEqual(r.steps.map(s=>s.winner),['G','47','471–477 · Eceran di toko','','474','4742','47420']);
  const assessment=r.steps.find(s=>s.divisionShare);
  assert.equal(assessment.base,77000n);assert.match(assessment.note,/4 subgolongan/);
  assert.equal(percentage(4000n,assessment.base),'5,19%');
  assert.equal(r.steps.find(s=>s.winner==='474').candidates[0].amount,23000n);
});

test('handles trade channels, thresholds, a tie, and a missing non-specialized product group',()=>{
  assert.equal(evaluate([['46100',60],['46511',40]]).code,'46100');
  assert.equal(evaluate([['46100',25],['46511',75]]).code,'46511');
  assert.equal(evaluate([['47420',40],['47913',60]]).code,'47913');
  assert.equal(evaluate([['46511',55],['46900',45]]).code,'46511');
  assert.equal(evaluate([['46511',45],['46900',55]]).code,'46900');
  assert.equal(evaluate([['47111',32],['47191',28],['47913',40]]).code,'47111');
  assert.match(evaluate([['46511',50],['46900',50]]).message,/masing-masing mencapai 50%/);
  const sparse=evaluate([['47411',20],['47420',20],['47592',20],['47611',20],['47620',20]]);
  assert.equal(sparse.code,'');assert.match(sparse.message,/barang nonkhusus.*belum tersedia/);
  assert.equal(sparse.steps.at(-1).base,100n);
});

test('preserves large amounts, leading zeroes and duplicate codes, and explains ties or incomplete input',()=>{
  const p=evaluate([['01111',9007199254740993n],['01111',1n],['Z5000',9007199254740993n]]);
  assert.equal(p.code,'01111');assert.equal(p.steps[0].candidates[0].amount,9007199254740994n);
  assert.match(codeTitle(p.code),/JAGUNG/);
  assert.equal(evaluate([['z5000',123]]).code,'Z5000');
  assert.equal(evaluate([['28210',10],['28221',10]]).code,'');
  assert.match(evaluate([['28210',10],['28221',10]]).message,/subgolongan sama/);
  assert.match(evaluate([['00000',5]]).message,/Baris 1/);
  assert.match(evaluate([['01111','12.50']]).message,/rupiah utuh/);
  assert.match(evaluate([['01111',0]]).message,/Seluruh nilai nol/);
  assert.match(evaluate([]).message,/Tambahkan/);
});
