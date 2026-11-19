import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCaptures} from '../scripts/compare-captures.mjs';

const wp='0000000000000017',periode={from:{y:2025,m:1},to:{y:2025,m:12}};
const bank=(path,rows)=>({path,cap:{sumber:'bank'},pages:[{Payload:{Data:rows}}]});
const pkg=(...entries)=>({entries,report:{valid:true},manifest:{wp:{npwp:wp},opsi:{periode}}});

test('the comparison pairs files by path and compares rows across page boundaries without losing duplicate, zero or blank values',()=>{
  const x={a:1,b:0},y={b:0,a:1},z={a:1,b:null};
  const ref=pkg(bank('bank/a',[x,z,x]),bank('bank/b',[x]),bank('bank/c',[x,x]),bank('bank/d',[x]),bank('bank/e',[]));
  const paged=bank('bank/a',[z]);paged.pages.push({Payload:{Data:[y,y]}});
  const miss=bank('bank/e',[]);miss.pages[0].IsSuccessful=false;
  const own=pkg(paged,bank('bank/b',[z]),bank('bank/c',[x]),bank('bank/f',[x]),miss);
  assert.deepEqual(compareCaptures(ref,own),{berkasAcuan:5,berkasPembanding:5,periodePilihan:'Sama',perSumber:[
    {sumber:'Rekening bank',hanyaAcuan:1,hanyaPembanding:1,berpasangan:4,kodeSumberBerbeda:0,responsSama:0,barisSama:1,barisBerbeda:2,barisBelumDapatDibandingkan:1}]});
});
test('the comparison identifies scope and integrity limitations and omits private paths, identities and row values',()=>{
  const entry=bank('bank/PRIVATE-DOCUMENT',['PRIVATE-ROW']);
  const ref=pkg(entry),own=pkg(structuredClone(entry));own.entries[0].cap.sumber='PRIVATE-CODE';
  own.manifest.opsi={};
  const out=compareCaptures(ref,own);assert.equal(out.periodePilihan,'Tidak dapat dipastikan');assert.equal(out.perSumber[0].kodeSumberBerbeda,1);
  assert.ok(!JSON.stringify(out).includes('PRIVATE'));assert.ok(!JSON.stringify(out).includes(wp));
  own.manifest.wp.npwp='0000000000000018';assert.throws(()=>compareCaptures(ref,own),/NPWP yang sama/);
  own.report.valid=false;assert.throws(()=>compareCaptures(ref,own),/Integritas/);
});

test('submitted SPT rows match across native and visible columns while retaining duplicates and unrecognized types',()=>{
  const entry=rows=>({path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:rows}}]});
  const native={ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'Normal',BpsNo:'0001'};
  const visible={'Jenis Surat Pemberitahuan Pajak':'SPT Masa PPN','Masa Pajak':'Januari 2025',
    'Model SPT':'Normal','Nomor Bukti Penerimaan':'0001'};
  const ref=pkg(entry([native,native,{...native,ReturnSheetTypeCode:'OTHER'}]));
  const own=pkg(entry([visible,{...visible,'Model SPT':'Pembetulan 1'},
    {...visible,'Jenis Surat Pemberitahuan Pajak':'Jenis lainnya'}]));
  Object.assign(ref.manifest.opsi,{sumber:['sptdaftar','bank'],jenisSpt:['VAT_VATR']});
  Object.assign(own.manifest.opsi,{sumber:['bank','sptdaftar'],jenisSpt:['VAT_VATR','ICT_WITR']});
  const result=compareCaptures(ref,own),source=result.perSumber[0];
  assert.equal(result.sumberPilihan,'Sama');
  assert.equal(result.jenisSptPilihan,'Berbeda');
  assert.equal(source.barisBerbeda,1);
  assert.deepEqual(source.pencocokanDaftar,{acuan:3,pembanding:3,cocok:1,berbedaAcuan:1,berbedaPembanding:1,
    belumDapatDipasangkanAcuan:1,belumDapatDipasangkanPembanding:1});
  assert.ok(!JSON.stringify(result).includes('0001'));
});

test('different capture ranges report SPT list coverage in the exact shared period',()=>{
  const entry=dates=>({path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:dates.map(TaxPeriodCode=>({
    TaxPeriodCode,ReturnSheetTypeCode:'VAT_VATR',ReturnSheetModel:'Normal'}))}}]});
  const ref=pkg(entry(['01012023','01012024','01012025','02022025','03032025']));
  const own=pkg(entry(['01012021','01012024','01012025','02022025','03032025']));
  ref.manifest.opsi.periode={from:{y:2023,m:1},to:{y:2025,m:2}};
  own.manifest.opsi.periode={from:{y:2024,m:1},to:{y:2025,m:12}};
  const result=compareCaptures(ref,own),source=result.perSumber[0];
  assert.equal(result.periodePilihan,'Berbeda');
  assert.deepEqual(result.periodeBersama,{from:{y:2024,m:1},to:{y:2025,m:2}});
  assert.equal(source.pencocokanDaftar.cocok,4);
  assert.equal(source.pencocokanDaftarPeriodeBersama.cocok,3);
  assert.equal(source.pencocokanDaftarPeriodeBersama.acuan,3);
});

