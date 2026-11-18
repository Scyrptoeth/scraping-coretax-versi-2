import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activeRateUpdate,readRateUpdate,rateForMonth,useRateUpdate} from '../extension/analisis/rate-updates.js';
import {simulate,simulationTables} from '../extension/analisis/sanksi.js';

const change={format:'SEDOTAX-REGULASI',versi:'1',tanggal:'2026-01-01',sumber:'Penguji fiktif',
  tarif:{'2026-01':{kmk:'UJI-01',p13_2:2.25},'2026-02':{_hapus:true}},program:[{kode:'tidak diterapkan'}]};
const example={tax:'PPN',article:'interest',period:'2025-12',principal:'100000',basis:'Uji fiktif',transfers:[]};
test('a local update has no effect until applied and its origin follows the simulated amount',()=>{
  const base=rateForMonth('2026-01');
  const parsed=readRateUpdate(change);
  assert.equal(parsed.rates.size,2);
  assert.equal(activeRateUpdate(),null);
  assert.equal(rateForMonth('2026-01'),base);
  try{
    useRateUpdate(change);
    assert.equal(simulate(example,'2026-01-03').interest,22500000n);
    const tables=simulationTables({end:'2026-01-03',cases:[example]});
    assert.match(tables.detail[0]['Sumber tarif sesi'],/UJI-01/);
    assert.equal(tables.references.at(-1)['Pembaruan pengguna'],'Penguji fiktif · 2026-01-01');
    assert.equal(rateForMonth('2026-02'),null);
    assert.ok(rateForMonth('2026-03'));
    assert.throws(()=>useRateUpdate({...change,tarif:{'2026-00':{kmk:'UJI-02',p13_2:2}}}));
    assert.equal(rateForMonth('2026-01').basisPoints,225);
  }finally{useRateUpdate(null);}
  assert.equal(rateForMonth('2026-01'),base);
});
test('incomplete, malformed and ambiguous rate inputs cannot replace the active rates',()=>{
  const one=(item)=>({...change,tarif:{'2026-01':item}});
  for(const item of [{p13_2:0.123,kmk:'UJI-01'},{kmk:'nomor KMK',p13_2:0},{p13_2:'1.00',kmk:'UJI-01'},{p9:1.00},
    {p13_2:1.10,kmk:'UJI-01',url:'file:///lokal'}])assert.throws(()=>readRateUpdate(one(item)));
  assert.throws(()=>readRateUpdate({...change,tanggal:'2026-02-30'}));
  assert.equal(readRateUpdate(one({kmk:'UJI-01',p13_2:0})).rates.get('2026-01').basisPoints,0);
});
