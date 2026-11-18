import {normalizeId} from '../app-data.js';

const parts=['induk','a1','a2','b1','b2','b3','c','c-total'];
const names={induk:'Induk',a1:'A1',a2:'A2',b1:'B1',b2:'B2',b3:'B3',c:'C','c-total':'Total C'};
const verified=new Set(['Lengkap','Kosong terverifikasi']);
const partial='Cuplikan';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const matches=(values,expected)=>values.filter(v=>v!==undefined&&v!==null&&v!=='').every(v=>String(v)===String(expected));
const nonempty=v=>object(v)&&Object.keys(v).length>0;
const footerFields=['TaxBase','OtherTaxBase','VAT','STLG'];

function identity(entry,form,npwp,part){
  const cap=entry.cap||{},ctx=cap.konteks||{},spt=ctx.spt||{},query=cap.payload||{};
  const [y,m]=form.period.split('-'),taxPeriod=m+m+y;
  const expectedKind=part==='induk'?'induk':part==='c-total'?'footer':'grid';
  const ids=[ctx.npwp,spt.npwp].filter(v=>v!=null&&v!=='');
  const owner=normalizeId(String(npwp??''));
  const recordIds=[spt.recordId,query.ReturnSheetRecordId,query.RecordId].filter(v=>v!=null&&v!=='');
  if(!owner||!ids.length||!ids.every(v=>normalizeId(String(v))===owner)||!recordIds.length||!matches(recordIds,form.id)||
    !matches([spt.jenis],'VAT_VATR')||!matches([spt.tahun],y)||!matches([spt.pemb],form.version)||
    (spt.masa!==taxPeriod&&spt.masa!==form.period)||spt.jenis!=='VAT_VATR'||spt.pemb==null||
    ctx.bagian!==part||ctx.jenisBagian!==expectedKind||entry.path!==form.key+'/'+part+'.json')return false;
  return true;
}
function declaredCount(v){
  return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
}
function gridStatus(entry,pages,row){
  const cap=entry.cap,groups=pages.map(body=>Array.isArray(body)?body:body?.Data??body?.rows);
  if(groups.some(data=>!Array.isArray(data)||data.some(r=>!nonempty(r))))return [partial,'Struktur baris belum dapat diperiksa.'];
  row['Baris tersimpan']=groups.reduce((n,g)=>n+g.length,0);
  const sources=Array.isArray(cap.halamanSumber)?cap.halamanSumber:[];
  const totals=[cap.total,...pages.flatMap(p=>[p?.TotalRecords,p?.TotalRecordCount,p?.TotalCount]),
    ...sources.map(p=>p?.total)].filter(n=>n!==undefined&&n!==null);
  if(totals.length&&totals.every(n=>declaredCount(n)&&n===totals[0]))row['Total menurut sumber']=totals[0];
  if(cap.baris!=null&&cap.baris!==row['Baris tersimpan'])return [partial,'Jumlah baris di metadata berbeda dari isi.'];
  if(row['Total menurut sumber']===null)return [partial,'Total jumlah baris belum tersedia atau berbeda antarhalaman.'];
  if(row['Total menurut sumber']!==row['Baris tersimpan'])return [partial,'Jumlah baris tersimpan berbeda dari total sumber.'];
  const printed=new Set();
  for(const group of groups.length>1?groups.filter(g=>g.length):[]){
    const signature=JSON.stringify(group);
    if(printed.has(signature))return [partial,'Isi halaman berulang. Periksa urutan halaman pada sumber.'];
    printed.add(signature);
  }
  return row['Baris tersimpan']===0?['Kosong terverifikasi','Respons tabel berisi daftar kosong dan total sumber 0.']:
    ['Lengkap','Jumlah baris tersimpan cocok dengan total sumber.'];
}
function formBody(p){
  const value=p?.FormData??p?.CurrentFormData;
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return null;}
}
function objectStatus(part,pages,c){
  if(pages.length!==1)return [partial,'Sumber berisi beberapa respons untuk satu bagian formulir.'];
  const body=pages[0];
  if(part==='induk'){
    const form=formBody(body);
    const fiscal=nonempty(form)&&Object.entries(form).some(([k,v])=>/VAT|Delivery|TaxBase|Export|Import|Taxable/i.test(k)&&
      (Number.isFinite(v)||nonempty(v)&&Object.values(v).some(Number.isFinite)));
    return fiscal?['Lengkap','Respons induk berisi isian PPN.']:[partial,'Isian PPN pada induk belum dapat dibaca.'];
  }
  if(!object(body))return [partial,'Respons total belum dapat dibaca.'];
  if(!Object.keys(body).length)return c?.Status==='Kosong terverifikasi'?['Kosong terverifikasi','Total C diterima tanpa isian. Lampiran C terbukti 0 baris.']:
    [partial,'Total C tanpa isian. C belum terverifikasi kosong.'];
  const amounts=footerFields.map(k=>body[k]);
  if(!amounts.every(Number.isFinite))return [partial,'Empat isian total C belum semuanya tersedia sebagai angka.'];
  if(c?.Status==='Kosong terverifikasi'&&amounts.some(n=>n!==0))return [partial,'Total C memuat nominal sementara lampiran C terverifikasi 0 baris.'];
  return ['Lengkap','Respons total berisi DPP, DPP nilai lain, PPN dan PPnBM.'];
}

