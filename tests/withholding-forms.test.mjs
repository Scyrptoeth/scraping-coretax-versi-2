import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readPackage} from '../extension/archive/package.js';
import {indexPackage,rowsOf} from '../extension/analisis/model.js';
import {financialPosition,formSheets} from '../extension/analisis/spt-forms.js';
import {withholdingForm,withholdingPeriods,withholdingSnapshot} from '../extension/analisis/withholding-forms.js';
import {monthlyWithholding} from '../extension/analisis/monthly-withholding.js';
const wp={npwp:'0000000000000017',nama:'WP uji'},period='2025-02';
function captured(type,version,body,annex={}){
  const code=type==='PPH2126'?'ICT_WITR':'ICT_WTR',id='uji-'+version;
  const entries=Object.entries({induk:body,...annex}).map(([part,data])=>({
    path:'spt/'+type+'/'+period+'/p0'+version+'_'+id+'/'+part+'.json',
    cap:{sumber:'sptisi',lengkap:true,konteks:{npwp:wp.npwp,spt:{recordId:id,pemb:version,jenis:code,masa:'02022025'}}},
    pages:[{IsSuccessful:true,Payload:part==='induk'?{FormData:JSON.stringify(data)}:{TotalRecords:data.length,Data:data}}]}));
  return indexPackage({manifest:{wp},report:{valid:true},entries}).forms[0];
}
test('employee form retains zero, separates source totals from components, and chooses only the latest revision per period',()=>{
  const group='TotalGrossIncomeAndIncomeTaxBorneByGovernmentAndIncomeTaxWithheld';
  const original=captured('PPH2126',0,{Form1A:{GrossIncome:999},A21IncomeTaxWithheld:100});
  const amended=captured('PPH2126',1,{Form1A:{GrossIncomeAndIncomeTaxWithheld:{GrossIncome:90,IncomeTax:9},
    GrossIncomeAndIncomeTaxBorneByGovernment:{GrossIncome:10,IncomeTax:1},[group]:{GrossIncome:'100.00',IncomeTax:10}},
    A21IncomeTaxWithheld:10,A21IncomeTaxPaidOnAmended:5,A21IncomeTaxUnderpaidOverpaidDueToAmendment:0,
    A26IncomeTaxUnderpaidOverpaidDueToAmendment:-2},{l1a:[{GrossIncome:90,IncomeTax:9},{GrossIncome:10,IncomeTax:1}]});
  const r=withholdingForm(amended,wp);
  assert.equal(r.values.find(v=>v.Isian==='A21IncomeTaxUnderpaidOverpaidDueToAmendment').Nilai,0);
  assert.equal(r.values.find(v=>v.Isian==='A26IncomeTaxUnderpaidOverpaidDueToAmendment').Nilai,-2);
  assert.equal(r.groups.find(v=>v.Uraian==='Jumlah pada formulir').Bruto,100);
  assert.equal(r.attachments[0].Bruto,100);assert.ok(r.attachments[0].Sumber.includes('p01_'));
  const annual=withholdingPeriods([original,amended],'2025',wp);assert.equal(annual.rows.length,1);
  assert.equal(annual.rows[0]['Bruto L-I A'],100);assert.ok(annual.rows[0]['Sumber bruto L-I A'].includes(group));
  assert.equal(withholdingPeriods([original,amended,{...amended,id:'versi-konflik'}],2025,wp).rows.length,0);
  const conflicting=captured('PPH2126',0,{Form1A:{GrossIncome:99,[group]:{GrossIncome:100}}});
  assert.equal(withholdingPeriods([conflicting],2025,wp).rows[0]['Bruto L-I A'],null);
});
test('unified articles and child objects retain hierarchy, old keys and amendment figures without adding them together',()=>{
  const a={Type:'Tax Article',No:'1',Name:'Article 23',TotalWithholding:36,TotalIncomeTaxPaid:35,TotalIncomeTaxPaidPreviousReturn:30,TotalIncomeTaxAmendment:5};
  const f=captured('UNIFIKASI',1,{IncomeTaxes:[{data:a,children:[{data:{Type:'Tax Object',Name:'Uji objek',TotalWithholding:36}}]}],
    TotalWithholding:36,TotalIncomeTaxPaid:35,TotalIncomeTaxToBePaidBPUBPNR:33,TotalIncomeTaxByGoverment:0,TotalIncomeTaxAmendment:5},
    {'d1-bpu':[{WithholdingSlipsNumber:'0001',TaxBase:300,IncomeTax:36,Status:'NORMAL'},{WithholdingSlipsNumber:'0002',TaxBase:200,IncomeTax:20,Status:'CANCELLED'}]});
  const model=withholdingForm(f,wp);assert.equal(model.articles.length,2);
  assert.equal(model.articles[0]['Jumlah dipotong'],36);assert.equal(model.articles[1].Pasal,'Article 23');
  assert.equal(model.articles[1]['PPh karena pembetulan'],undefined);assert.equal(model.articles[1].Isian,'IncomeTaxes[0].children[0].data');
  assert.equal(model.values.find(r=>r.Isian==='TotalIncomeTaxByGoverment').Nilai,0);
  assert.equal(model.values.find(r=>r.Isian==='TotalIncomeTaxToBePaidBPUBPNR').Nilai,33);
  const annex=model.attachments.find(r=>r.Kode==='d1-bpu');assert.equal(annex['Baris sumber'],2);assert.equal(annex['Baris dalam rekap'],1);
  assert.equal(annex.DPP,300);assert.equal(annex.PPh,36);
  const sheet=formSheets([f],{manifest:{wp}})[0];assert.ok(sheet.rows.some(r=>r.includes('PPh per pasal dan rincian objek')));
  assert.ok(sheet.rows.some(r=>r.includes('Uji objek')));assert.ok(!formSheets([f],{manifest:{wp}},true)[0].rows.some(r=>r.includes('PPh per pasal dan rincian objek')));
});
test('unavailable, partial, duplicate, cancelled, wrong-version or unrecognised evidence cannot supply a complete total',()=>{
  const doc={WithholdingSlipsNumber:'001',TaxBase:100,IncomeTax:0};
  function index(mutate){
    const f=captured('UNIFIKASI',0,{TotalWithholding:50},{'d1-bpu':[doc]});mutate(f.parts.get('d1-bpu'));
    return withholdingForm(f,wp).attachments.find(r=>r.Kode==='d1-bpu');
  }
  assert.equal(index(()=>{}).PPh,0);
  const failed=index(e=>e.pages[0].IsSuccessful=false);
  assert.equal(failed.Status,'Gagal');assert.equal(failed['Baris sumber'],null);
  const partial=index(e=>e.pages.push({IsSuccessful:false}));
  assert.equal(partial.Status,'Sebagian halaman gagal');assert.equal(partial['Baris sumber'],1);assert.equal(partial.PPh,null);
  for(const change of [e=>e.cap.lengkap=false,e=>e.pages[0].Payload.TotalRecords=2,e=>e.pages[0].IsSuccessful=false,
    e=>e.cap.konteks.spt.pemb=2,e=>e.cap.konteks.npwp='0000000000000028',
    e=>e.pages[0].Payload.Data[0]={...doc,Status:'OBSOLETE'},e=>{e.pages[0].Payload.Data.push({...doc});e.pages[0].Payload.TotalRecords=2;}]){
    assert.equal(index(change).PPh,null);
  }
  const empty=index(e=>{e.pages[0].Payload.Data=[];e.pages[0].Payload.TotalRecords=0;});
  assert.equal(empty.Status,'Kosong terverifikasi');assert.equal(empty.PPh,null);
  const f=captured('UNIFIKASI',0,{TotalIncomeTaxByGoverment:0,TotalIncomeTaxByGovernment:1});
  assert.equal(withholdingForm(f,wp).values[0].Nilai,null);
  assert.equal(withholdingForm(f,wp).attachments[0].Status,'Belum ada');
});
test('displayed rupiah cells preserve amounts and their location without certifying form or annex coverage',()=>{
  const id='cuplikan-'+'a'.repeat(64),path='spt/PPH2126/'+period+'/p01_'+id+'/induk.json';
  const cells=[];
  const cell=(Tabel,Baris,Kolom,value)=>cells.push({Tabel,Baris,Kolom,'Isian pada formulir':value});
  for(const [table,article,withheld,balance] of [[2,21,'1.500,50','-25'],[5,26,'0','0']]){
    cell(table,1,2,'URAIAN');cell(table,1,4,'JUMLAH (Rp)');
    cell(table,2,2,'PPH PASAL '+article+' YANG DIPOTONG');cell(table,2,3,'105');cell(table,2,4,withheld);
    cell(table,3,2,'PPH PASAL '+article+' YANG KURANG (LEBIH) DISETOR (1-2-3)');cell(table,3,4,balance);
  }
  const entry={path,cap:{sumber:'sptisi',lengkap:false,konteks:{npwp:wp.npwp,cuplikanTampilan:true,bagian:'induk',
    spt:{jenis:'ICT_WITR',masa:'02022025',pemb:1,nomor:'BPE-UJI-0002'}}},
    pages:[{Payload:{Data:cells}}]};
  const f=indexPackage({manifest:{wp},entries:[entry]}).forms[0];
  const snapshot=withholdingSnapshot(f,wp);
  assert.deepEqual(snapshot.map(item=>item.value),[1500.5,-25,0,0]);
  assert.match(snapshot[0].source,/Tabel 2.*Baris 2.*Kolom 4/);
  const data=withholdingForm(f,wp),sheets=formSheets([f],{manifest:{wp}});
  assert.equal(data.snapshot,true);
  assert.equal(data.attachments.every(row=>row.PPh===null),true);
  assert.ok(sheets[0].rows.some(row=>row.includes('Angka pada cuplikan induk')));
  assert.ok(sheets[0].rows.some(row=>row.includes(1500.5)&&row.includes(path)));
  assert.equal(financialPosition(f,wp).amount,-25);
  assert.equal(withholdingPeriods([f],'2025',wp).rows[0]['Bruto L-I A'],null);
  assert.equal(monthlyWithholding([f],'2025',wp).total['PPh Pasal 21 · PPh'],1500.5);
  assert.equal(monthlyWithholding([f],'2025',wp).total['PPh Pasal 21 · objek'],null);
  cell(5,3,4,'8');
  assert.equal(financialPosition(f,wp).amount,null);
  assert.equal(withholdingSnapshot(f,{npwp:'0000000000000028'}).length,0);
});
test('all 104 withholding returns in the four fictitious packages preserve amounts from their own parents and details',async t=>{
  const dir=process.env.VERITAX_FIXTURES;if(!dir)return t.skip('Four fictitious examples are optional');
  const counts={PPH2126:0,UNIFIKASI:0};let without=0;
  for(const name of (await readdir(dir)).filter(n=>/^CONTOH.*FIKTIF.*\.zip$/.test(n))){
    const pkg=indexPackage(await readPackage(await readFile(join(dir,name))));
    const fs=pkg.forms.filter(f=>Object.hasOwn(counts,f.type));if(!fs.length)without++;
    for(const f of fs){
      const model=withholdingForm(f,pkg.manifest.wp),source=rowsOf(f.parts.get('induk'))[0];counts[f.type]++;
      if(f.type==='PPH2126'){
        assert.equal(model.groups.find(r=>r.Lampiran==='L-I A').Bruto,source.Form1A.GrossIncome);
        assert.equal(model.values.find(r=>r.Isian==='A21IncomeTaxWithheld').Nilai,source.A21IncomeTaxWithheld);
      }else{
        assert.equal(model.values.find(r=>r.Isian==='TotalIncomeTaxPaid').Nilai,source.TotalIncomeTaxPaid);
        assert.deepEqual(model.articles.map(r=>r['Jumlah dipotong']),source.IncomeTaxes.map(n=>n.data.TotalWithholding));
      }
      assert.ok(model.attachments.every(r=>['Lengkap','Kosong terverifikasi'].includes(r.Status)));
    }
  }
  assert.deepEqual(counts,{PPH2126:69,UNIFIKASI:35});assert.equal(without,2);
});
