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

test('quality groups a repeated request limit only when pagination evidence supports it',()=>{
  const make=(path,source,sizes,overrides={})=>{
    const pages=sizes.map(size=>({IsSuccessful:true,Payload:{Data:Array(size).fill({}),TotalRecords:10000}}));
    const cap={sumber:source,baris:sizes.reduce((total,n)=>total+n,0),halaman:sizes.length,lengkap:true,
      total:null,payload:{Rows:10000,First:0},...overrides};
    return {path,cap,pages};
  };
  const entries=[
    make('ledger/empty','bb',[0]),make('ledger/short','bb',[3]),make('documents','dokumen',[8,0]),
    make('slips/partial','bplawan',[5]),make('ledger/confirmed-total','bb',[4],{total:10000}),
    make('ledger/request-mismatch','bb',[4],{payload:{Rows:50,First:0}}),
    make('ledger/next-page','bb',[1],{lengkap:false}),make('ledger/at-limit','bb',[10000]),
    make('ledger/limit-and-end','bb',[10000,0]),make('ledger/late-start','bb',[1],{payload:{Rows:10000,First:300}}),
    make('ledger/explicit-origin','bb',[1],{halamanSumber:[{pencocokan:{morePagesAvailable:true}}]}),
  ];
  const notes=qualityNotes({entries,report:{issues:[]},manifest:{cek:[{lvl:'sedang',kode:'MASA-KOSONG',teks:'Satu masa kosong.'}]}});
  const info=notes.filter(n=>n.Pemeriksaan==='Total respons sama dengan batas permintaan');
  assert.equal(info.length,1);assert.equal(info[0].Tingkat,'Info');assert.match(info[0].Hasil,/3 berkas/);
  const warnings=notes.filter(n=>n.Tingkat==='Peringatan').map(n=>n.Sumber);
  for(const file of ['slips/partial','ledger/confirmed-total','ledger/request-mismatch','ledger/next-page',
    'ledger/at-limit','ledger/late-start','ledger/explicit-origin'])assert.ok(warnings.includes(file),file);
  for(const file of ['ledger/empty','ledger/short','documents','ledger/limit-and-end'])assert.ok(!warnings.includes(file),file);
  assert.equal(notes.filter(n=>n.Pemeriksaan==='MASA-KOSONG').length,1);
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
