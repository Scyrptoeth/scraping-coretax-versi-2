import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessSheets,validateBusiness} from '../extension/analisis/business-work.js';
import {markEdit,mergeWork,planMerge} from '../extension/analisis/team-work.js';

const pkg={manifest:{wp:{nama:'WP Fiktif',npwp:'0000000000000015'}},entries:[
  {path:'profil/klu.json',pages:[{Payload:{Data:[{TradeClassificationCode:'01111',ActivityDescription:'Jagung',IsMainEconomicCode:true,ValidFrom:'2020-01-01'}]}}]}]};
const reference={code:'01111',edition:'2025'};
const activity={kind:'WP dengan beberapa kegiatan',edition:'auto',activities:[{code:'61101',name:'Kegiatan A',amount:'99999999999999999'},
  {code:'01111',name:'Kegiatan B',amount:'400'}],evidence:'Buku kegiatan fiktif',conclusion:'Periksa kegiatan utama.'};
test('registered code, officer reference, turnover, calculation and comparative evidence enter the workbook through the same year work',()=>{
  const business=validateBusiness({reference,activity});
  const [probis,testSheet]=businessSheets(pkg,'2025',{business,indexDocuments:[{number:2,index:'PPN/N',status:'Diminta',name:'Rekap',probis:{klu:'01111'}}]});
  const rows=testSheet.rows;
  assert.equal(rows.find(r=>r[0]==='Tahun nilai kegiatan')[1],'2024');
  assert.equal(rows.find(r=>r[0]==='Edisi hasil')[1],'2025');
  assert.equal(rows.find(r=>r[0]==='Kode hasil')[1],'61101');
  assert.equal(rows.find(r=>r[0]==='Perbandingan dengan KLU terdaftar')[1],'Berbeda');
  assert.equal(rows.find(r=>r[0]==='61101')[2],'99999999999999999');
  assert.ok(rows.some(r=>r.includes(activity.evidence)));assert.ok(rows.some(r=>r.includes(activity.conclusion)));
  assert.ok(probis.rows.some(r=>r.includes('PB-PANEN')));assert.ok(probis.rows.some(r=>r.includes('DOK.2')));
  assert.ok(businessSheets(pkg,'2026')[1].rows.flat().every(item=>item!==activity.evidence));
});
test('legacy work, conflicting independent edits, invalid codes and authorities, and name-only calculations',()=>{
  assert.deepEqual(validateBusiness(undefined),{});assert.throws(()=>validateBusiness({reference:{code:'01111',edition:'unknown'}}));
  assert.throws(()=>validateBusiness({activity:{...activity,activities:[{code:'00000',amount:'9',name:'X'}]}}));
  const saved=validateBusiness({activity:{...activity,activities:[{code:'',amount:'20',name:'Menjual hasil'}]}});
  assert.match(businessSheets(pkg,'2025',{business:saved})[1].rows.find(r=>r[0]==='Hasil perhitungan')[1],/Menjual hasil/);
  const a={business:{reference}},b={business:{reference:{code:'61101',edition:'2025'},activity}};
  markEdit(a,'business','reference');markEdit(b,'business','reference');markEdit(b,'business','activity');
  const plan=planMerge(a,b),entry=plan.decisions.find(d=>d.incoming.id==='reference');
  assert.equal(entry.rule,'pilih');const merged=mergeWork(plan,{[entry.key]:'lokal'});assert.deepEqual(merged.business,{reference,activity});
});
