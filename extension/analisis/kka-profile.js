import {normalizeId} from '../app-data.js';
import {fieldValue} from './display-fields.js';
import {rowsOf,sptDay} from './model.js';
import {generalProfile,profileDay,profileOverview} from './profile-overview.js';

const sources={info:'informasi-umum',alamat:'alamat',klu:'klu',flag:'flag-wp',jenispajak:'jenis-pajak',login:'login-terakhir'};
const summaryLabels=['Nama','NPWP','Jenis WP','Status WP','Alamat utama','KLU utama','Status PKP','Tanggal pengukuhan PKP',
  'Tanggal terdaftar','Kode KPP','Unit pengawasan pada alamat utama','Unit pengawasan pada profil'];
const accountFields=new Set(['Nomor rekening utama','Nama pada rekening']);
const categoryLabels={C_LC:'Perseroan terbatas (PT)',I_IN:'Orang pribadi'};
const present=v=>v!=null&&String(v).trim()!=='';

function scopedRows(entries,owner,source){
  return entries.filter(e=>e.cap?.sumber===source||e.path==='profil/'+sources[source]+'.json').flatMap(entry=>{
    const declared=entry.cap?.konteks?.npwp;
    if(present(declared)&&normalizeId(declared)!==owner)return [];
    const pages=entry.pages?.filter(p=>p&&p.IsSuccessful!==false&&!p.Errors?.length);
    return rowsOf({...entry,pages}).filter(row=>{
      const identifiers=[declared,row.TaxpayerTIN,row.TaxpayerTin,row.UniqueIdentificationNumber,
        row['Nomor Pokok Wajib Pajak'],row.GeneralInformation?.UniqueIdentificationNumber].filter(present);
      return identifiers.length&&identifiers.every(id=>normalizeId(id)===owner);
    }).map(row=>({...row,'Berkas sumber':entry.path}));
  });
}

function currentTaxTypes(rows,day){
  const types=[];
  for(const row of rows){
    const type=row.TaxTypeCode??row['Jenis Pajak'];
    const registered=row.TaxStatusCode==='Registered'||
      !row.TaxStatusCode&&row['Kelompok pendaftaran']==='Terdaftar untuk Jenis Pajak Berikut';
    const since=profileDay(row.RegistrationDate??row['Tanggal Pendaftaran']);
    const until=profileDay(row.DeregistrationDate??row.RevocationDate??row['Tanggal Pencabutan Pendaftaran']);
    if(!type||!registered||since&&since>day||until&&until<=day)continue;
    types.push([fieldValue('TaxTypeCode',type),String(type),since||null,row['Berkas sumber']]);
  }
  return types;
}

export function kkaProfileAppendix(pkg,year){
  const owner=normalizeId(pkg.manifest.wp?.npwp);
  if(!owner||/^0+$/.test(owner)||pkg.report?.valid===false)return null;
  const title='L-1 Profil WP',asOf=sptDay(pkg.manifest.dibuat);
  const input=Object.fromEntries(Object.keys(sources).map(source=>[source,
    asOf||source==='info'||source==='login'?scopedRows(pkg.entries||[],owner,source):[]]));
  const infoIssue=input.info.length>1;
  if(infoIssue)input.info=[];
  input.bank=[];
  input.alamat=input.alamat.map(row=>row.TypeOfAddress==='MAIN'?{...row,IsMainAddress:true}:row);
  const {groups,cards}=profileOverview(input,pkg.manifest,{withSources:true});
  const detail=groups.flatMap(group=>group.rows.filter(r=>!accountFields.has(r.Isian)&&r.Isian!=='Jenis pajak terdaftar')
    .map(r=>[group.title,r.Isian,r.Nilai,r['Berkas sumber']]));
  const types=asOf?currentTaxTypes(input.jenispajak,asOf):[];
  const info=input.info[0],general=info&&generalProfile(info),cardValues=new Map(cards);
  if(general){
    const source=info['Berkas sumber'];
    const category=categoryLabels[general.TaxpayerCategory];
    if(category&&!detail.some(row=>row[1]==='Status hukum'))detail.push(['Identitas','Status hukum',category,source]);
    const vatStatus=detail.find(row=>row[1]==='Status PKP');
    const explicitNonVat=[false,0,'0'].includes(general.TaxablePersonForVATPurposesStatus);
    if(vatStatus?.[2]==='Belum terkonfirmasi'&&explicitNonVat&&types.length&&!types.some(row=>/^VAT|^PPN/i.test(row[1]))){
      vatStatus[2]='Bukan PKP';
      vatStatus[3]=source;
      detail.push(['Registrasi dan PKP','Dasar status PKP','Isian status PKP pada profil',source]);
    }
    for(const label of ['Jumlah pegawai','Perkiraan peredaran']){
      const value=cardValues.get(label);
      if(present(value))detail.push(['Administrasi dan pengawasan',label,value,source]);
    }
  }
  const values=new Map(detail.map(([,label,value,source])=>[label,[value,source]]));
  const rows=[['Isian','Nilai','Berkas sumber'],['Tanggal potret profil',asOf||null,'Manifest paket'],
    ...summaryLabels.map(label=>[label,...(values.get(label)||[null,null])])];
  const notes=[
    ['Tahun analisis',String(year)],['Tanggal potret profil',asOf||null],
    ['Profil mengikuti keadaan pada tanggal paket. Tahun analisis mengacu pada ruang kerja KKA.']
  ];
  if(infoIssue)notes.push(['Beberapa baris informasi umum cocok dengan NPWP. Periksa data mentah untuk memastikan baris yang berlaku.']);
  return {title,rows,workbook:{name:title,rows:[[title],...notes,[],['Bagian','Isian','Nilai','Berkas sumber'],
    ...detail,[],['Jenis pajak yang tercatat aktif'],['Jenis pajak','Isian sumber','Tanggal terdaftar','Berkas sumber'],
    ...(types.length?types:[['Data registrasi aktif belum dapat dipastikan.',null,null,null]])]}};
}
