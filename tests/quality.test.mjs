import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSourceRows,qualityNotes} from '../extension/analisis/quality.js';
import {combinedLedger} from '../extension/analisis/ledger-table.js';

test('monthly ledger keeps partial identifiers and conflicting source records',()=>{
  const entry=(path,rows)=>({path,pages:[{Payload:{Data:rows}}]});
  const a={RecordId:'001',Amount:0}, b={Amount:0,RecordId:'001'}, missing={Amount:0};
  const result=combinedLedger([entry('bukubesar/2025-01.json',[a,missing]),entry('bukubesar/2025-02.json',[b,missing,{...a,Amount:1}]),
    entry('bukubesar-total/2025-01.json',[a])]);
  assert.equal(result.sourceCount,2);assert.equal(result.omitted,1);assert.equal(result.conflicting,1);
  assert.equal(result.rows.length,4);assert.equal(result.rows[0]['Berkas sumber'],'bukubesar/2025-01.json, bukubesar/2025-02.json');
});

test('quality separates source coverage, empty periods and integrity from numeric zero',()=>{
  const pkg={report:{issues:['Checksum mismatch']},manifest:{cek:[{lvl:'sedang',kode:'MASA-KOSONG',teks:'Satu masa kosong.'},
    {tingkat:'TINGGI',pesan:'Jumlah berbeda.'}]},entries:[
    {path:'spt/daftar.json',cap:{halaman:2,baris:3,total:10,lengkap:false,halamanSumber:[{
      asal:'Daftar',baris:2,pencocokan:{pageRows:[2],morePagesAvailable:true}}]},pages:[{Payload:{Data:[{},{}],TotalRecords:10}}]},
    {path:'spt/arsip.json',cap:{baris:0,total:0,lengkap:true,halaman:1},pages:[{Payload:{Data:[],TotalRecords:0}}]}]};
  const notes=qualityNotes(pkg);
  assert.equal(notes[0].Tingkat,'Kritis');
  assert.equal(notes.some(n=>n.Pemeriksaan==='MASA-KOSONG'&&n.Tingkat==='Peringatan'),true);
  assert.equal(notes.some(n=>n.Hasil==='Jumlah berbeda.'&&n.Tingkat==='Kritis'),true);
  assert.equal(notes.filter(n=>n.Sumber==='spt/arsip.json').length,0);
  for(const name of ['Batas halaman tercapai','Jumlah baris tersimpan','Jumlah baris menurut sumber','Jumlah halaman'])
    assert.ok(notes.some(n=>n.Pemeriksaan===name));
});

test('comparison preserves order, duplicate rows, leading zeros and column coverage',()=>{
  const source=[{ID:'001',N:'0'},{ID:'001',N:'0'},{ID:'002',N:''}];
  const target=[{Kode:'001',Nilai:0},{Kode:'001',Nilai:0},{Kode:'002',Nilai:''}];
  const pairs={ID:'Kode',N:'Nilai'};
  assert.equal(compareSourceRows(source,target,pairs).complete,true);
  assert.equal(compareSourceRows(source,target,{...pairs,N:''}).complete,false);
  assert.equal(compareSourceRows(source,target.slice(1),pairs).differences.length,3);
  const numeric=compareSourceRows(source,[{Kode:1,Nilai:0},target[1],{Kode:'002',Nilai:null}],pairs);
  assert.equal(numeric.equal,4);
  assert.equal(numeric.differences[1].Keterangan,'Nilai null di paket');
  assert.throws(()=>compareSourceRows(source,target,{ID:'Kode',N:'Kode'}),/satu kali/);
});
