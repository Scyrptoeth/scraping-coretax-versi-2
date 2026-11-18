import assert from 'node:assert/strict';
import test from 'node:test';
import {appendPackageEntry,finishOpenTable} from '../extension/app-package-entries.js';
import {createPackage,readPackage} from '../extension/archive/package.js';
import {sourceCoverage} from '../extension/archive/source-coverage.js';

const wp='0000000000000028';
function captured(){
  const groups=new Map();
  for(const [index,numbers] of [['R1','R2'],['R3']].entries()){
    const data=numbers.map(BankAccountNumber=>({NPWP:wp,BankAccountNumber}));
    const last=index===1,first=last?3:1;
    const range={first,last:first+data.length-1,total:3};
    appendPackageEntry(groups,{source:'bank',period:'2025-01 s.d. 2025-12',name:'Rekening bank',origin:'Tab uji',
      page:{Payload:{Data:data}},rows:data.length,total:null,proof:{columns:['NPWP','BankAccountNumber'],owner:['NPWP'],
        morePagesAvailable:!last,pratinjauSumber:{masa:'',filterAktif:false,barisPadaMasa:data.length,barisPadaTabel:data.length,
          sidikIsi:numbers.join(','),paginasi:{versi:1,halaman:index+1,awal:!index,akhir:last,rentang:range,
            sidikFilter:'tanpa filter',sidikRangkaian:'satu tab',sidikHalaman:'bukti-'+index}}}},wp);
  }
  return [...groups.values()][0];
}
test('the ZIP and player count a complete open table only after contiguous unfiltered pages for one owner',async()=>{
  const e=captured();
  finishOpenTable(e);assert.equal(e.cap.total,3);assert.equal(e.cap.lengkap,true);
  const p=await readPackage(await createPackage({meta:{wp:{npwp:wp},opsi:{sumber:['bank']}},entries:[e]}));
  assert.equal(p.report.valid,true);assert.equal(sourceCoverage(p.manifest,p.entries)[0]['Berkas ditandai lengkap'],1);
});
test('missing, overlapping, cross-owner, filtered, or incompatible pages cannot certify a whole table',()=>{
  for(const change of [
    (e,p)=>{p.akhir=false;},(e,p)=>{p.rentang.first=2;},(e,p)=>{p.rentang.total=4;},
    (e,p)=>{p.sidikRangkaian='tab dua';},(e,p)=>{p.sidikFilter='baru';},
    (e,p)=>{p.sidikHalaman='bukti-0';},e=>{e.pages[1].Payload.Data[0].BankAccountNumber='R2';},
    (e,p,v)=>{v.filterAktif=true;},(e,p,v)=>{v.masa='2025-01';},
    e=>{e.pages[1].Payload.Data[0].NPWP='0000000000000029';},
    e=>{e.pages[1].Errors=['gagal'];},
    e=>{e.cap.halamanSumber[0].pencocokan.columns.reverse();},
    e=>{e.cap.halamanSumber[1].pencocokan.morePagesAvailable=true;},
    e=>{e.pages.pop();e.cap.halamanSumber.pop();e.cap.baris=2;},
  ]){
    const e=captured(),v=e.cap.halamanSumber[1].pencocokan.pratinjauSumber;
    change(e,v.paginasi,v);finishOpenTable(e);assert.equal(e.cap.lengkap,false);
  }
});