test('documents match by the visible letter number, title and case without making blank numbers comparable',()=>{
  const listing=rows=>({path:'profil/dokumen.json',cap:{sumber:'dokumen'},pages:[{Payload:{Data:rows}}]});
  const native={DocumentNumber:'PRIVATE-NATIVE',LetterNumber:'PRIVATE-LETTER',DocumentTitle:'Dokumen uji',CaseNumber:'PRIVATE-CASE'};
  const visible={'NOMOR DOKUMEN':'PRIVATE-LETTER','JUDUL DOKUMEN':'Dokumen uji','NOMOR KASUS':'PRIVATE-CASE'};
  const reference=pkg(listing([native,native,{...native,LetterNumber:null}]));
  const candidate=pkg(listing([visible,{...visible,'NOMOR KASUS':'PRIVATE-OTHER'},{...visible,'NOMOR DOKUMEN':'-'}]));
  const result=compareCaptures(reference,candidate);
  assert.deepEqual(result.perSumber[0].pencocokanDokumen,{acuan:3,pembanding:3,cocok:1,berbedaAcuan:1,berbedaPembanding:1,
    belumDapatDipasangkanAcuan:1,belumDapatDipasangkanPembanding:1});
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('the SPOP list matches the Coretax caption and native form code with and without receipt numbers',()=>{
  const entry=rows=>({path:'spt/daftar.json',cap:{sumber:'sptdaftar'},pages:[{Payload:{Data:rows}}]});
  const native={ReturnSheetTypeCode:'LBT_LBTR',TaxPeriodCode:'01122025',ReturnSheetModel:'Normal',BpsNo:'SIMULASI'};
  const visible={'Jenis Surat Pemberitahuan Pajak':'Surat Pemberitahuan Objek Pajak Pajak Bumi dan Bangunan',
    'Masa Pajak':'Januari - Desember 2025','Model SPT':'Normal','Nomor Bukti Penerimaan':'SIMULASI'};
  const reference=pkg(entry([native,{...native,BpsNo:null}]));
  const candidate=pkg(entry([visible,{...visible,'Nomor Bukti Penerimaan':'—'}]));
  const source=compareCaptures(reference,candidate).perSumber[0];
  assert.equal(source.pencocokanDaftar.cocok,2);
  assert.equal(source.pencocokanDaftar.belumDapatDipasangkanPembanding,0);
  const conflicting={...visible,ReturnSheetTypeCode:'VAT_VATR'};
  assert.equal(compareCaptures(reference,pkg(entry([conflicting]))).perSumber[0].pencocokanDaftar.belumDapatDipasangkanPembanding,1);
});

test('SPT parts pair by the verified version and section across differing paths and form versus receipt numbers',()=>{
  const listing=(row)=>({path:'spt/daftar.json',cap:{sumber:'sptdaftar',konteks:{npwp:wp}},pages:[{Payload:{Data:[row]}}]});
  const part=(source,section,nomor,recordId,value)=>({path:'spt/PPN/2025-01/'+source+'/'+section+'.json',
    cap:{sumber:'sptisi',konteks:{npwp:wp,bagian:section,spt:{jenis:'VAT_VATR',masa:'01012025',pemb:0,npwp:wp,nomor,recordId}}},
    pages:[{Payload:{Data:[{Nilai:value}]}}]});
  const reference=pkg(listing({ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'Normal',
    RecordId:'PRIVATE-ID',ReturnSheetNumber:'PRIVATE-FORM',BpsNo:'PRIVATE-BPS',DocumentReceiptNumber:'PRIVATE-DOCUMENT-RECEIPT'}),
    part('p0_PRIVATE-ID','induk','PRIVATE-FORM','PRIVATE-ID',10),
    part('p0_PRIVATE-ID','a1','PRIVATE-FORM','PRIVATE-ID',0));
  const candidate=pkg(listing({'Jenis SPT':'Masa PPN','Masa Pajak':'Januari 2025','Model SPT':'Normal','Nomor Bukti Penerimaan':'PRIVATE-BPS'}),
    part('p0_cuplikan','induk','PRIVATE-BPS','',10),
    part('p0_cuplikan','a1','PRIVATE-BPS','',1),
    part('p0_tidak-cocok','a2','PRIVATE-OTHER','',5));
  const result=compareCaptures(reference,candidate).rincianSptPeriodeBersama;
  assert.equal(result.versiCocok,1);
  assert.deepEqual(result.bagian.induk,{acuan:1,pembanding:1,berpasangan:1,barisSama:1,barisBerbeda:0,
    barisBelumDapatDibandingkan:0,tanpaIdentitasAcuan:0,tanpaIdentitasPembanding:0});
  assert.deepEqual(result.bagian.lampiran,{acuan:1,pembanding:2,berpasangan:1,barisSama:0,barisBerbeda:1,
    barisBelumDapatDibandingkan:0,tanpaIdentitasAcuan:0,tanpaIdentitasPembanding:1});
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('ledger comparison matches localized amounts, preserves duplicate transactions and checks the two totals independently',()=>{
  const entry=(source,rows)=>({path:(source==='bb'?'bukubesar':'bukubesar-total')+'/2025-01.json',
    cap:{sumber:source},pages:[{Payload:{Data:rows}}]});
  const detail={TransactionNumber:'PRIVATE-TXN',ReferenceNumber:'PRIVATE-REF',Amount:1234};
  const visible={'Nomor Transaksi':'PRIVATE-TXN',Referensi:'PRIVATE-REF',Jumlah:'1.234,00'};
  const totals={Key:'Filtered',Debit:-1234,Credit:0,DebitLeft:0,CreditLeft:0,Balance:-1234};
  const screen={Key:'Filtered',Debit:'-1.234,00',Kredit:'0,00','Debit Tersisa':'0,00','Kredit Tersisa':'0,00',Saldo:'-1.234,00'};
  const balance=rows=>({...entry('bbsaldo',rows),path:'bukubesar-saldo.json'});
  const reference=pkg(entry('bb',[detail,detail,{...detail,Amount:0,Reference:'PRIVATE-ALTERNATE'}]),entry('bbtotal',[totals,{...totals,Key:'Total'}]),
    balance([{...totals,Key:'Total'},totals]));
  const candidate=pkg(entry('bb',[visible,{...visible,Referensi:'PRIVATE-OTHER'},{...visible,Jumlah:'—'},
    {...visible,Jumlah:'0,00',Referensi:'PRIVATE-ALTERNATE'}]),
    entry('bbtotal',[screen,{...screen,Key:'Total',Saldo:'-1.235,00','Debit Tersisa':'—'}]),balance([{...screen,Key:'Total'}]));
  const result=compareCaptures(reference,candidate);
  const [month]=result.perSumber.find(group=>group.pencocokanBukuBesar).pencocokanBukuBesar;
  assert.equal(month.nomorDanJumlah.cocok,3);
  assert.equal(month.termasukNomorRujukan.cocok,1);
  assert.equal(month.nomorDanJumlah.belumDapatDipasangkanPembanding,1);
  assert.deepEqual(month.referensiTampilan,{cocokNomorRujukan:0,cocokKolomReferensi:1,berbeda:0,belumDapatDibandingkan:3});
  const [saldo]=result.perSumber.find(group=>group.sumber==='Total pembanding buku besar').pencocokanSaldo;
  assert.deepEqual(saldo.baris,[{kelompok:'Total',angkaDapatDibandingkan:4,angkaCocok:3},
    {kelompok:'Filtered',angkaDapatDibandingkan:5,angkaCocok:5}]);
  assert.deepEqual(result.perSumber.find(group=>group.sumber==='Saldo seluruh periode').pencocokanSaldo,
    [{masa:'Seluruh periode',baris:[{kelompok:'Total',angkaDapatDibandingkan:5,angkaCocok:5},
      {kelompok:'Filtered',barisAcuan:1,barisPembanding:0,angkaDapatDibandingkan:0,angkaCocok:0}]}]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('paired PPh 21/26 attachments compare the certificate number, tax code, gross income and withholding',()=>{
  const jenis='ICT_WITR',masanya='01012025',nomor='PRIVATE-BPS';
  const listing={path:'spt/daftar.json',cap:{sumber:'sptdaftar',konteks:{npwp:wp}},
    pages:[{Payload:{Data:[{ReturnSheetTypeCode:jenis,TaxPeriodCode:masanya,ReturnSheetModel:'Normal',BpsNo:nomor}]}}]};
  const part=rows=>({path:'spt/PPH2126/2025-01/p00_simulasi/l1a.json',
    cap:{sumber:'sptisi',konteks:{npwp:wp,bagian:'l1a',spt:{jenis,masa:masanya,pemb:0,npwp:wp,nomor}}},
    pages:[{Payload:{Data:rows}}]});
  const native={WithholdingNumber:'PRIVATE-SLIP',TaxObjectCode:'21-100-01',GrossIncome:1500,IncomeTax:0};
  const visible={'NOMOR BUKTI POTONG':'PRIVATE-SLIP','KODE OBJEK PAJAK':'21-100-01',
    'PENGHASILAN BRUTO (Rp)':'1.500,00','PAJAK PENGHASILAN (Rp)':'0,00'};
  const result=compareCaptures(pkg(listing,part([native,native])),
    pkg(listing,part([visible,{...visible,'PAJAK PENGHASILAN (Rp)':'—'}]))).rincianSptPeriodeBersama;
  assert.deepEqual(result.bagian.lampiran.pencocokanBuktiPotong,{
    berkas:1,acuan:2,pembanding:2,cocok:1,berbedaAcuan:1,berbedaPembanding:0,
    belumDapatDipasangkanAcuan:0,belumDapatDipasangkanPembanding:1});
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
