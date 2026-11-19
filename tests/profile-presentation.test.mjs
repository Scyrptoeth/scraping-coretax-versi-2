import test from 'node:test';
import assert from 'node:assert/strict';
import {profileSections} from '../extension/analisis/profile.js';
import {filingCalendar,lateFilings} from '../extension/analisis/profile-filing.js';

const wp='0000000000000071';
const range={from:{y:2025,m:1},to:{y:2025,m:2}};
const entry=(source,data)=>({path:'profil/'+source+'.json',cap:{sumber:source,konteks:{npwp:wp}},pages:[{Payload:{Data:data}}]});
const pkg={manifest:{wp:{npwp:wp},dibuat:'2025-05-01',opsi:{periode:range}},forms:[],entries:[]};
test('the profile overview uses groups of readable fields, keeps zero, and distinguishes a supported PKP status',()=>{
  const base=entry('info',[{GeneralInformation:{Name:'Perusahaan fiktif',RecordId:'internal-data',NumberofStaff:0,TaxpayerStatus:'ACTIVE',
    TaxablePersonForVATPurposesStatus:0,IsUnderEnforcement:false}}]);
  const registration=entry('jenispajak',[{TaxTypeCode:'VAT_VAT',TaxStatusCode:'Registered',RegistrationDate:'2025-01-02'}]);
  const sections=entries=>profileSections({...pkg,entries}),main=sections([base,registration])[0];
  const rows=main.blocks.flatMap(b=>b.rows),value=label=>rows.find(r=>r.Isian===label)?.Nilai;
  assert.equal(value('Nama'),'Perusahaan fiktif');assert.equal(value('Status WP'),'Aktif');assert.equal(value('Tanggal pengukuhan PKP'),'02-01-2025');
  assert.equal(value('Dalam penagihan'),'Tidak');assert.equal(main.cards.find(r=>r[0]==='Jumlah pegawai')[1],0);
  assert.doesNotMatch(JSON.stringify(rows),/GeneralInformation|RecordId|internal-data/);
  registration.pages[0].Payload.Data[0].DeregistrationDate='2025-03-01';
  assert.equal(sections([base,registration])[0].cards.find(r=>r[0]==='Status PKP')[1],'Belum terkonfirmasi');
  base.pages[0].Payload.Data[0].GeneralInformation.UniqueIdentificationNumber='0000000000000072';
  assert.ok(!JSON.stringify(sections([base])[0].blocks).includes('Perusahaan fiktif'));
});
test('profile calendars distinguish missing data, amendments, other years, active payments and the adjusted filing deadline',()=>{
  const normal={ReturnSheetTypeCode:'VAT_VATR',TaxPeriodCode:'01012025',ReturnSheetModel:'Normal',ReturnDate:'2025-03-03',ExpectedReturnDate:'2025-03-01'};
  const amend={...normal,TaxPeriodCode:'02022025',ReturnSheetModel:'Amendment 001'},other={...normal,TaxPeriodCode:'01012024'};
  const pay={AccountingTypeCode:'Payment',IsCancelled:false,PeriodCode:'01012025',RevenueCode:'411211'};
  const result=filingCalendar([normal,amend,other],[pay],range);
  assert.equal(result.length,1);const row=result[0].rows[0];assert.equal(row.Jan,'Tepat, ada setoran');assert.equal(row.Feb,'Hanya pembetulan');assert.equal(row.Mar,null);
  const unpaid=filingCalendar([normal],[{...pay,IsCancelled:true}],range)[0].rows[0];
  assert.equal(unpaid.Jan,'Tepat');assert.equal(unpaid.Feb,'Belum tercantum');
  const late={...normal,ReturnDate:'2025-03-04'};
  const notices=['NoticeOfTaxCollection','TaxReturn'].map(ReferenceType=>({...pay,AccountingTypeCode:'TaxNotice',ReferenceNumber:ReferenceType,ReferenceType}));
  const checked=lateFilings(pkg,[normal,late,amend,other],notices);
  assert.equal(checked.length,1);assert.equal(checked[0]['Terlambat (hari)'],1);
  assert.equal(checked[0]['Potensi denda pada pengujian (Rp)'],null);
  assert.equal(checked[0]['STP pada akun dan masa yang sama'],'NoticeOfTaxCollection');
});
test('identification and property tables keep string identifiers and show each source separately',()=>{
  const sections=profileSections({...pkg,entries:[entry('nomorlain',[{IdentificationNumber:'0012',ValidFrom:'2024-01-01',ValidTo:null}]),
    entry('dokumen',[{DocumentNumber:'0093',DocumentStatus:'APPROVED'}]),entry('pbb',[{TaxObjectNumber:'0051',PropertySize:0}])]});
  const blocks=sections.find(s=>s.id==='identitas').blocks;
  assert.equal(blocks.length,3);assert.equal(blocks[0].rows[0].Nomor,'0012');assert.equal(blocks[0].rows[0].Sampai,null);
  assert.equal(blocks[1].rows.length,0);assert.equal(blocks[2].rows[0]['Nomor dokumen'],'0093');
  assert.equal(blocks[2].rows[0].Status,'Disetujui');
  const property=sections.find(s=>s.id==='pbb').blocks[0].rows[0];assert.equal(property.NOP,'0051');assert.equal(property['Luas objek'],0);
});
