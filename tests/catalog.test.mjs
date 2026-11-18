import assert from 'node:assert/strict';
import test from 'node:test';
import {kbli} from '../extension/catalog-data.js';
import {regulations} from '../extension/regulation-data.js';
import {activityResult} from '../extension/catalog.js';

test('BPS editions retain their published hierarchy, leading zeroes and complete multiline names',()=>{
  for(const [year,expected] of [['2020',[21,88,245,567,1789]],['2025',[22,87,257,519,1559]]]){
    const keys=Object.keys(kbli[year]);
    assert.deepEqual([1,2,3,4,5].map(n=>keys.filter(k=>k.length===n).length),expected);
    for(const key of keys.filter(k=>k.length>2)) assert.ok(kbli[year][key.slice(0,-1)],key);
  }
  assert.equal(kbli['2025']['01111'],'PERTANIAN JAGUNG');
  assert.match(kbli['2025']['10295'],/DENGAN FERMENTASI$/);
  assert.match(kbli['2020']['99000'],/INTERNASIONAL LAINNYA$/);
});

test('published regulation metadata links directly to official documents',()=>{
  assert.ok(regulations.length>0);
  assert.equal(new Set(regulations.map(r=>r[5])).size,regulations.length);
  for(const r of regulations){
    assert.equal(r.length,6); assert.ok(r.every(Boolean));
    assert.equal(new URL(r[5]).origin,'https://www.pajak.go.id');
    assert.match(r[3],/^\d{4}-\d{2}-\d{2}$/);
  }
});

test('KLU comparison preserves integer precision, ties, zero and statutory exceptions',()=>{
  const rows=[{name:'A',amount:'99999999999999999'},{name:'B',amount:'100000000000000000'}];
  assert.match(activityResult(rows,''),/terbesar: B/);
  assert.match(activityResult([...rows,rows[1]],''),/sama/);
  assert.match(activityResult([{name:'A',amount:'0'}],''),/belum berjalan/);
  assert.match(activityResult([{name:'A',amount:''}],'regular'),/Isi setiap/);
  assert.match(activityResult([],'Badan nirlaba'),/kegiatan/);
  assert.match(activityResult([],'Instansi pemerintah'),/administrasi pemerintahan/);
});
