import {rowsInColumnOrder,visibleTables} from './app-data.js';
import {sptDirectory} from './app-spt-directory.js';

const submitted='https://coretax.intranet.pajak.go.id/returnsheets/id-ID/submitted-returnsheets/';
export async function findSubmittedTab(ext,wp,chosen,checkpoint){
  const tabs=(await ext.tabs.query({url:submitted+'*'})).filter(t=>
    /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\/?$/i.test(new URL(t.url).pathname.split('/submitted-returnsheets/').at(-1)));
  const matches=[];
  for(const tab of tabs){
    await checkpoint();
    let frame;
    try{[frame]=await ext.scripting.executeScript({target:{tabId:tab.id},func:visibleTables,args:[{discoverSubmitted:true,wp,url:tab.url}]});}
    catch{continue;}
    if(frame?.result?.match)matches.push(tab);
  }
  if(matches.length===1)return matches[0];
  if(matches.length>1){
    const selected=matches.find(t=>t.id===chosen);
    if(selected)return selected;
    throw Object.assign(Error('Ada beberapa tab daftar untuk WP ini. Pilih salah satu pada Tab yang digunakan, lalu buka kembali pratinjau.'),{code:'MULTIPLE'});
  }
  if(tabs.length)throw Error('Daftar yang terbuka belum cocok dengan satu WP dan satu tabel SPT Dilaporkan. Periksa tab sumber.');
  return null;
}

export async function readSubmittedPreview(ext,tab,wp,{checkpoint,limit,onPage}){
  const directory=await sptDirectory(ext,tab.id,wp,{previewIndex:true,expectedUrl:tab.url});
  const seenRows=new Set(),report={pages:0,rows:0,total:null,fromFirst:false,toLast:false,filtered:false,note:''};
  let previous=null;
  try{
    let index=await directory.read();
    if(index.data.canFirst){await checkpoint();index=await directory.turn(index,'first');}
    while(true){
      await checkpoint();
      const {rows,position,canAdvance}=index.data,range=position.range;
      if(position.conflict || previous && Boolean(previous.range)!==Boolean(range) ||
          previous?.range && (range.total!==previous.range.total || range.first!==previous.range.last+1) ||
          previous && position.filterState!==previous.filterState)throw Error('Urutan, filter atau jumlah baris yang ditampilkan sumber berubah.');
      const ordered=rowsInColumnOrder(rows,index.options.labels),keys=ordered.map(r=>JSON.stringify(r));
      if(keys.some(k=>seenRows.has(k)))throw Error('Sebagian atau seluruh baris halaman ini telah muncul pada halaman sebelumnya.');
      keys.forEach(k=>seenRows.add(k));
      if(!report.pages)report.fromFirst=position.atStart;
      report.pages++;report.rows+=rows.length;report.total=range?.total??null;report.filtered=position.filtered;
      await onPage({rows:ordered,columns:index.options.labels,ownerEvidence:index.data.ownerEvidence,indexScope:index.data.indexScope,canAdvance,range},report);
      report.toLast=position.atEnd;
      if(!canAdvance)break;
      if(report.pages>=limit)throw Error('Batas halaman pratinjau tercapai saat halaman berikutnya masih tersedia.');
      previous=position;await checkpoint();index=await directory.turn(index,true);
    }
    if(!report.fromFirst || !report.toLast)report.note='Penanda awal dan akhir seluruh daftar belum terkonfirmasi.';
    else if(report.total!==null && report.rows!==report.total)report.note='Jumlah baris yang dibaca berbeda dari total pada tampilan sumber.';
  }catch(error){
    if(!report.pages)throw error;
    report.note=/chrome|tab id|https?:\/\/|frame/i.test(error.message)?'Tab sumber tidak lagi tersedia.':error.message;report.toLast=false;
  }
  return report;
}
