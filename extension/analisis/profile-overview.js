import {sptDay} from './model.js';
import {fieldValue} from './display-fields.js';

const nonblank=v=>v!==undefined&&v!==null&&v!=='';
const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const risks={HIGH:'Tinggi',MEDIUM:'Sedang',LOW:'Rendah'};
const flagNames={IS_UNDER_AUDIT:'Dalam pemeriksaan',IS_UNDER_TAX_AMNESTY:'Mengikuti amnesti pajak',
  IS_UNDER_LBTAX_CLARIFICATION:'Dalam klarifikasi PBB',IS_UNDER_SUPERVISORY:'Dalam pengawasan',Djp_Online:'DJP Online',
  Email_Validation:'Validasi email',Phone_Validation:'Validasi telepon',Password_Validation:'Validasi kata sandi',PKP:'PKP'};
function activeAt(row,day){
  const start=sptDay(row.ValidFrom),end=sptDay(row.ValidTo);
  return (!start||!day||start<=day)&&(!end||!day||end>=day);
}
function periodName(code){
  const match=/^(0[1-9]|1[0-2])-(0[1-9]|1[0-2])$/.exec(code);
  return match?months[Number(match[1])-1]+'–'+months[Number(match[2])-1]:code;
}
function simpleRows(entries){return entries.filter(([,v])=>nonblank(v)).map(([Isian,Nilai])=>({Isian,Nilai}));}
function descriptions(value,key){return nonblank(value)?fieldValue(key,value):null;}
function dayValue(value){const day=sptDay(value);return day?day.split('-').reverse().join('-'):null;}
function supervision(value){
  const section=/^SUPERVISION[ _]SECTION[ _]([IVX]+|\d+)$/i.exec(value);
  return section?'Seksi Pengawasan '+section[1].toUpperCase():value;
}

