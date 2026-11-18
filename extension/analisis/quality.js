import {rowsOf, worksheet} from './model.js';
import {box,button,card,dataTable,el,exportSheets,select} from './ui.js';
import {parseDelimited,sources as sourceNames} from '../app-data.js';
import {reconcileLedgerTotals} from './ledger-reconciliation.js';

const severity = ['Kritis','Peringatan','Info'];
const safeCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const notesCache = new WeakMap();

function tableRows(page) {
  if(!page || page.IsSuccessful === false) return null;
  const body=page.Payload ?? page;
  return [body,body?.Data,body?.Taxpayers,body?.rows].find(Array.isArray) ?? null;
}

export function qualityNotes(pkg) {
  if(notesCache.has(pkg)) return notesCache.get(pkg);
  const notes=[],limitGroups=new Map();
  function add(level,source,test,observed,impact) {
    notes.push({Tingkat:level,Sumber:source,Pemeriksaan:test,Hasil:observed,'Dampak pada analisis':impact});
  }
  for(const issue of pkg.report.issues) add('Kritis','Paket','Integritas',issue,'Periksa salinan asli sebelum menggunakan paket sebagai bukti.');
  for(const f of Array.isArray(pkg.manifest.gagal)?pkg.manifest.gagal:[]) add('Peringatan',f?.label || f?.path || 'Manifest','Pengambilan gagal',
    typeof f==='string'?f:(f?.pesan || f?.teks || f?.error || 'Pengambilan tercatat gagal.'),'Data sumber ini dapat hilang dari ringkasan.');
  for(const check of Array.isArray(pkg.manifest.cek)?pkg.manifest.cek:[]) {
    const message=check?.teks || check?.pesan;
    if(!message) continue;
    const level=({tinggi:'Kritis',kritis:'Kritis',sedang:'Peringatan',warning:'Peringatan',peringatan:'Peringatan',info:'Info'})[String(check.lvl || check.tingkat).toLowerCase()] || 'Info';
    const effect=check.kode==='MASA-KOSONG'?'Penarik mencatat masa tanpa SPT yang ditemukan. Periksa kewajiban dan masa pelaporan WP.':
      (level==='Info'?'Catatan dari penarik saat paket dibuat.':'Periksa sumber terkait sebelum menggunakan hasil ringkasan.');
    add(level,'Manifest',check.kode || 'Catatan penarik',message,effect);
  }
  for(const entry of pkg.entries) {
    const {cap,pages,path}=entry;
    const sources=Array.isArray(cap.halamanSumber)?cap.halamanSumber.filter(item=>item && typeof item==='object'):[];
    const rawPages=pages.map(tableRows);
    const tabular=pages.length>0 && rawPages.every(Array.isArray);
    const rowCount=tabular?rawPages.reduce((n,rows)=>n+rows.length,0):null;
    if(cap.lengkap===false) add('Peringatan',path,'Cakupan sumber','Penarik belum memastikan kelengkapan.','Gunakan hasil untuk cakupan yang benar-benar tercatat.');
    if(safeCount(cap.halaman) && cap.halaman!==pages.length) add('Peringatan',path,'Jumlah halaman',
      cap.halaman+' pada metadata, '+pages.length+' tersimpan.','Periksa bagian yang mungkin belum terbawa.');
    if(pages.some(p=>p?.IsSuccessful===false)) add('Peringatan',path,'Respons gagal','Paket menyimpan respons yang ditandai gagal.','Bagian terkait tidak dapat dianggap lengkap.');
    if(tabular) {
      if(safeCount(cap.baris) && cap.baris!==rowCount) add('Peringatan',path,'Jumlah baris tersimpan',
        rowCount+' baris data, '+cap.baris+' pada metadata.','Hitung ulang sebelum memakai jumlah atau nilai agregat.');
      const expected=new Set([cap.total,...pages.map(p=>p?.Payload?.TotalRecords ?? p?.Payload?.TotalRecordCount ?? p?.Payload?.TotalCount)]
        .filter(safeCount));
      const limit=cap.payload?.Rows,lastEmpty=rawPages.at(-1).length===0;
      const repeatsLimit=cap.total===null && cap.payload?.First===0 && safeCount(limit) && limit>0 &&
        pages.every(p=>p.IsSuccessful===true && p.Payload?.TotalRecords===limit);
      if(repeatsLimit && rowCount===limit && !lastEmpty && sources.length<=1) {
        add('Peringatan',path,'Batas permintaan tercapai',rowCount+' baris tersimpan, sama dengan batas permintaan. Halaman penutup kosong belum tercatat.',
          'Periksa apakah sumber masih memiliki halaman berikutnya.');
      }
      // A grouped file can contain independent tables, each with its own footer.
      if(sources.length<=1 && expected.size>0 && (expected.size>1 || !expected.has(rowCount))) {
        const result=rowCount+' baris tersimpan. Total pada sumber '+[...expected].join(', ')+'.';
        if(repeatsLimit && rowCount<limit && !sources.length && cap.sumber && cap.lengkap===true &&
            cap.baris===rowCount && cap.halaman===pages.length && !cap.catatan?.length && !pkg.report.issues.length) {
          const key=JSON.stringify([cap.sumber,limit]);
          if(!limitGroups.has(key))limitGroups.set(key,[]);
          limitGroups.get(key).push({source:cap.sumber,path,result,rowCount,lastEmpty});
        }else{
          add('Peringatan',path,'Jumlah baris menurut sumber',result,'Periksa paginasi dan saringan sumber sebelum menjumlahkan data.');
        }
      }
    }
    for(const origin of sources) {
      const proof=origin.pencocokan || {};
      if(proof.morePagesAvailable) add('Peringatan',path,'Batas halaman tercapai',origin.asal || 'Masih ada halaman berikutnya.',
        'Ada baris setelah halaman terakhir yang dipilih.');
      const observed=origin.pemilihanBukuBesar?.barisSumber??origin.baris;
      if(Array.isArray(proof.pageRows) && proof.pageRows.every(safeCount) && safeCount(observed) &&
          proof.pageRows.reduce((n,x)=>n+x,0)!==observed) add('Peringatan',path,'Rincian baris per halaman',
          proof.pageRows.join(' + ')+' dibandingkan dengan '+observed+' baris.','Periksa kembali tabel yang masuk ke paket.');
    }
  }
  for(const row of reconcileLedgerTotals(pkg)){
    if(row.Hasil==='Saldo berbeda')add('Peringatan',row['Berkas sumber'],'Saldo buku besar',
      'Selisih rincian dan saldo pembanding Rp'+row['Selisih (Rp)'].toLocaleString('id-ID')+'.',row.Cakupan);
  }
  const counts=new Map();
  for(const group of limitGroups.values()) {
    // A positive result and an empty last page are independent evidence for the same source and limit.
    const corroborated=group.some(e=>e.rowCount>0) && group.some(e=>e.lastEmpty);
    for(const e of group) {
      if(corroborated)counts.set(e.source,(counts.get(e.source) || 0)+1);
      else add('Peringatan',e.path,'Jumlah baris menurut sumber',e.result,'Periksa paginasi dan saringan sumber sebelum menjumlahkan data.');
    }
  }
  if(counts.size){
    const affected=[...counts.values()].reduce((sum,n)=>sum+n,0);
    const labels=[...counts].map(([src,n])=>(sourceNames[src] || src)+' ('+n+')').join(', ');
    add('Info',labels,'Total respons sama dengan batas permintaan',affected+' berkas memuat total yang sama dengan batas permintaan. Jumlah baris tersimpan sesuai metadata penarik.',
      'Ada halaman akhir kosong untuk sumber dengan pola ini. Cocokkan dengan ekspor Coretax jika jumlah baris sebenarnya diperlukan.');
  }
  notes.sort((a,b)=>severity.indexOf(a.Tingkat)-severity.indexOf(b.Tingkat));
  notesCache.set(pkg,notes);
  return notes;
}

