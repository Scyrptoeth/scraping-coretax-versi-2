import test from 'node:test';
import assert from 'node:assert/strict';
import {kluAttachment,kluZ} from '../extension/klu-z.js';

test('contains the five printed levels and every group from section A of the DJP attachment',()=>{
  const codes=Object.keys(kluZ);
  assert.deepEqual([1,2,3,4,5].map(n=>codes.filter(code=>code.length===n).length),[1,9,14,18,18]);
  assert.deepEqual(codes.filter(code=>code.length===5).sort(),
    'Z1110 Z1120 Z1210 Z1220 Z1230 Z1240 Z1300 Z1900 Z2100 Z2200 Z3000 Z4000 Z5000 Z6000 Z7100 Z7200 Z8000 Z9000'.split(' '));
  for(const code of codes) {
    assert.match(code,/^Z\d{0,4}$/);
    if(code!=='Z')assert.ok(kluZ[code.slice(0,-1)]?.title,code);
    const {first,last}=kluZ[code];
    assert.ok(first>=1 && last<=5 && first<=last);
  }
});

test('retains cross-page names, distinct pension labels and direct attribution',()=>{
  assert.equal(kluZ.Z2200.title,'PEGAWAI PEMERINTAH DENGAN PERJANJIAN KERJA');
  assert.deepEqual([kluZ.Z2200.first,kluZ.Z2200.last],[3,4]);
  assert.deepEqual([kluZ.Z7100.first,kluZ.Z7100.last],[4,5]);
  assert.equal(kluZ.Z7.title,'PEJABAT/PEGAWAI PERWAKILAN NEGARA ASING DAN ORGANISASI ATAU BADAN INTERNASIONAL');
  assert.equal(kluZ.Z60.title,'PENSIUNAN PNS/TNI/POLRI');
  assert.equal(kluZ.Z6000.title,'PENSIUNAN PNS/PRAJURIT TNI/ANGGOTA POLRI');
  assert.equal(kluZ.Z9000.title,'PEGAWAI LAINNYA YTDL');
  assert.equal(new URL(kluAttachment).origin,'https://www.pajak.go.id');
});