export function profileOverview(input,manifest){
  const info=input.info[0]||{},g=info.GeneralInformation||info,e=info.TaxpayerEconomic||{},id=info.TaxpayerIdentity||{};
  const asOf=sptDay(manifest.dibuat),kind=g.TaxpayerType??g['Jenis Wajib Pajak'];
  const address=info.MainAddress||input.alamat.find(r=>r.IsMainAddress===true&&activeAt(r,asOf))||{};
  const activity=info.MainEconomicCode||input.klu.find(r=>r.IsMainEconomicCode===true&&activeAt(r,asOf))||{};
  const bank=info.MainBankAccount||input.bank.find(r=>r.IsMainBankAccount===true&&activeAt(r,asOf))||{};
  const vat=input.jenispajak.filter(r=>r.TaxTypeCode==='VAT_VAT'&&r.TaxStatusCode==='Registered'&&sptDay(r.RegistrationDate)&&
    (!asOf||sptDay(r.RegistrationDate)<=asOf)&&(!sptDay(r.DeregistrationDate)||asOf&&sptDay(r.DeregistrationDate)>asOf));
  const vatDate=vat.length?dayValue(vat.map(r=>sptDay(r.RegistrationDate)).sort()[0]):null;
  const flags=[...(input.flag.length?input.flag:info.ListActiveTaxpayerFlag||[])].filter(r=>activeAt(r,asOf)&&
    (r.FlagValue===true||String(r.FlagValue).toLowerCase()==='true'));
  const vatFlag=flags.some(r=>r.FlagType==='PKP');
  const vatStatus=vat.length||vatFlag||g.TaxablePersonForVATPurposesStatus===true||g.TaxablePersonForVATPurposesStatus===1?'PKP':null;
  const risk=risks[g.RiskProfileCode]||descriptions(g.RiskProfileCode,'RiskProfileCode');
  const taxpayerStatus=descriptions(g.TaxpayerStatus??g['Status WP'],'TaxpayerStatus');
  const flagText=[...new Set(flags.map(r=>flagNames[r.FlagType]||'Penanda lain (lihat data asli)'))].join(', ');
  const generalType=kind==='TA002'?'Badan':kind==='TA001'?'Orang pribadi':descriptions(kind,'TaxpayerType');
  const cards=[['Status WP',taxpayerStatus],['Status PKP',vatStatus?(vatDate?'PKP sejak '+vatDate:'PKP'):'Belum terkonfirmasi'],
    ['Profil risiko',risk],['Jumlah pegawai',g.NumberofStaff??e.NumberOfEmployees],['Perkiraan peredaran',g.ForecastedAnnualTurnover],
    ['Penanda aktif',flagText],['Dalam penagihan',descriptions(g.IsUnderEnforcement,'IsUnderEnforcement')]];
  const groups=[
    ['Identitas',[
      ['Nama',g.Name??g['Nama WP']??manifest.wp?.nama],['NPWP',g.UniqueIdentificationNumber??manifest.wp?.npwp],['Jenis WP',generalType],
      ['Status WP',taxpayerStatus],['Nama dagang',g.TradingName],['Status hukum',g.LegalStatus],
      ['KLU utama',[activity.TradeClassificationCode,activity.ActivityDescription].filter(nonblank).join(' · ')||g.MainActivity],
      ['Alamat utama',address.FullAddressDetail||address.AddressDetail],['Telepon',g.PrimaryMobilePhoneNumber],['Email',g.PrimaryEmailAddress],
      ['Penanggung jawab lokasi utama',address.PicName],['Negara asal',g.CountryOfOrigin||g.Nationality],['Situs web',g.Website]]],
    ['Registrasi dan PKP',[
      ['Tanggal terdaftar',dayValue(g.RegistrationDate)],['Tanggal aktivasi',dayValue(g.ActivationDate)],['Mulai transaksi',dayValue(g.TransactionStartDate)],
      ['Status PKP',vatStatus||'Belum terkonfirmasi'],['Tanggal pengukuhan PKP',vatDate],
      ['Dasar status PKP',vat.length?'Registrasi PPN di Coretax':vatFlag?'Penanda PKP pada registrasi':vatStatus?'Isian status PKP pada profil':null],
      ['Jenis pajak terdaftar',input.jenispajak.length?input.jenispajak.length:null],['Data hasil migrasi',descriptions(g.IsMigrated,'IsMigrated')],
      ['Profil terakhir diperbarui',dayValue(g.LastUpdatedDate)],['Login terakhir di Coretax',dayValue(g.LastSuccessfulLogin)]]],
    ['Pendirian dan modal',[
      ['Tanggal pendirian',dayValue(id.DateOfEstablishment)],['Tempat pendirian',id.PlaceOfEstablishment],['Nomor akta pendirian',id.DeedOfEstablishmentDocumentNumber],
      ['Nomor SK pengesahan',id.DecreeOfRatificationNumber],['Tanggal SK pengesahan',dayValue(id.DecreeOfRatificationDate)],['Notaris',id.NotarySigningOfficerName],
      ['Akta perubahan terakhir',g.DeedOfChangeDocument],['Tanggal perubahan',dayValue(g.DateOfChange)],
      ['Status modal',id.TypeOfCompanyCapital==='TY002'?'Penanaman modal dalam negeri (PMDN)':descriptions(id.TypeOfCompanyCapital,'TypeOfCompanyCapital')],
      ['Modal dasar',id.AuthorizedCapital],['Modal ditempatkan',id.IssuedCapital],['Modal disetor',id.PaidInCapital]]],
    ['Pembukuan',[
      ['Tahun buku',periodName(e.BookkeepingPeriod)],['Metode pembukuan',/^BO\d+$/.test(e.BookkeepingMethods)?'Kode metode '+e.BookkeepingMethods:descriptions(e.BookkeepingMethods,'BookkeepingMethods')],
      ['Mata uang pembukuan',descriptions(e.BookkeepingCurrency,'BookkeepingCurrency')],['Jumlah pegawai menurut data usaha',e.NumberOfEmployees],
      ['Peredaran setahun menurut data usaha',e.YearlyTurnoverAmount]]],
    ['Administrasi dan pengawasan',[
      ['Kode KPP',g.TaxOffice],['Kode Kanwil',g.TaxRegion],['Kode unit kerja',g.WorkingUnitCode],
      ['Unit pengawasan pada alamat utama',supervision(address.SupervisionName||address.SupervisionCode)],
      ['Unit pengawasan pada profil',supervision(g.SupervisionCode)],['Profil risiko',risk],['Posisi risiko',g.RiskPosition],
      ['Skor risiko',g.RiskScore],['Nomor rekening utama',bank.BankAccountNumber],['Nama pada rekening',bank.Name],
      ['Dalam penagihan',descriptions(g.IsUnderEnforcement,'IsUnderEnforcement')],['Penghambat restitusi',descriptions(g.RepaymentInhibitor,'RepaymentInhibitor')],
      ['Penanda aktif',flagText]]]
  ].map(([title,entries])=>({title,rows:simpleRows(entries),layout:'facts'})).filter(b=>b.rows.length);
  return {cards,groups};
}

