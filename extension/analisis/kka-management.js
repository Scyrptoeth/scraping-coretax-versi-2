import {normalizeId} from '../app-data.js';
import {rowsOf} from './model.js';

const managementTypes=new Map([['C_LC_DI','Direksi'],['C_LC_CO','Komisaris'],['C_LC_OT','Pihak lain']]);
const roleOrder=['Direksi','Komisaris','Pihak lain','Pihak terkait (WP)'];
const headings=['Peran','Nama','NPWP/NIK','Porsi (%)','Kode jabatan','Berlaku dari','s.d.','Status'];
const text=v=>typeof v==='string'?v.trim():Number.isSafeInteger(v)?String(v):'';
const displayDay=day=>day?day.split('-').reverse().join('-'):'';

function records(pkg,source,file){
  const wp=normalizeId(pkg.manifest.wp?.npwp);
  return pkg.entries.filter(e=>wp && normalizeId(e.cap?.konteks?.npwp)===wp &&
    (e.cap?.sumber===source||!e.cap?.sumber&&e.path===file));
}
function company(pkg){
  const types=new Set();
  for(const entry of records(pkg,'info','profil/informasi-umum.json'))for(const row of rowsOf(entry)){
    const g=row.GeneralInformation??row;
    if(g.UniqueIdentificationNumber && normalizeId(g.UniqueIdentificationNumber)!==normalizeId(pkg.manifest.wp?.npwp))return false;
    const kind=text(g.TaxpayerType??g['Jenis Wajib Pajak']).toLowerCase();
    if(kind)types.add(['ta002','badan'].includes(kind)?'BADAN':'OTHER');
  }
  if(!types.size)for(const form of pkg.forms||[])if(['OP','BADAN'].includes(form.type))types.add(form.type);
  return types.size===1 && types.has('BADAN');
}
function registryDay(value){
  const raw=text(value).replace(/^(\d{2})[-/](\d{2})[-/](\d{4})$/,'$3-$2-$1');
  const day=/^\d{4}-\d{2}-\d{2}(?=T|$)/.exec(raw)?.[0];
  if(!day||day<='1900-01-01')return '';
  const utc=new Date(day+'T00:00:00Z');
  return Number.isFinite(+utc)&&utc.toISOString().slice(0,10)===day?day:'';
}
function officer(row,asOf){
  const type=text(row.RelatedPersonType??row['Jenis Pihak Terkait']);
  const job=text(row.PersonRole??row['Kode jabatan']);
  const business=text(row.BusinessRoleType);
  const declared=managementTypes.get(type)??roleOrder.find(label=>label.toLowerCase()===type.toLowerCase());
  const rawShare=row.Percentage??row['Porsi (%)'];
  const share=typeof rawShare==='number'?rawShare:Number(text(rawShare).replace(',','.'));
  const owned=Number.isFinite(share)&&share>0;
  if(owned && declared!=='Direksi' && declared!=='Komisaris')return null;
  const role=declared || (row.TypeOfRelatedTaxpayer?'Pihak terkait (WP)':
    [type,text(row.RelatedPersonSubType),business,job].filter(Boolean).join(' '));
  const name=text(row.PersonName??row['Nama Pihak Terkait']),id=text(row.PersonNIKTIN??row['NPWP/NIK']);
  if(!name&&!id&&!role)return null;
  const rawEnd=row.ValidTo??row['s.d.'],start=registryDay(row.ValidFrom??row['Berlaku dari']),end=registryDay(rawEnd);
  let status=text(row.Status);
  if(end)status=end<asOf?'Berakhir':'Aktif';
  else if(!status && ('ValidTo' in row||'s.d.' in row) && (!text(rawEnd)||/^0001-01-01/.test(text(rawEnd))))status='Aktif';
  return [role,name,id,owned?share:null,job,displayDay(start),displayDay(end),status||'Belum diketahui'];
}
const rank=role=>roleOrder.includes(role)?roleOrder.indexOf(role):roleOrder.length;

function failedRegistry(manifest,files){
  const key=value=>text(value).toLowerCase().replace(/^\/?(?:data\/)?/,'');
  const matches=new Set(['pihak','pihak terkait','profil/pihak-terkait.json',
    ...files.flatMap(e=>[e.path,e.cap.path,e.cap.label]).filter(Boolean).map(key)]);
  return (manifest.gagal||[]).some(item=>(typeof item==='string'?[item]:[item?.sumber,item?.path,item?.endpoint,item?.label])
    .some(value=>matches.has(key(value))));
}

export function kkaManagementSheet(pkg,asOf=new Date().toISOString().slice(0,10)){
  if(!company(pkg))return null;
  const files=records(pkg,'pihak','profil/pihak-terkait.json');
  const items=files.flatMap(e=>rowsOf({...e,pages:e.pages?.filter(p=>!p?.Errors?.length)}));
  const people=items.map(r=>officer(r,asOf)).filter(Boolean)
    .sort((a,b)=>rank(a[0])-rank(b[0])||Number(a[7]==='Berakhir')-Number(b[7]==='Berakhir'));
  const complete=files.length>0&&pkg.report?.valid!==false&&!failedRegistry(pkg.manifest,files)&&files.every(e=>e.cap?.lengkap===true && e.pages?.length &&
    e.pages.every(p=>p&&p.IsSuccessful!==false&&!p.Errors?.length)&&e.cap.baris===rowsOf(e).length&&
    (e.cap.total==null||e.cap.total===e.cap.baris));
  const rows=[['Pengurus dan pihak terkait'],['Status berlaku pada tanggal ekspor '+displayDay(asOf)+' (UTC). Riwayat jabatan yang sudah berakhir tetap ditampilkan.']];
  if(files.length)rows.push(['Sumber registrasi',...new Set(files.map(e=>e.path))]);
  if(people.length){
    const cols=headings.map((_,i)=>i).filter(i=>people.some(row=>row[i]!==''&&row[i]!=null));
    rows.push([],cols.map(i=>headings[i]),...people.map(row=>cols.map(i=>row[i])));
  }else if(!files.length)rows.push(['Sumber pihak terkait belum tersedia untuk WP ini.']);
  else if(complete&&!items.length)rows.push(['Sumber mencatat nol pihak terkait.']);
  else rows.push(['Belum ada baris pengurus atau pihak terkait yang dapat ditampilkan dari sumber ini.']);
  if(files.length&&!complete)rows.push(['Cakupan registrasi belum terkonfirmasi lengkap.']);
  return {name:'L-2a Pengurus',rows};
}
