import assert from 'node:assert/strict';
import test from 'node:test';
import {probisPrograms,publicGuide} from '../extension/probis-guide.js';
import {probisRequests} from '../extension/analisis/work.js';
import {documentRows,validateIndexDocuments} from '../extension/analisis/kkp-index.js';

test('a procedure has a stable code, two document choices and an independent classification scope',()=>{
  assert.equal(probisPrograms.length,9);
  assert.equal(new Set(probisPrograms.map(g=>g.code)).size,9);
  for(const g of probisPrograms){
    assert.ok(g.title && g.check && g.flow && Array.isArray(g.coretaxSources));
    assert.equal(new Set(g.documents.map(([id])=>id)).size,2);
  }
  assert.equal(publicGuide('01111').code,'PB-PANEN');
  assert.equal(publicGuide('10110').code,'PB-PRODUKSI');
  assert.equal(publicGuide('Z2200').code,'PB-TRANSAKSI');
});

test('duplicate selections preserve follow-up and source, with atomic validation and scope guards',()=>{
  const data={manifest:{},report:{valid:true,manifestHash:'demo'},years:['2025','2024']};
  const idx={groups:[{key:'PPN/A'},{key:'PPN/B'}]};
  const work={rows:[],drafts:[],indexData:idx},state={pkg:data,year:'2025',work:new Map([[JSON.stringify(['demo','2025']),work]])};
  const wc=probisRequests(state),row={code:'01111',year:'2025'};
  assert.deepEqual(wc.add(row,'PPN/A',['panen','panen']).numbers,[1]);
  work.indexDocuments[0].status='Diterima';
  work.indexDocuments[0].name='Judul terbaru dari petugas';
  assert.equal(wc.add(row,'PPN/A',['panen']).added.length,0);
  assert.equal(work.indexDocuments[0].status,'Diterima');
  assert.equal(work.indexDocuments[0].name,'Judul terbaru dari petugas');
  assert.throws(()=>wc.add(row,'PPN/A',['stok','bukan-pilihan']),/Pilih dokumen/);
  assert.equal(work.indexDocuments.length,1);
  assert.deepEqual(wc.add(row,'PPN/B',['panen']).numbers,[2]);
  assert.deepEqual(validateIndexDocuments(work.indexDocuments,idx,'2025'),work.indexDocuments);
  assert.throws(()=>validateIndexDocuments(work.indexDocuments,idx,'2024'),/tahun/);
  assert.throws(()=>validateIndexDocuments([work.indexDocuments[0],{...work.indexDocuments[0],number:8}],idx,'2025'),/dua kali/);
  const {probis,...manual}=work.indexDocuments[0];
  assert.deepEqual(validateIndexDocuments([manual],idx,'2025'),[manual]);
  assert.equal(documentRows([manual])[0].length,7);
  const rows=documentRows(work.indexDocuments);
  assert.equal(rows[1][rows[0].indexOf('KLU acuan')],'01111');
  assert.equal(rows[1][rows[0].indexOf('Tahun pajak')],'2025');
  state.year='2024';assert.throws(()=>wc.add(row,'PPN/A',['stok']),/Paket atau tahun berubah/);
  state.year='2025';state.pkg={...data};assert.throws(()=>wc.add(row,'PPN/A',['stok']),/Paket atau tahun berubah/);
});
