import assert from 'node:assert/strict';
import test from 'node:test';
import {createPackage,readPackage} from '../extension/archive/package.js';
import {sourceCoverage} from '../extension/archive/source-coverage.js';

const entry=(path,sumber,lengkap)=>({path,cap:{sumber,lengkap,baris:0},pages:[{Payload:{Data:[],TotalRecords:0}}]});
const wp={nama:'Contoh fiktif',npwp:'0000000000000001'};

test('the normal ZIP and its minutes distinguish a selected missing source from an empty captured source',async()=>{
  const entries=[entry('profil/bank.json','bank',true),entry('buku/masa.json','bb',false)];
  const pkg=await readPackage(await createPackage({meta:{wp,opsi:{sumber:['bank','bb','sptisi','sptisi']}},entries}));
  assert.equal(pkg.report.valid,true);
  const rows=sourceCoverage(pkg.manifest,pkg.entries);
  assert.deepEqual(rows.map(r=>[r['Pilihan penarik'],r['Berkas di manifest'],r['Berkas terbaca'],r['Berkas ditandai lengkap']]),
    [['Dipilih',1,1,1],['Dipilih',1,1,0],['Dipilih',0,0,0]]);
  assert.match(pkg.minutes,/Induk dan lampiran SPT: Belum ada berkas dalam paket \(0 berkas\)/);
  assert.match(pkg.minutes,/Rekening bank: Semua berkas yang tercantum terbaca \(1 berkas\)/);
});
test('older archives preserve unknown selections, declared missing files and conflicting source labels',()=>{
  const entries=[entry('source/a.json','bank',true),entry('source/b.json','info',false)];
  const manifest={files:[{path:'source/a.json'},{path:'source/b.json',sumber:'bb'},{path:'source/c.json',sumber:'sptdaftar'}]};
  const rows=sourceCoverage(manifest,entries);
  assert.ok(rows.every(r=>r['Pilihan penarik']==='Tidak tercatat'));
  assert.equal(rows[0].Sumber,'Rekening bank');
  assert.match(rows[1].Hasil,/berbeda dari manifest/);
  assert.match(rows[2].Hasil,/tidak terbaca/);
});
