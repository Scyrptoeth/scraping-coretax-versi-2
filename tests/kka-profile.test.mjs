import test from 'node:test';
import assert from 'node:assert/strict';
import {kkaProfileAppendix} from '../extension/analisis/kka-profile.js';
import {profileLoginDay} from '../extension/analisis/profile-overview.js';

const owner='0000000000000071';
const other='0000000000000072';
const entry=(source,path,rows,npwp=owner)=>({
  path:'profil/'+path+'.json',cap:{sumber:source,konteks:{npwp}},pages:[{Payload:{Data:rows}}]
});
const build=(entries,dibuat='2025-12-17')=>({
  report:{valid:true},manifest:{wp:{npwp:owner,nama:'WP fiktif'},dibuat},entries
});
const details=result=>new Map(result.workbook.rows.map(row=>[row[1],row.slice(2)]));

test('KKA L-1 uses the snapshot date, keeps explicit zero and records sources per field',()=>{
  const pkg=build([
    entry('info','informasi-umum',[{
      GeneralInformation:{UniqueIdentificationNumber:owner,TaxpayerType:'TA002',TaxpayerStatus:'ACTIVE',
        NumberofStaff:0,ForecastedAnnualTurnover:0,TaxpayerCategory:'C_LC',Password:'rahasia-fiktif',
        TaxablePersonForVATPurposesStatus:0},
      MainAddress:{AddressDetail:'Alamat fiktif',Rt:'002',Rw:'001',City:'Kota Fiktif',PostalCode:'12345',
        SupervisionName:'SUPERVISION_SECTION_II',PicName:null},
      MainBankAccount:{BankAccountNumber:'REKENING-FIKTIF',Name:'REKENING-NAMA-FIKTIF'}
    }]),
    entry('alamat','alamat',[{TypeOfAddress:'MAIN',FullAddressDetail:'Alamat fiktif',
      PicName:'PIC fiktif',SupervisionCode:'SUPERVISION_SECTION_II',ValidFrom:'2024-01-01'}]),
    entry('klu','klu',[{IsMainEconomicCode:true,TradeClassificationCode:'62019',
      ActivityDescription:'Kegiatan fiktif',ValidFrom:'2024-01-01'}]),
    entry('jenispajak','jenis-pajak',[
      {TaxTypeCode:'VAT_VAT',TaxStatusCode:'Registered',RegistrationDate:'2024-04-12'},
      {TaxTypeCode:'ICT_WIT',TaxStatusCode:'Registered',RegistrationDate:'2026-01-01'}
    ]),
    entry('login','login-terakhir',[{Message:{LastSuccessfulLogin:'11/5/2025 17:41:20'}}])
  ]);
  const result=kkaProfileAppendix(pkg,'2023'),fields=details(result);
  assert.deepEqual(result.rows.find(row=>row[0]==='Tanggal potret profil'),['Tanggal potret profil','2025-12-17','Manifest paket']);
  assert.ok(result.workbook.rows.some(row=>row[0]==='Tahun analisis'&&row[1]==='2023'));
  for(const [label,value,path] of [
    ['Nama','WP fiktif','Manifest paket'],['NPWP',owner,'profil/informasi-umum.json'],
    ['Alamat utama','Alamat fiktif, RT 002, RW 001, Kota Fiktif, 12345','profil/informasi-umum.json'],
    ['Unit pengawasan pada alamat utama','Seksi Pengawasan II','profil/informasi-umum.json'],
    ['KLU utama','62019 · Kegiatan fiktif','profil/klu.json'],
    ['Penanggung jawab lokasi utama','PIC fiktif','profil/alamat.json'],
    ['Status PKP','PKP','profil/jenis-pajak.json'],
    ['Tanggal pengukuhan PKP','12-04-2024','profil/jenis-pajak.json'],
    ['Login terakhir di Coretax','05-11-2025','profil/login-terakhir.json'],
    ['Status hukum','Perseroan terbatas (PT)','profil/informasi-umum.json'],
    ['Jumlah pegawai',0,'profil/informasi-umum.json'],['Perkiraan peredaran',0,'profil/informasi-umum.json']
  ])assert.deepEqual(fields.get(label),[value,path],label);
  assert.deepEqual(result.rows.find(row=>row[0]==='Unit pengawasan pada alamat utama'),
    ['Unit pengawasan pada alamat utama','Seksi Pengawasan II','profil/informasi-umum.json']);
  assert.ok(result.workbook.rows.some(row=>row[0]==='PPN'&&row[1]==='VAT_VAT'));
  assert.ok(!result.workbook.rows.some(row=>row[1]==='ICT_WIT'));
  assert.doesNotMatch(JSON.stringify(result),/REKENING|rahasia-fiktif/);
});

