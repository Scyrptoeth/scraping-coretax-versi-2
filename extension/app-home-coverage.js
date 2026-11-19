import {normalizeId,rowsOf,sources} from './app-data.js';

export const taxRegistrationGroups=['Pendaftaran Tertunda','Terdaftar untuk Jenis Pajak Berikut','Permohonan yang Ditolak untuk Jenis Pajak Berikut',
  'Penarikan selama Proses Permintaan untuk Jenis Pajak Berikut','Tidak Terdaftar untuk Jenis Pajak Berikut'];
const singleTable=new Set(['pihak','klu','nomorlain','dokumen','flag','pbb','sptarsip','sptbelum']);

export function homeTableSections(source){
  if(source==='alamat')return ['Alamat','Tempat Kegiatan Usaha/Sub Unit'];
  if(source==='jenispajak')return taxRegistrationGroups;
  return singleTable.has(source)?[sources[source]]:[];
}

export async function homeDigest(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function homeRowStamp(rows,columns){
  return homeDigest(rows.map(row=>columns.map(k=>row[k])));
}

async function checkTable(page,observation,source,owner){
  const proof=observation.pencocokan,home=proof?.dariBeranda,table=home?.buktiTabel,rows=rowsOf(page);
  if(!table||table.versi!==1||table.sumber!==source||table.npwp!==owner||!/^[a-f0-9]{64}$/.test(table.konteksWp)||
    observation.metode!=='Dari beranda Coretax'||!Array.isArray(table.halaman)||!table.halaman.length||table.halaman.length!==home.jumlahHalaman||
    home.rentangUtuh!==true||home.filterAktif!==false||proof.morePagesAvailable!==false||
    !Array.isArray(proof.columns)||!proof.columns.length||new Set(proof.columns).size!==proof.columns.length||
    page.IsSuccessful===false||page.Errors?.length||!Number.isSafeInteger(home.totalTampilan)||home.totalTampilan<0||
    home.totalTampilan!==rows.length||home.barisSumber!==rows.length||observation.baris!==rows.length)return null;
  if(!rows.every(row=>row&&typeof row==='object'&&proof.columns.every(col=>Object.hasOwn(row,col))))return null;
  if(source==='jenispajak'&&!rows.every(row=>row['Kelompok pendaftaran']===home.bagian))return null;
  if(!rows.length){
    if(!home.kosongPadaSumber||!proof.nolPadaSumber||page.Payload?.TotalRecords!==0||table.halaman.length!==1)return null;
  }else if(home.kosongPadaSumber||proof.nolPadaSumber)return null;
  const priorRows=new Set();
  let last=0;
  for(const part of table.halaman){
    const from=rows.length?last+1:0;
    if(part.dari!==from||!Number.isSafeInteger(part.sampai)||part.sampai<from||part.sampai>rows.length||
      part.total!==home.totalTampilan||part.filterAktif!==false)return null;
    const slice=rows.slice(last,part.sampai);
    if(await homeRowStamp(slice,proof.columns)!==part.sidikBaris)return null;
    const keys=slice.map(row=>JSON.stringify(proof.columns.map(col=>row[col])));
    if(keys.some(k=>priorRows.has(k)))return null;
    for(const key of keys)priorRows.add(key);
    last=part.sampai;
  }
  return last===rows.length?{rows:last,section:home.bagian,context:table.konteksWp}:null;
}

export async function finishHomeTable({cap,pages}){
  const wanted=homeTableSections(cap.sumber),evidence=cap.halamanSumber||[];
  if(!wanted.length||!evidence.some(h=>h.pencocokan?.dariBeranda))return;
  const owner=normalizeId(cap.konteks?.npwp);
  let total=0,context;
  const seen=new Set();
  if(owner&&pages.length===evidence.length){
    for(const [i,page] of pages.entries()){
      const checked=await checkTable(page,evidence[i],cap.sumber,owner);
      if(!checked||!wanted.includes(checked.section)||seen.has(checked.section)||context&&context!==checked.context){
        cap.lengkap=false;cap.total=null;return;
      }
      context=checked.context;seen.add(checked.section);total+=checked.rows;
    }
  }
  if(wanted.length!==seen.size||total!==cap.baris){
    cap.lengkap=false;cap.total=null;
    const missing=wanted.filter(section=>!seen.has(section));
    if(missing.length)cap.catatan.push('Kelengkapan bagian '+missing.join(', ')+' masih perlu diperiksa.');
    return;
  }
  cap.lengkap=true;cap.total=total;
  const msg=total?'Seluruh '+total+' baris pada '+wanted.length+' bagian cocok dengan tabel Coretax tanpa filter.':
    'Coretax menampilkan nol baris untuk seluruh bagian yang diperiksa tanpa filter.';
  if(!cap.catatan.includes(msg))cap.catatan.push(msg);
}
