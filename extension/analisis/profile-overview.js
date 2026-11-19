import {sptDay} from './model.js';
import {fieldValue} from './display-fields.js';

const nonblank=v=>v!==undefined&&v!==null&&v!=='';
const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const risks={HIGH:'Tinggi',MEDIUM:'Sedang',LOW:'Rendah'};
const flagNames={IS_UNDER_AUDIT:'Dalam pemeriksaan',IS_UNDER_TAX_AMNESTY:'Mengikuti amnesti pajak',
  IS_UNDER_LBTAX_CLARIFICATION:'Dalam klarifikasi PBB',IS_UNDER_SUPERVISORY:'Dalam pengawasan',Djp_Online:'DJP Online',
  Email_Validation:'Validasi email',Phone_Validation:'Validasi telepon',Password_Validation:'Validasi kata sandi',PKP:'PKP'};
const visibleGeneral={Name:'Nama',UniqueIdentificationNumber:'Nomor Pokok Wajib Pajak',TaxpayerType:'Jenis Wajib Pajak',
  TaxpayerStatus:'Status Wajib Pajak',TradingName:'Merek Dagang/Usaha',LegalStatus:'Bentuk Badan Hukum',
  PrimaryEmailAddress:'Alamat Surat Elektronik Utama',RegistrationDate:'Tanggal Pendaftaran',ActivationDate:'Tanggal Aktivasi',
  DeedOfChangeDocument:'Akta Perubahan',DateOfChange:'Tanggal Perubahan',SupervisionCode:'Seksi Pengawasan',
  RiskProfileCode:'Profil Risiko Wajib Pajak',LastSuccessfulLogin:'Login Terakhir / Aktif'};
const visibleEconomic={BookkeepingPeriod:'Periode Pembukuan',BookkeepingMethods:'Metode Pembukuan/Pencatatan',
  BookkeepingCurrency:'Mata Uang Pembukuan',NumberOfEmployees:'Jumlah Karyawan',YearlyTurnoverAmount:'Omset per tahun'};
const visibleIdentity={DateOfEstablishment:'Tanggal Pendirian',PlaceOfEstablishment:'Tempat Pendirian',
  TypeOfCompanyCapital:'Jenis Perusahaan/Modal',AuthorizedCapital:'Modal Dasar',IssuedCapital:'Modal Ditempatkan',PaidInCapital:'Modal Disetor'};

function profileFields(native,visible,labels){
  const values={...native};
  for(const [key,label] of Object.entries(labels))if(!nonblank(values[key])&&nonblank(visible[label]))values[key]=visible[label];
  return values;
}
export function generalProfile(info){return profileFields(info.GeneralInformation||info,info,visibleGeneral);}
function activeAt(row,day){
  const start=sptDay(row.ValidFrom),end=sptDay(row.ValidTo);
  return (!start||!day||start<=day)&&(!end||!day||end>=day);
}
function periodName(code){
  const match=/^(0[1-9]|1[0-2])-(0[1-9]|1[0-2])$/.exec(code);
  return match?months[Number(match[1])-1]+'–'+months[Number(match[2])-1]:code;
}
function simpleRows(entries,withSources,defaultSource){
  return entries.filter(([,v])=>nonblank(v)).map(([Isian,Nilai,source=defaultSource])=>({
    Isian,Nilai,...(withSources&&{'Berkas sumber':source||null})
  }));
}
function descriptions(value,key){return nonblank(value)?fieldValue(key,value):null;}
export function profileDay(value){
  let day=sptDay(value);
  if(!day&&typeof value==='string'){
    const text=value.trim();
    const numeric=/^(\d\d)-(\d\d)-(\d{4})(?:\s|$)/.exec(text);
    if(numeric) return sptDay(numeric[3]+'-'+numeric[2]+'-'+numeric[1]);
    const parts=/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})$/u.exec(text);
    if(parts){
      const [,date,month,year]=parts;
      const number=months.findIndex(name=>name.toLowerCase()===month.toLowerCase())+1;
      if(number)day=sptDay(year+'-'+String(number).padStart(2,'0')+'-'+date.padStart(2,'0'));
    }
  }
  return day;
}
const dayValue=value=>profileDay(value).split('-').reverse().join('-')||null;
export function profileLoginDay(row){
  const value=row?.Message?.LastSuccessfulLogin??row?.LastSuccessfulLogin??row?.['Login Terakhir / Aktif'];
  if(typeof value!=='string')return '';
  const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(value.trim());
  return match?sptDay(match[3]+'-'+match[1].padStart(2,'0')+'-'+match[2].padStart(2,'0')):profileDay(value);
}
function supervision(value){
  const section=/^SUPERVISION[ _]SECTION[ _]([IVX]+|\d+)$/i.exec(value);
  return section?'Seksi Pengawasan '+section[1].toUpperCase():value;
}

