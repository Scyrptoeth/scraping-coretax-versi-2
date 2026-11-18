import assert from 'node:assert/strict';
import {test} from 'node:test';
import {monthlyRates} from '../extension/analisis/tarif-sanksi.js';
import {simulate,simulationTables,validateSimulation} from '../extension/analisis/sanksi.js';

const base={tax:'PPN',article:'interest',period:'2025-12',principal:'100000000',basis:'Kertas kerja sintetis',transfers:[]};
test('published rates cover all 47 distinct months and use the first month, including rollover',()=>{
  assert.equal(monthlyRates.size,47);
  for(let i=0;i<47;i++){
    const key=new Date(Date.UTC(2023,i,1)).toISOString().slice(0,7),r=monthlyRates.get(key);
    assert.ok(Number.isInteger(r?.basisPoints));assert.ok(r.decision);assert.match(r.url,/^https:\/\/(www.pajak.go.id|jdih.kemenkeu.go.id)\//);
  }
  assert.equal(monthlyRates.get('2023-01').basisPoints,183);
  assert.equal(monthlyRates.get('2026-11').basisPoints,186);
  const out=simulate(base,'2026-11-18');
  assert.equal(out.start,'2026-01-01');assert.equal(out.months,11);assert.equal(out.rate.basisPoints,177);
  assert.equal(out.interest,19470000n*10000n);
  assert.equal(simulate({...base,period:'2026-11'},'2026-12-01').sanction,null);
});
test('calendar month portions, statutory upper bound, leap month and five-year general window',()=>{
  const r={...base,period:'2024-01',principal:'1'};
  assert.equal(simulate(r,'2024-02-01').months,1);
  assert.equal(simulate(r,'2024-02-29').months,1);
  assert.equal(simulate(r,'2024-03-01').months,2);
  assert.equal(simulate(r,'2026-05-10').months,24);
  assert.equal(simulate(r,'2024-01-31').total,null);
  assert.equal(simulate(r,'2025-02-29').months,null);
  assert.equal(simulate(r,'2029-01-31').months,24);
  assert.equal(simulate(r,'2029-02-01').total,null);
});
test('separate interest and actually compensated bases, choose only the greater sanction per assessment',()=>{
  const both={...base,article:'compare',transfers:[{to:'2026-01',amount:'7000000'},{to:'2026-02',amount:'3000000'}]};
  const x=simulate(both,'2026-12-15');
  assert.equal(x.principal,110000000n*10000n);
  assert.equal(x.interest,21240000n*10000n);
  assert.equal(x.increase,7500000n*10000n);
  assert.equal(x.total,131240000n*10000n);
  assert.equal(simulate(both,'2026-02-02').sanction,x.increase);
  assert.equal(simulate({...both,principal:'0',transfers:[{to:'2026-01',amount:'0'}]},'2026-02-01').total,0n);
  assert.equal(simulate({...both,article:'increase',principal:''},'2026-12-15').total,17500000n*10000n);
  assert.equal(simulate({...both,transfers:[]},'2026-12-15').sanction,null);
  assert.equal(simulate(both,'2026-01-18').total,null);
});
test('empty inputs, duplicate assessments or allocations, and precision survive export and import',()=>{
  assert.deepEqual(validateSimulation(undefined,'2025'),{end:'',cases:[]});
  const empty={...base,period:'2025-01',principal:''};
  assert.throws(()=>validateSimulation({end:'',cases:[base,base]},'2025'),/Gabungkan/);
  assert.throws(()=>validateSimulation({end:'',cases:[base]},'2026'),/tahun/);
  assert.throws(()=>simulate({...base,principal:'-1'},'2026-04-01'),/simulasi/);
  assert.throws(()=>simulate({...base,article:'compare',transfers:Array(2).fill({to:'2026-01',amount:'10'})},'2026-04-01'),/sekali/);
  assert.throws(()=>simulate({...base,tax:'PPh Badan',article:'increase',principal:''},'2026-04-01'),/hanya berlaku/);
  assert.equal(simulate({...base,basis:'  '},'2026-03-01').total,null);
  const x=simulationTables({end:'2026-01-31',cases:[{...base,principal:'1'},empty]});
  assert.equal(x.detail[0]['Bunga (Rp)'],0.0177);
  assert.equal(x.detail[1]['Dasar bunga (Rp)'],null);
  assert.equal(x.summary[0]['Pokok + sanksi (Rp)'],null);
  assert.equal(x.summary[0]['Belum dapat dihitung'],1);
  const big=simulationTables({end:'2026-01-31',cases:[{...base,principal:'999999999999999999'}]});
  assert.equal(big.detail[0]['Pokok (Rp)'],'999999999999999999');
});