const headers = rows => [...new Set(rows.flatMap(row=>Object.keys(row)))];
const cellText = value => value===null || value===undefined ? '' : typeof value==='object' ? JSON.stringify(value) : String(value);

export function compareSourceRows(source, packaged, mapping) {
  const columns=Object.entries(mapping).filter(([,name])=>name);
  if(!columns.length) throw Error('Pasangkan sedikitnya satu kolom.');
  if(new Set(columns.map(([,name])=>name)).size!==columns.length) throw Error('Setiap kolom paket hanya dapat dipasangkan satu kali.');
  const differences=[];
  let equal=0,checked=0;
  for(let i=0;i<Math.max(source.length,packaged.length);i++) {
    if(i>=packaged.length || i>=source.length) {
      differences.push({Baris:i+1,'Kolom sumber':'','Kolom paket':'',Keterangan:i>=packaged.length?'Baris hanya ada di CSV':'Baris hanya ada di paket'});
      continue;
    }
    for(const [left,right] of columns) {
      checked++;
      const a=source[i],b=packaged[i];
      if(Object.hasOwn(a,left) && Object.hasOwn(b,right) && b[right]!=null && cellText(a[left])===cellText(b[right])) {equal++;continue;}
      differences.push({Baris:i+1,'Kolom sumber':left,'Kolom paket':right,'Nilai CSV':a[left]??'','Nilai paket':b[right]??'',
        Keterangan:!Object.hasOwn(b,right)?'Kolom tidak ada pada baris paket':b[right]===null?'Nilai null di paket':'Nilai berbeda'});
    }
  }
  const allSource=Object.keys(mapping).length===headers(source).length && columns.length===headers(source).length;
  const allPackaged=columns.length===headers(packaged).length;
  return {sourceCount:source.length,packageCount:packaged.length,columns:columns.length,equal,checked,differences,
    complete:allSource && allPackaged && !differences.length};
}