export function profileOverview(input,manifest,{withSources=false}={}){
  const info=input.info[0]||{},g=generalProfile(info);
  const e=profileFields(info.TaxpayerEconomic,info,visibleEconomic),id=profileFields(info.TaxpayerIdentity,info,visibleIdentity);
  const asOf=sptDay(manifest.dibuat),kind=g.TaxpayerType??g['Jenis Wajib Pajak'];
  const mainAddress=input.alamat.find(r=>r.IsMainAddress===true&&activeAt(r,asOf));
  const address=info.MainAddress||mainAddress||{};
  const activity=info.MainEconomicCode||input.klu.find(r=>r.IsMainEconomicCode===true&&activeAt(r,asOf))||{};
  const bank=info.MainBankAccount||input.bank.find(r=>r.IsMainBankAccount===true&&activeAt(r,asOf))||{};
  const sourceOf=row=>row?.['Berkas sumber']||null;
  const infoSource=sourceOf(info),addressSource=address===info.MainAddress?infoSource:sourceOf(address);
  const addressContact=nonblank(address.PicName)?address:mainAddress;
  const activitySource=activity===info.MainEconomicCode?infoSource:sourceOf(activity);
  const bankSource=bank===info.MainBankAccount?infoSource:sourceOf(bank);
  const activityName=[activity.TradeClassificationCode,activity.ActivityDescription].filter(nonblank).join(' · ');
  const addressText=address.FullAddressDetail||(nonblank(address.AddressDetail)?[
    address.AddressDetail,nonblank(address.Rt)?'RT '+address.Rt:null,nonblank(address.Rw)?'RW '+address.Rw:null,
    address.City,address.PostalCode
  ].filter(nonblank).join(', '):null);
  const vat=input.jenispajak.flatMap(row=>{
    const native=row.TaxTypeCode==='VAT_VAT'&&row.TaxStatusCode==='Registered';
    const visible=!row.TaxTypeCode&&!row.TaxStatusCode&&row['Jenis Pajak']==='PPN'&&
      row['Kelompok pendaftaran']==='Terdaftar untuk Jenis Pajak Berikut';
    if(!native&&!visible)return [];
    const since=profileDay(row.RegistrationDate??row['Tanggal Pendaftaran']);
    const until=profileDay(row.DeregistrationDate??row['Tanggal Pencabutan Pendaftaran']);
    return since&&(!asOf||since<=asOf)&&(!until||asOf&&until>asOf)?[{since,source:sourceOf(row)}]:[];
  });
  const earliestVat=vat.sort((a,b)=>a.since.localeCompare(b.since))[0];
  const vatDate=earliestVat?dayValue(earliestVat.since):null;
  const flags=[...(input.flag.length?input.flag:info.ListActiveTaxpayerFlag||[])].filter(r=>activeAt(r,asOf)&&
    (r.FlagValue===true||String(r.FlagValue).toLowerCase()==='true'));
  const vatFlag=flags.find(r=>r.FlagType==='PKP');
  const vatStatus=vat.length||vatFlag||g.TaxablePersonForVATPurposesStatus===true||g.TaxablePersonForVATPurposesStatus===1?'PKP':null;
  const vatBasis=vat.length?'Registrasi PPN di Coretax':vatFlag?'Penanda PKP pada registrasi':vatStatus?'Isian status PKP pada profil':null;
  const vatSource=earliestVat?earliestVat.source:vatFlag&&input.flag.length?sourceOf(vatFlag):vatStatus?infoSource:null;
  const risk=risks[g.RiskProfileCode]||descriptions(g.RiskProfileCode,'RiskProfileCode');
  const taxpayerStatus=descriptions(g.TaxpayerStatus??g['Status WP'],'TaxpayerStatus');
  const flagText=[...new Set(flags.map(r=>flagNames[r.FlagType]||'Penanda lain (lihat data asli)'))].join(', ');
  const sourcesOf=rows=>[...new Set(rows.map(sourceOf).filter(Boolean))].join(' · ');
  const login=(input.login||[]).map(row=>({day:profileLoginDay(row),source:sourceOf(row)})).filter(v=>v.day&&(!asOf||v.day<=asOf))
    .sort((a,b)=>b.day.localeCompare(a.day))[0];
  const loginDay=profileLoginDay(g);
  const generalType=kind==='TA002'?'Badan':kind==='TA001'?'Orang pribadi':descriptions(kind,'TaxpayerType');
  const cards=[['Status WP',taxpayerStatus],['Status PKP',vatStatus?(vatDate?'PKP sejak '+vatDate:'PKP'):'Belum terkonfirmasi'],
    ['Profil risiko',risk],['Jumlah pegawai',g.NumberofStaff??e.NumberOfEmployees],['Perkiraan peredaran',g.ForecastedAnnualTurnover],
    ['Penanda aktif',flagText],['Dalam penagihan',descriptions(g.IsUnderEnforcement,'IsUnderEnforcement')]];
  const groups=[
    ['Identitas',[
      ['Nama',g.Name??g['Nama WP']??manifest.wp?.nama,(g.Name??g['Nama WP'])!=null?infoSource:'Manifest paket'],
      ['NPWP',g.UniqueIdentificationNumber??manifest.wp?.npwp,g.UniqueIdentificationNumber!=null?infoSource:'Manifest paket'],['Jenis WP',generalType],
      ['Status WP',taxpayerStatus],['Nama dagang',g.TradingName],['Status hukum',g.LegalStatus],
      ['KLU utama',activityName||g.MainActivity,activityName?activitySource:infoSource],
      ['Alamat utama',addressText,addressSource],['Telepon',g.PrimaryMobilePhoneNumber],['Email',g.PrimaryEmailAddress],
      ['Penanggung jawab lokasi utama',addressContact?.PicName,addressContact===address?addressSource:sourceOf(addressContact)],
      ['Negara asal',g.CountryOfOrigin||g.Nationality],['Situs web',g.Website]]],
    ['Registrasi dan PKP',[
      ['Tanggal terdaftar',dayValue(g.RegistrationDate)],['Tanggal aktivasi',dayValue(g.ActivationDate)],['Mulai transaksi',dayValue(g.TransactionStartDate)],
      ['Status PKP',vatStatus||'Belum terkonfirmasi',vatSource],['Tanggal pengukuhan PKP',vatDate,earliestVat?.source??null],
      ['Dasar status PKP',vatBasis,vatSource],
      ['Jenis pajak terdaftar',input.jenispajak.length?input.jenispajak.length:null,sourcesOf(input.jenispajak)],['Data hasil migrasi',descriptions(g.IsMigrated,'IsMigrated')],
      ['Profil terakhir diperbarui',dayValue(g.LastUpdatedDate)],
      ['Login terakhir di Coretax',dayValue(login?.day||(!asOf||loginDay<=asOf?loginDay:null)),login?login.source:infoSource]]],
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
      ['Unit pengawasan pada alamat utama',supervision(address.SupervisionName||address.SupervisionCode),addressSource],
      ['Unit pengawasan pada profil',supervision(g.SupervisionCode)],['Profil risiko',risk],['Posisi risiko',g.RiskPosition],
      ['Skor risiko',g.RiskScore],['Nomor rekening utama',bank.BankAccountNumber,bankSource],['Nama pada rekening',bank.Name,bankSource],
      ['Dalam penagihan',descriptions(g.IsUnderEnforcement,'IsUnderEnforcement')],['Penghambat restitusi',descriptions(g.RepaymentInhibitor,'RepaymentInhibitor')],
      ['Penanda aktif',flagText,input.flag.length?sourcesOf(flags):infoSource]]]
  ].map(([title,entries])=>({title,rows:simpleRows(entries,withSources,infoSource),layout:'facts'})).filter(b=>b.rows.length);
  return {cards,groups};
}

