import assert from 'node:assert/strict';
import test from 'node:test';
import {indexPackage} from '../extension/analisis/model.js';
import {eventsFor,linksFor} from '../extension/analisis/advanced-dashboard.js';

const entry=(path,...data)=>({path,cap:{lengkap:true},pages:[{Payload:{Data:data}}]});
const pkg=entries=>indexPackage({manifest:{wp:{nama:'Contoh'}},entries});

test('timeline uses SPT tax year apart from calendar dates and excludes cancelled notices and invalid dates',()=>{
  const p=pkg([
    entry('profil/informasi-umum.json',{GeneralInformation:{RegistrationDate:'2012-06-18',ActivationDate:'2025-02-30'}}),
    entry('profil/flag-wp.json',{FlagType:'PKP',FlagValue:false,ValidFrom:'2025-01-01'},{FlagType:'Cek',FlagValue:true,ValidFrom:'2025-02-02'}),
    entry('spt/daftar.json',{ReturnDate:'2026-03-01',ExpectedReturnDate:'2026-02-28',TaxPeriodCode:'12122025',ReturnSheetModel:'Normal',DocumentReceiptNumber:'A'},
      {ReturnDate:'2025-02-12',TaxPeriodCode:'12122024',ReturnSheetModel:'Amendment'}),
    entry('bukubesar/2025-01.json',{AccountingTypeCode:'TaxNotice',PostingDate:'2025-01-19',ReferenceNumber:'t1',PeriodCode:'01012025'},
      {AccountingTypeCode:'TaxNotice',IsCancelled:true,PostingDate:'2025-01-19',ReferenceNumber:'cancelled',PeriodCode:'01012025'}),
    entry('profil/dokumen.json',{DocumentDate:'0001-01-01',DocumentTitle:'invalid'})
  ]);
  const events=eventsFor(p,'2025');assert.deepEqual(events.map(e=>e.Tanggal),['2012-06-18','2025-01-19','2025-02-02','2026-03-01']);
  assert.equal(events.at(-1).Kelompok,'SPT melewati tanggal pada sumber');assert.equal(events.at(-1).Rujukan,'A');
});

test('relationship map uses latest unambiguous VAT, top six ranked partners, dated registry and explicit source identities',()=>{
  const cases=Array.from({length:7},(_,i)=>({Name:i===6?'PT. Abjad':'Contoh '+i,TIN:'ID'+i,TaxBase:i*50,VAT:i}));
  const p=pkg([
    entry('profil/pihak-terkait.json',{PersonName:'Abjad',PersonNIKTIN:'P1',ValidFrom:'2025-01-01'}),
    entry('profil/alamat.json',{TypeOfAddress:'TKU',AddressDetail:'Lokasi contoh',LandLordName:'Pemilik',ValidFrom:'2020-01-01'}, {TypeOfAddress:'TKU',AddressDetail:'Kedaluwarsa',ValidTo:'2024-12-31'}),
    entry('spt/PPN/2025-01/p00_a/a2.json',{Name:'Lama',TIN:'OLD',TaxBase:999}),entry('spt/PPN/2025-01/p01_b/a2.json',...cases),
    entry('spt/PPN/2025-02/p01_c/b2.json',{Name:'Tidak unik',TIN:'DUP1',TaxBase:1000}),entry('spt/PPN/2025-02/p01_d/b2.json',{Name:'Tidak unik',TIN:'DUP2',TaxBase:1000}),
    entry('bukti-potong-lawan/2025.json',{WitholderName:'Pemotong contoh',WitholderTin:'T1',TaxPeriodCode:'01012025',TaxBase:0})
  ]);
  const links=linksFor(p,'2025'),buyers=links.filter(r=>r.Jenis==='Pembeli');
  assert.equal(buyers.length,6);assert.equal(buyers[0]['Nama pihak'],'PT. Abjad');assert.equal(buyers[0]['Dasar pengenaan'],300);
  const linked=links.filter(r=>r.Jenis.startsWith('Nama serupa'));assert.equal(linked.length,1);assert.equal(linked[0].Dari,'Abjad');assert.equal(linked[0].Ke,'PT. Abjad');
  assert.match(linked[0]['Berkas sumber'],/pihak-terkait.json\nspt\/PPN/);
  assert.equal(links.filter(r=>r.Jenis==='Pemasok').length,0);assert.equal(links.find(r=>r.Jenis==='Pemotong')['Dasar pengenaan'],0);
  assert.doesNotMatch(JSON.stringify(links),/Kedaluwarsa|DUP1|DUP2|OLD/);
});
