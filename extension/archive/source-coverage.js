import {sources} from '../app-data.js';

// A source can have several months, forms or pages. A present file proves only its own contents.
export function sourceCoverage(manifest,entries){
  const requested=Array.isArray(manifest.opsi?.sumber)?new Set(manifest.opsi.sumber.filter(k=>typeof k==='string'&&k)):null;
  const rows=new Map(),declared=new Map(),read=new Set(),conflicts=new Set();
  const observed=new Map(entries.map(e=>[e.path,e.cap?.sumber]));
  const codeOf=s=>typeof s==='string'&&s.length?s:undefined;
  function group(code){
    if(!rows.has(code)){
      const name=Object.hasOwn(sources,code)?sources[code]:code==='cari2'?'Identitas WP dari pencarian':code;
      rows.set(code,{Sumber:name,'Pilihan penarik':requested?(requested.has(code)?'Dipilih':'Di luar daftar pilihan'):'Tidak tercatat',
        'Berkas di manifest':0,'Berkas terbaca':0,'Berkas ditandai lengkap':0,Hasil:''});
    }
    return rows.get(code);
  }
  for(const code of requested||[])group(code);
  for(const file of manifest.files||[]){
    if(typeof file?.path!=='string'||declared.has(file.path))continue;
    const code=codeOf(file.sumber)||codeOf(observed.get(file.path))||'Sumber tanpa keterangan';
    declared.set(file.path,code);group(code)['Berkas di manifest']++;
  }
  for(const entry of entries){
    if(read.has(entry.path))continue;
    read.add(entry.path);
    const captured=codeOf(entry.cap?.sumber),listed=declared.get(entry.path);
    const row=group(listed||captured||'Sumber tanpa keterangan');
    if(captured&&listed&&listed!==captured)conflicts.add(row);
    row['Berkas terbaca']++;
    if(entry.cap?.lengkap===true)row['Berkas ditandai lengkap']++;
  }
  for(const row of rows.values()){
    const total=row['Berkas di manifest'],opened=row['Berkas terbaca'];
    if(conflicts.has(row))row.Hasil='Kode sumber pada berkas berbeda dari manifest';
    else if(opened<total)row.Hasil='Ada berkas yang tercantum tetapi tidak terbaca';
    else if(opened>total)row.Hasil='Ada berkas terbaca di luar daftar manifest';
    else if(!opened)row.Hasil='Belum ada berkas dalam paket';
    else if(row['Berkas ditandai lengkap']<opened)row.Hasil='Berkas tersedia, periksa kelengkapan';
    else row.Hasil='Semua berkas yang tercantum terbaca';
  }
  return [...rows.values()];
}