test('L-1 withholds conflicts, failed pages, undated registry conclusions, and values from another WP',()=>{
  const pkg=build([
    entry('info','informasi-umum',[{GeneralInformation:{UniqueIdentificationNumber:other,Name:'Konflik fiktif'}}]),
    entry('alamat','alamat',[{IsMainAddress:true,FullAddressDetail:'Alamat WP lain'}],other),
    entry('flag','flag-wp',[{FlagType:'PKP',FlagValue:true,ValidFrom:'2024-01-01'}]),
    entry('login','login-terakhir',[{Message:{LastSuccessfulLogin:'01/04/2026 12:00:00'}}]),
    {...entry('klu','klu',[]),pages:[{Errors:['fiktif'],Payload:{Data:[
      {IsMainEconomicCode:true,TradeClassificationCode:'99999'}
    ]}}]}
  ]);
  const result=kkaProfileAppendix(pkg,'2025'),fields=details(result);
  assert.deepEqual(fields.get('Nama'),['WP fiktif','Manifest paket']);
  assert.deepEqual(fields.get('Status PKP'),['PKP','profil/flag-wp.json']);
  assert.equal(fields.has('Alamat utama'),false);
  assert.equal(fields.has('KLU utama'),false);
  assert.equal(fields.has('Login terakhir di Coretax'),false);
  assert.doesNotMatch(JSON.stringify(result),/Konflik fiktif|Alamat WP lain/);
  const unknown=kkaProfileAppendix({...pkg,manifest:{...pkg.manifest,dibuat:'tanggal tidak valid'}},'2025');
  assert.equal(unknown.rows.find(row=>row[0]==='Tanggal potret profil')[1],null);
  assert.equal(details(unknown).get('Status PKP')[0],'Belum terkonfirmasi');
  assert.equal(kkaProfileAppendix({...pkg,report:{valid:false}},'2025'),null);
});

test('L-1 traces explicit non-PKP status with a corroborating registration list',()=>{
  const info=entry('info','informasi-umum',[{
    GeneralInformation:{UniqueIdentificationNumber:owner,TaxablePersonForVATPurposesStatus:0}
  }]);
  const reg=entry('jenispajak','jenis-pajak',[
    {TaxTypeCode:'ICT_WIT',TaxStatusCode:'Registered',RegistrationDate:'2024-04-12'}
  ]);
  const fields=details(kkaProfileAppendix(build([info,reg]),'2025'));
  assert.deepEqual(fields.get('Status PKP'),['Bukan PKP','profil/informasi-umum.json']);
  assert.deepEqual(fields.get('Dasar status PKP'),['Isian status PKP pada profil','profil/informasi-umum.json']);
  assert.equal(details(kkaProfileAppendix(build([info]),'2025')).get('Status PKP')[0],'Belum terkonfirmasi');
});

test('Coretax’s dedicated login field resolves supported dates and rejects malformed slash dates',()=>{
  assert.equal(profileLoginDay({Message:{LastSuccessfulLogin:'08/27/2026 21:52:37'}}),'2026-08-27');
  assert.equal(profileLoginDay({Message:{LastSuccessfulLogin:'13/11/2025 16:30:00'}}),'');
  assert.equal(profileLoginDay({LastSuccessfulLogin:'2025-12-17T09:00:00'}),'2025-12-17');
  assert.equal(profileLoginDay({'Login Terakhir / Aktif':'17-12-2025'}),'2025-12-17');
});
