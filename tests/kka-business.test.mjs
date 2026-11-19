import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kkaBusinessAppendices} from '../extension/analisis/kka-business.js';

const owner='0000000000000015';
const lookup=(report,label)=>report.rows.find(row=>row[0]===label)?.[1];
const entry=(sumber,path,data,npwp=owner)=>({path,cap:{sumber,lengkap:true,konteks:{npwp},baris:data.length,total:data.length},
  pages:[{Payload:{Data:data}}]});
const klu=(code,ValidFrom='2021-01-01',ValidTo='',IsMainEconomicCode=true)=>({
  TradeClassificationCode:code,ActivityDescription:'Kegiatan '+code,IsMainEconomicCode,ValidFrom,ValidTo
});
const history=(rows,npwp)=>entry('klu','profil/klu.json',rows,npwp);
const profile=(code,since,npwp=owner)=>entry('info','profil/informasi-umum.json',[
  {GeneralInformation:{UniqueIdentificationNumber:npwp},MainEconomicCode:klu(code,since)}
]);
const pkg=entries=>({manifest:{wp:{npwp:owner},dibuat:'2026-07-03T04:00:00Z'},entries,report:{valid:true}});

test('KKA takes the registered primary relevant to the work year and keeps additional and expired rows in Excel',()=>{
  const p=pkg([history([klu('01111','2021-01-01','2024-12-31'),klu('61101','01-01-2025','','true'),klu('01112','2020-01-01','',false)])]);
  const [l3a,l3b]=kkaBusinessAppendices(p,'2025');
  assert.equal(lookup(l3a,'KLU utama pada tahun pilihan'),'61101');
  assert.equal(lookup(l3a,'Baris riwayat KLU terbaca'),3);
  assert.ok(l3a.workbook.rows.find(r=>r[0]==='01111').includes('2024-12-31'));
  assert.ok(l3a.workbook.rows.find(r=>r[0]==='01112').includes(false));
  assert.equal(lookup(l3b,'KLU acuan'),'61101');
  assert.equal(lookup(kkaBusinessAppendices(p,'2024')[0],'KLU utama pada tahun pilihan'),'01111');
});

test('KKA exposes a dated profile as fallback without presenting a full registry history',()=>{
  const p=pkg([history([]),profile('01111','2024-01-01')]);
  const [l3a,l3b]=kkaBusinessAppendices(p,2025);
  assert.equal(lookup(l3a,'Baris riwayat KLU terbaca'),0);
  assert.equal(lookup(l3a,'KLU utama pada tahun pilihan'),null);
  assert.equal(lookup(l3a,'KLU utama pada profil paket'),'01111');
  assert.ok(l3a.workbook.rows.find(r=>r[0]==='01111').includes('2024-01-01'));
  assert.match(lookup(l3b,'Dasar pemilihan'),/profil/i);
  assert.equal(lookup(l3b,'KLU acuan'),'01111');
  assert.equal(lookup(kkaBusinessAppendices(p,2023)[1],'KLU acuan'),undefined);
  assert.equal(lookup(kkaBusinessAppendices(p,2027)[1],'KLU acuan'),undefined);
  const [ambiguous]=kkaBusinessAppendices(pkg([profile('01111','2024-01-01','0000000000000016')]),2025);
  assert.equal(lookup(ambiguous,'KLU utama pada profil paket'),null);
});

test('KKA withholds unverified and competing registry choices while preserving explicit saved work',()=>{
  const invalid=history([]);invalid.pages[0].Payload=null;
  assert.equal(lookup(kkaBusinessAppendices(pkg([invalid]),2025)[0],'Baris riwayat KLU terbaca'),null);
  const entries=[history([klu('01111')],'0000000000000016'),
    history([klu('61101','2021-01-01','31-02-2026')])];
  const p=pkg(entries);
  const before=kkaBusinessAppendices(p,2025);
  assert.equal(lookup(before[0],'KLU utama pada tahun pilihan'),null);
  assert.equal(lookup(before[1],'KLU acuan'),undefined);
  const conflict=kkaBusinessAppendices(pkg([history([klu('01111'),klu('61101')])]),2025);
  assert.equal(lookup(conflict[1],'KLU acuan'),undefined);
  const probis={klu:'01111',edition:'2025',year:'2025',procedure:'PB-PANEN',document:'panen',
    check:'Bandingkan catatan jumlah panen, stok dan penjualan untuk periode yang sama.'};
  const work={business:{reference:{code:'01111',edition:'2025'},
    activity:{kind:'WP dengan beberapa kegiatan',edition:'2025',activities:[{code:'01111',name:'Kegiatan',amount:'0'}],
      evidence:'Rujukan fiktif',conclusion:''}},indexDocuments:[
    {number:1,index:'PPN/N',name:'Rekap',status:'Diminta',probis},
    {number:2,index:'PPN/N',name:'Dokumen lain',probis:{...probis,year:'2024'}}
  ]};
  const [l3a,l3b]=kkaBusinessAppendices(p,2025,work);
  assert.equal(lookup(l3a,'Acuan petugas'),'01111');
  assert.equal(lookup(l3a,'Uji kegiatan tersimpan'),'2024');
  assert.ok(l3a.workbook.rows.flat().includes(0));
  assert.ok(l3a.workbook.rows.flat().includes('Rujukan fiktif'));
  assert.equal(lookup(l3b,'Permintaan dokumen tersimpan'),1);
  assert.ok(l3b.workbook.rows.flat().includes('DOK.1'));
  assert.ok(!l3b.workbook.rows.flat().includes('DOK.2'));
});
