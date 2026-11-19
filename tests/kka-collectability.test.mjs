import assert from 'node:assert/strict';
import test from 'node:test';
import {kkaCollectabilityAppendix} from '../extension/analisis/kka-collectability.js';

const owner='0000000000000035';
const entry=(source,path,data,cap={})=>({path,cap:{sumber:source,lengkap:true,baris:data.length,total:data.length,
  konteks:{npwp:owner},...cap},pages:[{IsSuccessful:true,Payload:{Data:data}}]});
const period={from:{y:2025,m:1},to:{y:2025,m:1}};
const filter={PropertyName:'PeriodCode',MatchMode:'equals',Value:'01012025'};
const captured={
  report:{valid:true},manifest:{wp:{npwp:owner},dibuat:'2025-08-19',opsi:{periode:period}},
  entries:[
    entry('info','profil/informasi-umum.json',[{GeneralInformation:{UniqueIdentificationNumber:owner,
      TaxpayerType:'TA002',TaxpayerStatus:'ACTIVE',IsUnderEnforcement:false}}]),
    entry('alamat','profil/alamat.json',[{TypeOfAddress:'MAIN',ValidFrom:'2021-01-01',ValidTo:null}]),
    entry('pihak','profil/pihak-terkait.json',[{RelatedPersonType:'C_LC_DI',PersonName:'Direktur Fiktif',ValidFrom:'2021-01-01',ValidTo:null}]),
    entry('bank','profil/rekening-bank.json',[{BankCode:'Bank fiktif',BankAccountNumber:'0009'}]),
    entry('pbb','profil/tanah-bangunan.json',[{TaxObjectNumber:'0001',TaxObjectName:'Objek fiktif'}]),
    entry('sptdaftar','spt/daftar.json',[{ReturnSheetTypeCode:'VAT_VATR',ReturnSheetModel:'Normal',TaxPeriodCode:'01012025',
      ReturnSheetStatusCode:'SUBMITTED',ReturnDate:'2025-04-01'}]),
    entry('bb','bukubesar/2025-01.json',[{RecordId:'1',AccountingTypeCode:'TaxNotice',AccountingTypeDetailCode:'NOTC',
      IsCancelled:false,PeriodCode:'01012025',Amount:-20,AmountLeft:0}],{payload:{Filters:[filter]}}),
    entry('bbtotal','bukubesar-total/2025-01.json',[{Key:'Filtered',Balance:-20}],{payload:{Filters:[filter]}})
  ]
};
const ability=values=>Object.fromEntries(['principal','cash','workingCapital','operatingCashflow'].map((key,i)=>[key,{value:values[i],source:'Sumber uji'}]));
const get=(r,name)=>r.rows.find(x=>x[0]===name)[1];

test('KKA L-11 reuses proved inputs and exposes the eight factors plus source details',()=>{
  const r=kkaCollectabilityAppendix(captured,'2025',{analysis:{collectability:'Catatan petugas fiktif'}},ability([100,101,null,null]));
  assert.equal(get(r,'Indikasi dari data paket'),'Tinggi');
  assert.equal(get(r,'Pertimbangan petugas'),'Catatan petugas fiktif');
  assert.equal(get(r,'Kewajiban belum lunas'),'Mendukung');
  assert.ok(r.workbook.rows.some(row=>row[1]==='0009'&&row[2]==='profil/rekening-bank.json'));
  assert.ok(r.workbook.rows.some(row=>row[4]==='Surat tagihan pajak'));
});

test('KKA L-11 retains observed zero and distinguishes missing coverage from a negative result',()=>{
  const p=structuredClone(captured);
  p.entries.find(e=>e.cap.sumber==='bank').cap.konteks.npwp='0000000000000036';
  p.entries.find(e=>e.cap.sumber==='bb').cap.lengkap=false;
  p.entries.find(e=>e.cap.sumber==='info').pages[0].Payload.Data[0].GeneralInformation.TaxpayerStatus='Tidak Aktif';
  p.entries.find(e=>e.cap.sumber==='sptdaftar').pages[0].Payload.Data[0].ReturnDate='2025-12-01';
  const r=kkaCollectabilityAppendix(p,'2025',{},ability([100,99,null,40]));
  assert.equal(get(r,'Status WP dan penagihan'),'Tidak mendukung');
  for(const name of ['Kewajiban belum lunas','Rekening bank terdaftar','Aktivitas dalam 180 hari terakhir','Kemampuan menutup pokok'])
    assert.equal(get(r,name),'Belum dapat dinilai');
  assert.equal(get(r,'Indikasi dari data paket'),'Belum dapat dinilai lengkap');
  assert.equal(r.workbook.rows.find(row=>row[0]==='Sisa kewajiban pada rincian yang terbaca (Rp)')[1],0);
  assert.equal(kkaCollectabilityAppendix({...p,report:{valid:false}},'2025',{},ability([100,99,null,40])),null);
});
