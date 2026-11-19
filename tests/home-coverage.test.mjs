import assert from 'node:assert/strict';
import test from 'node:test';
import {finishHomeTable,homeDigest,homeRowStamp,homeTableSections} from '../extension/app-home-coverage.js';
import {readSourcePages} from '../extension/app-home-sources.js';

const owner='0000000000000017',columns=['Uraian'];
const context=await homeDigest([owner,'daftar simulasi']);

test('automatic source pagination rereads a changed page before advancing and retaining it',async()=>{
  const table={index:0,tableId:'simulasi',title:'Dokumen',labels:columns};
  let page=1,caption='Memuat',moves=0,updates=0;
  const run=async(id,fn,request)=>{
    if(request===null)return [table];
    if(request.homeRead.move&&caption==='Memuat'){
      caption='Dokumen pertama';
      return {stalePage:true};
    }
    if(request.homeRead.move){
      page=2;caption='Dokumen kedua';moves++;
      return {moved:true};
    }
    if(page===2&&updates++===0)return {rows:[{Uraian:'Memuat ulang'}],pageNumber:null,range:null,
      filterHash:'tanpa-filter',stamp:'paginasi sedang diperbarui'};
    return {rows:[{Uraian:caption}],pageNumber:page,atStart:page===1,atEnd:page===2,canAdvance:page===1,
      range:{first:page,last:page,total:2},filterHash:'tanpa-filter',stamp:caption};
  };
  const source=await readSourcePages({run,id:1,table,url:'sumber simulasi',screen:()=>true});
  assert.deepEqual(source.rows,[{Uraian:'Dokumen pertama'},{Uraian:'Dokumen kedua'}]);
  assert.equal(source.complete,true);
  assert.equal(moves,1);
});
async function packageEntry(source,sections){
  const pages=[],evidence=[];
  for(const [name,blocks] of sections){
    const rows=blocks.flat().map(Uraian=>source==='jenispajak'?{Uraian,'Kelompok pendaftaran':name}:{Uraian});
    const trace=[];
    let offset=0;
    for(const block of blocks){
      const next=offset+block.length;
      trace.push({dari:rows.length?offset+1:0,sampai:next,total:rows.length,filterAktif:false,sidikBaris:await homeRowStamp(rows.slice(offset,next),columns)});
      offset=next;
    }
    pages.push({Payload:{Data:rows,...(!rows.length?{TotalRecords:0}:{})}});
    evidence.push({metode:'Dari beranda Coretax',baris:rows.length,pencocokan:{columns,morePagesAvailable:false,nolPadaSumber:!rows.length,
      dariBeranda:{bagian:name,barisSumber:rows.length,jumlahHalaman:blocks.length,rentangUtuh:true,filterAktif:false,totalTampilan:rows.length,
        kosongPadaSumber:!rows.length,buktiTabel:{versi:1,sumber:source,npwp:owner,konteksWp:context,halaman:trace}}}});
  }
  return {cap:{sumber:source,konteks:{npwp:owner},catatan:[],lengkap:false,baris:pages.reduce((n,p)=>n+p.Payload.Data.length,0),halamanSumber:evidence},pages};
}
test('hanya satu WP dan setiap bagian Alamat/TKU yang utuh dapat digabung sebagai data lengkap',async()=>{
  const sets=[['Alamat',[['A'],['B']]],['Tempat Kegiatan Usaha/Sub Unit',[['Z']]]];
  const entry=await packageEntry('alamat',sets);
  await finishHomeTable(entry);
  assert.equal(entry.cap.lengkap,true);assert.equal(entry.cap.total,3);
  for(const invalidate of [
    e=>{e.cap.halamanSumber[1].pencocokan.dariBeranda.buktiTabel.npwp='0000000000000021';},
    e=>{e.cap.halamanSumber[1].pencocokan.dariBeranda.buktiTabel.konteksWp='0'.repeat(64);},
    e=>{e.cap.halamanSumber.pop();e.pages.pop();e.cap.baris=2;},
    e=>{e.cap.halamanSumber[0].pencocokan.dariBeranda.filterAktif=true;},
    e=>{e.cap.halamanSumber[0].pencocokan.dariBeranda.buktiTabel.halaman[1].dari=3;},
    e=>{e.pages[0].Payload.Data[0].Uraian='data berbeda';},
    e=>{e.cap.halamanSumber[1].pencocokan.dariBeranda.bagian='Alamat';},
    e=>{e.cap.halamanSumber[0].pencocokan.morePagesAvailable=true;}
  ]){
    const changed=structuredClone(entry);invalidate(changed);await finishHomeTable(changed);
    assert.equal(changed.cap.lengkap,false);assert.equal(changed.cap.total,null);
  }
});
test('nol eksplisit dan kelima kelompok pendaftaran diverifikasi secara terpisah',async()=>{
  const empty=await packageEntry('pbb',[[homeTableSections('pbb')[0],[[]]]]);
  await finishHomeTable(empty);assert.equal(empty.cap.lengkap,true);assert.equal(empty.cap.total,0);
  delete empty.pages[0].Payload.TotalRecords;await finishHomeTable(empty);assert.equal(empty.cap.lengkap,false);
  const status=homeTableSections('jenispajak');
  const all=await packageEntry('jenispajak',status.map((label,i)=>[label,i===1?[['A']]:[[]]]));
  await finishHomeTable(all);assert.equal(all.cap.lengkap,true);assert.equal(all.cap.total,1);
  all.pages[1].Payload.Data[0]['Kelompok pendaftaran']='Status berbeda';await finishHomeTable(all);assert.equal(all.cap.lengkap,false);
  const one=await packageEntry('jenispajak',[[status[1],[['A']]]]);await finishHomeTable(one);assert.equal(one.cap.lengkap,false);
});
test('formulir, subtotal, dan potongan yang mengulang baris pada halaman berikutnya tidak disahkan sebagai tabel lengkap',async()=>{
  const repeated=await packageEntry('klu',[[homeTableSections('klu')[0],[['A','B'],['B','C']]]]);
  await finishHomeTable(repeated);assert.equal(repeated.cap.lengkap,false);
  for(const source of ['info','bbtotal','bbsaldo','login']){
    const form=await packageEntry(source,[[source,[['A']]]]);await finishHomeTable(form);assert.equal(form.cap.lengkap,false);
  }
});