function sourceComparison(pkg) {
  const wp=pkg.manifest.wp;
  const unique=pkg.entries.filter(entry=>entry.pages.length && entry.pages.every(p=>Array.isArray(tableRows(p))));
  if(!unique.length) return el('p','Paket ini belum berisi tabel yang bisa dicocokkan dengan CSV.');
  let selected=unique.find(e=>e.path==='spt/daftar.json') || unique[0],source=[],serial=0;
  const panel=box(''), result=box(''), pairs=box('');
  const file=el('input');file.type='file';file.accept='.csv,text/csv';file.setAttribute('aria-label','Ekspor CSV tabel sumber');
  const ident=el('p','Pilih ekspor dari WP, tabel, saringan, halaman dan urutan yang sama. Pencocokan memakai teks yang terbaca di CSV.','hint');
  function setup() {
    pairs.replaceChildren();result.replaceChildren();if(!source.length)return;
    const records=rowsOf(selected),keys=headers(records),map=Object.create(null);
    for(const label of headers(source)) {
      map[label]=keys.includes(label)?label:'';
      pairs.append(select([['','Lewati kolom ini'],...keys],map[label],v=>{map[label]=v;result.replaceChildren();},'Kolom CSV '+label));
    }
    pairs.append(button('Cocokkan baris dan isi',()=>{
      result.replaceChildren();
      try {
        const r=compareSourceRows(source,records,map);
        const summary={ 'Baris CSV':r.sourceCount,'Baris paket':r.packageCount,'Kolom dipasangkan':r.columns,'Sel diperiksa':r.checked,'Sel sama':r.equal,
          'Baris atau sel berbeda':r.differences.length};
        result.append(el('h3',r.complete?'Seluruh baris dan kolom cocok':r.differences.length?'Ditemukan perbedaan':'Kolom yang dipasangkan cocok'),
          dataTable([summary],{wp,name:'Ringkasan pencocokan'}),dataTable(r.differences,{wp,name:'Perbedaan dengan CSV',empty:'Tidak ada perbedaan pada kolom yang dipasangkan.'}),
          button('Excel hasil pencocokan',()=>exportSheets([{name:'Ringkasan',rows:[['Sumber paket',selected.path],...worksheet([summary])]},
            {name:'Pasangan kolom',rows:[['CSV','Paket'],...Object.entries(map)]},{name:'Perbedaan',rows:worksheet(r.differences)}],'Pencocokan-tabel',wp)));
      }catch(e){result.append(el('p',e.message,'notice error'));}
    }));
  }
  file.onchange=async()=>{
    const request=++serial,current=file.files[0];source=[];setup();
    if(!current)return;
    try{const rows=parseDelimited(await current.text());if(request!==serial)return;source=rows;
      if(!source.length)throw Error('CSV belum memuat baris data.');setup();
    }catch(e){if(request===serial)result.replaceChildren(el('p',e.message,'notice error'));}
  };
  panel.append(ident,select(unique.map(e=>[e.path,e.path]),selected.path,v=>{
    selected=unique.find(e=>e.path===v);setup();
  },'Tabel dalam paket'),file,pairs,result);
  return panel;
}

export function renderQuality(root,pkg,back) {
  const wp=pkg.manifest.wp;
  const notes=qualityNotes(pkg),rows=box('');
  const show=level=>rows.replaceChildren(dataTable(notes.filter(n=>!level || n.Tingkat===level),{wp,name:'Catatan mutu',filename:'Catatan-mutu',empty:'Tidak ada catatan pada pilihan ini.'}));
  show('');
  root.append(card('Rincian mutu data',box('toolbar',button('Kembali ke Muat paket',back),
    select([['','Semua tingkat'],...severity],'',show,'Tingkat catatan')),rows));
  const ledger=reconcileLedgerTotals(pkg);
  if(ledger.length)root.append(card('Saldo buku besar per periode',el('p','Jumlah transaksi bertanda positif dan negatif dibandingkan dengan saldo pada filter sumber yang sama. Setiap masa dan tahun diperiksa sendiri.','hint'),
    dataTable(ledger,{wp,name:'Pencocokan saldo buku besar',filename:'Saldo-buku-besar'})));
  root.append(card('Cocokkan tabel dengan ekspor Coretax',sourceComparison(pkg)));
}
