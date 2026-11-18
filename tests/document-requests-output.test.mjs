import test from 'node:test';
import assert from 'node:assert/strict';
import {documentIndexLabel,documentTaxes,duplicateRequest,registeredDocumentBusiness,requestOutput,requestSource,suggestedRequests,
  targetOptions,validateDocumentOrigin,validateDocumentScope} from '../extension/analisis/document-requests-output-model.js';
import {validatedProbisSource} from '../extension/probis-guide.js';
import {kbli} from '../extension/catalog-data.js';

const index={groups:[{key:'BADAN/B',ref:'B',title:'Induk Badan'},{key:'PPN/N.3',ref:'N.3',title:'Penyerahan'},
  {key:'OP/B',ref:'B',title:'Induk OP'}]};
const focused={type:'terfokus',taxes:['N','F']};
const manual={number:8,index:'PPN/N.3',name:'Faktur terpilih',status:'Diterima sebagian',date:'2026-02-04',
  due:'2026-02-24',received:'2026-02-10',notes:'Berkas lanjutan akan disampaikan',reference:'Bundel uji'};

test('Cakupan mengikuti urutan baku, membedakan OP dan Badan, dan mengizinkan pajak tanpa indeks',()=>{
  assert.equal(validateDocumentScope().taxes.length,8);
  assert.deepEqual(validateDocumentScope({type:'spesifik',taxes:['F','N']}),{type:'spesifik',taxes:['N','F']});
  assert.equal(validateDocumentScope({type:'lengkap',taxes:['N']}).taxes.length,8);
  for(const s of [null,{type:'lain',taxes:[]},{type:'terfokus',taxes:['B','B']},{type:'spesifik',taxes:['X']}])assert.throws(()=>validateDocumentScope(s));
  const keys=targetOptions(index,focused).map(([key])=>key);
  assert.deepEqual(keys,['SP2/UMUM','PPN/N.3','SP2/N','SP2/F']);
  assert.ok(!targetOptions(index,{type:'spesifik',taxes:['OP']}).some(([k])=>k==='BADAN/B'));
  assert.equal(documentTaxes.length,8);
});
test('Saran KKP hanya untuk indeks tersedia; dasar awal tetap terbaca sesudah indeks atau nama diubah',()=>{
  const suggestions=suggestedRequests(index,focused,'2025');
  assert.ok(suggestions.every(d=>['SP2/UMUM','PPN/N.3'].includes(d.index)));
  const suggestion=suggestions.find(d=>d.index==='PPN/N.3');
  assert.equal(validateDocumentOrigin(suggestion.origin,'SP2/N').index,'PPN/N.3');
  assert.throws(()=>validateDocumentOrigin({...suggestion.origin,index:'BADAN/B'},'BADAN/B'));
  const edited={...suggestion,index:'SP2/N',name:'Judul baru',number:2};
  assert.equal(duplicateRequest([edited],suggestion),edited);
  assert.equal(requestSource(edited),'Saran KKP · N.3');
  assert.equal(duplicateRequest([manual],{index:'PPN/N.3',name:'  FAKTUR   terpilih '}),manual);
  assert.equal(duplicateRequest([manual],manual),undefined);
  assert.equal(duplicateRequest([manual],{index:'SP2/N',name:manual.name}),undefined);
});
test('Saran sektoral mengacu pada KLU dan edisi pilihan petugas serta dapat ditelusuri setelah nama diganti',()=>{
  const suggestions=suggestedRequests(index,focused,'2025',{reference:{code:'01111',edition:'2020'}});
  const sector=suggestions.filter(d=>d.probis);
  assert.equal(sector.length,2);
  assert.equal(sector[0].probis.year,'2025');
  const renamed={...sector[0],number:1,name:'Nama permintaan yang dirinci petugas'};
  assert.equal(duplicateRequest([renamed],sector[0]),renamed);
  assert.match(requestSource(renamed),/PB-PANEN/);
});
test('KLU registrasi hanya menjadi dasar jika identitas, cakupan dan tahun berlaku dapat dipastikan',()=>{
  const npwp='0000000000000017',row={TradeClassificationCode:'01111',IsMainEconomicCode:true,ValidFrom:'2024-01-01'};
  const entry={path:'profil/klu.json',cap:{sumber:'klu',lengkap:true,konteks:{npwp}},pages:[{Payload:{Data:[row]}}]};
  const source=(e=entry)=>({manifest:{wp:{npwp}},entries:[e]});
  const reg=registeredDocumentBusiness(source(),2025);assert.deepEqual(reg,{code:'01111',edition:'Registrasi Coretax'});
  assert.ok(suggestedRequests(index,focused,2025,{reference:{code:'25111',edition:'2020'}},reg).filter(d=>d.probis).every(d=>d.probis.klu==='25111'));
  assert.equal(registeredDocumentBusiness(source(),2022),undefined);
  assert.equal(registeredDocumentBusiness(source({...entry,cap:{...entry.cap,lengkap:false}}),2025),undefined);
  assert.equal(registeredDocumentBusiness(source({...entry,cap:{...entry.cap,konteks:{npwp:'0000000000000018'}}}),2025),undefined);
  assert.equal(registeredDocumentBusiness(source({...entry,pages:[{Payload:{Data:[row,{...row,TradeClassificationCode:'25111'}]}}]}),2025),undefined);
  const distinct=registeredDocumentBusiness(source({...entry,pages:[{Payload:{Data:[{...row,TradeClassificationCode:'25111'}]}}]}),2025);
  const document=suggestedRequests(index,focused,2025,{},distinct).find(d=>d.probis);
  assert.notEqual(kbli['2020']['25111'],kbli['2025']['25111']);
  assert.equal(validatedProbisSource(document.probis,2025).edition,'Registrasi Coretax');
  assert.match(requestSource(document),/edisi belum diketahui/);assert.doesNotMatch(requestSource(document),/2020|2025|konstruksi/i);
  assert.throws(()=>validatedProbisSource({...document.probis,klu:'00000'},2025));
});
test('Keluaran mengambil identitas sebagai teks, revisi, tanggal diterima dan tenggat menurut jadwal secara terpisah',()=>{
  const work={documentScope:focused,indexDocuments:[manual],schedule:{spp:'2026-01-30',request:'2026-02-04'},
    indexNotes:{'PPN/N.3':{revision:2}}};
  const out=requestOutput({nama:'Badan Fiktif',npwp:'0000000000000017'},2025,index,work);
  assert.deepEqual(out.summary[1],['NPWP','0000000000000017']);
  assert.equal(out.summary.at(-1)[1],'2026-03-04');assert.equal(out.summary[2][1],'2025');
  assert.deepEqual(out.rows[1],['DOK.8',manual.name,'N.3 (P2)',manual.status,manual.date,manual.received,manual.notes,'Isian petugas',manual.due,manual.reference]);
  assert.equal(documentIndexLabel('SP2/F',index),'Cakupan SP2 · PPh Pasal 15');
  assert.equal(requestOutput({},2026,index,{}).summary.at(-1)[1],'Belum tersedia');
  assert.equal(requestOutput({},2026,index,{documentScope:{type:'spesifik',taxes:[]},indexDocuments:[manual]}).rows.length,2);
});