const fields={
  nomorlain:[['Jenis (kode)','IdentificationNumberType'],['Nomor','IdentificationNumber'],['Berlaku dari','ValidFrom'],['Sampai','ValidTo']],
  sertel:[['Nomor sertifikat','CertificateNumber'],['Penerbit','Issuer'],['Pemegang sertifikat','Name'],['Berlaku dari','ValidFrom'],['Sampai','ValidTo'],['Status','Status']],
  dokumen:[['Tanggal','DocumentDate'],['Judul','DocumentTitle','DocumentTypeName'],['Nomor dokumen','DocumentNumber'],['Jenis dokumen (kode)','DocumentTypeCode','DocumentTypeName'],
    ['Nomor kasus','CaseNumber'],['Status','DocumentStatus']],
  pbb:[['NOP','TaxObjectNumber'],['Kode jenis objek','PropertyTypeCode'],['Luas objek','PropertySize'],['Sektor','Sector'],['Subsektor','SubSector'],
    ['Nama objek pajak','TaxObjectName'],['Kabupaten/kota','City'],['Koordinat','Coordinate'],['Kecamatan','District'],['Kelurahan/desa','SubDistrict'],
    ['Provinsi','Province'],['Tanggal pendaftaran','RegistrationDate'],['Nomor kasus pendaftaran','RegistrationCaseNumber'],['Mulai transaksi','TransactionStartDate'],
    ['Nomor izin usaha','BusinessPermitNumber'],['Tanggal izin usaha','BusinessPermitDate'],['Nomor izin objek','ObjectPermitNumber'],['Tanggal izin objek','ObjectPermitDate'],
    ['Instansi pemberi izin','PermittingAgency'],['Area objek pajak','TaxObjectArea'],['Alamat objek','ObjectAddress'],['Rincian alamat','AddressDetail'],
    ['Alamat lengkap','FullAddress'],['Data lokasi','GeometricData'],['Jenis bumi','EarthType'],['Rincian objek','Detail'],['Status kegiatan','ActivityStatus'],
    ['Kode wilayah','AreaCode'],['Kode pos','PostalCode'],['Kode KPP','TaxOfficeCode'],['Kode seksi pengawasan','SupervisionSectionCode'],
    ['Tanggal dibuat','CreationDate'],['Versi data','AggregateVersion'],['Luas tanah','LandArea'],['Luas bangunan','BuildingArea']]
};
export function registryTable(key,rows,formatRows){
  const result=rows.map(row=>{
    const projected={};
    for(const [label,...keys] of fields[key]){
      const k=keys.find(k=>nonblank(row[k]))||keys.find(k=>Object.hasOwn(row,k));
      if(!k)continue;
      const value=row[k];
      if(k==='ValidFrom'||k==='ValidTo'||k.endsWith('Date'))projected[label]=dayValue(value);
      else if(k==='DocumentStatus'&&value==='APPROVED')projected[label]='Disetujui';
      else projected[label]=fieldValue(k,value);
    }
    return Object.keys(projected).length?projected:formatRows([row])[0]||{};
  });
  return result;
}