const fields={
  nomorlain:[['Jenis (kode)','IdentificationNumberType','Tipe'],['Nomor','IdentificationNumber','Nomor Identifikasi'],
    ['Berlaku dari','ValidFrom','Tanggal Mulai'],['Sampai','ValidTo','Tanggal Berakhir']],
  sertel:[['Nomor sertifikat','CertificateNumber'],['Penerbit','Issuer'],['Pemegang sertifikat','Name'],['Berlaku dari','ValidFrom'],['Sampai','ValidTo'],['Status','Status']],
  dokumen:[['Tanggal','DocumentDate'],['Judul','DocumentTitle','DocumentTypeName'],['Nomor dokumen','DocumentNumber'],['Jenis dokumen (kode)','DocumentTypeCode','DocumentTypeName'],
    ['Nomor kasus','CaseNumber'],['Status','DocumentStatus']],
  pbb:[['NOP','TaxObjectNumber','NOP'],['Jenis objek','PropertyTypeCode','Jenis/Subsektor'],['Luas objek','PropertySize','Luas Objek Pajak'],
    ['Sektor','Sector','Sektor'],['Subsektor','SubSector'],
    ['Nama objek pajak','TaxObjectName','Nama Objek Pajak'],['Kabupaten/kota','City','Kota/Kabupaten'],['Koordinat','Coordinate'],
    ['Kecamatan','District','Kecamatan'],['Kelurahan/desa','SubDistrict','Kelurahan/Desa'],
    ['Provinsi','Province','Provinsi'],['Tanggal pendaftaran','RegistrationDate','Tanggal Pendaftaran'],
    ['Nomor kasus pendaftaran','RegistrationCaseNumber'],['Mulai transaksi','TransactionStartDate'],
    ['Nomor izin usaha','BusinessPermitNumber'],['Tanggal izin usaha','BusinessPermitDate'],
    ['Nomor induk berusaha','Nomor Induk Berusaha'],['Tanggal nomor induk berusaha','Tanggal Nomor Induk Berusaha'],
    ['Nomor izin objek','ObjectPermitNumber','Nomor Ijin Objek'],['Tanggal izin objek','ObjectPermitDate','Tanggal Ijin Objek'],
    ['Tanggal pencabutan pendaftaran','Tanggal Pencabutan Pendaftaran'],
    ['Instansi pemberi izin','PermittingAgency','Instansi Pemberi Izin'],['Area objek pajak','TaxObjectArea'],['Alamat objek','ObjectAddress'],
    ['Rincian alamat','AddressDetail','Detail Alamat'],['Alamat lengkap','FullAddress'],['Data lokasi','GeometricData','Data Geometri'],
    ['Jenis bumi','EarthType','Tipe Bumi'],['Rincian objek','Detail','Rincian'],['Status kegiatan','ActivityStatus','Status Kegiatan'],
    ['Kode wilayah','AreaCode','Kode Wilayah'],['Kode pos','PostalCode','Kode Pos'],['Kode KPP','TaxOfficeCode','Kode KPP'],
    ['Kode seksi pengawasan','SupervisionSectionCode','Seksi Pengawasan'],
    ['Tanggal dibuat','CreationDate'],['Versi data','AggregateVersion'],['Luas tanah','LandArea'],['Luas bangunan','BuildingArea']]
};
export function registryTable(key,rows,formatRows){
  const result=rows.map(row=>{
    const projected={};
    for(const [label,...keys] of fields[key]){
      const k=keys.find(k=>nonblank(row[k]))||keys.find(k=>Object.hasOwn(row,k));
      if(!k)continue;
      const value=row[k];
      if(k==='ValidFrom'||k==='ValidTo'||k.endsWith('Date')||k.startsWith('Tanggal '))projected[label]=dayValue(value);
      else if(k==='DocumentStatus'&&value==='APPROVED')projected[label]='Disetujui';
      else projected[label]=fieldValue(k,value);
    }
    return Object.keys(projected).length?projected:formatRows([row])[0]||{};
  });
  return result;
}