export function vatCoverage(form,pkg){
  if(form.type!=='PPN')return null;
  const checked=[],failed=new Map(),manifest=pkg.manifest||{};
  for(const f of Array.isArray(manifest.gagal)?manifest.gagal:[]){
    if(typeof f?.path==='string')failed.set(f.path.replace(/^data\//,''),f);
  }
  for(const part of parts){
    const entry=form.parts.get(part),path=form.key+'/'+part+'.json',failure=failed.has(path);
    const row={Bagian:names[part],Status:'Belum ada','Berkas diterima':entry?'Ya':'Tidak','Baris tersimpan':null,'Total menurut sumber':null,
      Keterangan:'Berkas bagian ini belum tercantum dalam paket.',Sumber:path};
    checked.push(row);
    if(!entry){
      if(failure){row.Status='Gagal';row.Keterangan='Manifest mencatat permintaan gagal untuk bagian dan versi ini.';}
      continue;
    }
    if(!identity(entry,form,manifest.wp?.npwp,part)){
      row.Status=partial;row.Keterangan='Identitas WP, rekaman SPT, masa, pembetulan atau bagian belum cocok.';continue;
    }
    const cap=entry.cap||{},all=entry.pages||[],success=all.filter(p=>p&&p.IsSuccessful!==false&&!(Array.isArray(p.Errors)&&p.Errors.length));
    if(!success.length&&(all.length||failure)){row.Status='Gagal';row.Keterangan='Tidak ada respons berhasil untuk bagian ini.';continue;}
    if(!success.length){row.Status=partial;row.Keterangan='Berkas diterima tanpa halaman respons.';continue;}
    const payloads=success.map(p=>Object.hasOwn(p,'Payload')?p.Payload:p);
    const reason=part==='induk'||part==='c-total'?objectStatus(part,payloads,checked.find(r=>r.Bagian==='C')):gridStatus(entry,payloads,row);
    [row.Status,row.Keterangan]=reason;
    const notices=[];
    if(pkg.report?.valid===false)notices.push('Integritas paket perlu diperiksa.');
    if(failure||success.length!==all.length)notices.push('Ada permintaan atau halaman gagal.');
    if(cap.lengkap!==true)notices.push('Sumber belum menyatakan pengambilan lengkap.');
    if(cap.halaman!==all.length)notices.push('Jumlah halaman belum terverifikasi pada metadata.');
    if(success.some(p=>p.IsSuccessful!==true))notices.push('Respons belum menyatakan hasil berhasil.');
    if(cap.payload?.Filters?.length||Number(cap.payload?.First)>0)notices.push('Permintaan sumber dibatasi filter atau dimulai setelah baris pertama.');
    if(notices.length){
      row.Status=partial;
      row.Keterangan=[...(reason[0]===partial?[reason[1]]:[]),...notices].join(' ');
    }
  }
  return {received:checked.filter(r=>r['Berkas diterima']==='Ya').length,verified:checked.filter(r=>verified.has(r.Status)).length,rows:checked};
}
