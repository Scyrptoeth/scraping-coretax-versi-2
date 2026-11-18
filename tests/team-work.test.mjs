import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clearIndexDocument,clearIndexReview,identifyRows,markEdit,mergeWork,nextIndexDocumentNumber,planMerge,progressReport,readAudit,readClearedRows,readRemovedDocuments,rowIdentity,validateTimes,workAuditRows} from '../extension/analisis/team-work.js';
const id='manual/00000000-0000-4000-8000-000000000001',row=(fact,idValue=id)=>({teamId:idValue,topik:'Penjualan',sumber:'Buku penjualan',fakta:fact,status:'Selesai'});
const key=JSON.stringify(['rows',id]);
test('a team retains reviews per rule and can arbitrate between clearing or keeping a loan rate',()=>{
  const local={indicationReviews:{'vat-facility':'explained'},indicationLoanRate:null};
  const file={indicationReviews:{'payroll-gap':'retained'},indicationLoanRate:{percent:0,source:'Fictitious agreement'}};
  markEdit(local,'indicationReviews','vat-facility');markEdit(local,'indicationLoanRate','rate');
  assert.deepEqual(validateTimes(local.editTimes,local),local.editTimes);
  const plan=planMerge(local,file),choice=plan.decisions.find(d=>d.rule==='pilih');
  assert.ok(choice);assert.throws(()=>mergeWork(plan));
  const saved=mergeWork(plan,{[choice.key]:'lokal'});assert.equal(saved.indicationLoanRate,null);
  assert.deepEqual(saved.indicationReviews,{...file.indicationReviews,...local.indicationReviews});
  assert.deepEqual(mergeWork(plan,{[choice.key]:'berkas'}).indicationLoanRate,file.indicationLoanRate);
});
test('deleted request numbers survive save and merge without reusing a number or resurrecting a document',()=>{
  const initial={indexDocuments:[{number:1,name:'Buku'},{number:3,name:'Faktur'}]},local=structuredClone(initial);
  clearIndexDocument(local,3);clearIndexDocument(local,3);
  assert.deepEqual(readRemovedDocuments(local.removedDocuments,local.indexDocuments),[3]);
  assert.equal(nextIndexDocumentNumber(local),4);assert.equal(workAuditRows(local).length,1);
  assert.equal(readAudit(local.auditLog)[0].action,'removeDocument');
  for(const bad of [[1],[3,3],[0],[1.5],['3']])assert.throws(()=>readRemovedDocuments(bad,local.indexDocuments));
  const plan=planMerge(local,initial),conflict=plan.decisions.find(r=>r.rule==='pilih');
  assert.throws(()=>mergeWork(plan));
  const keep=mergeWork(plan,{[conflict.key]:'lokal'}),restore=mergeWork(plan,{[conflict.key]:'berkas'});
  assert.deepEqual(keep.removedDocuments,[3]);assert.deepEqual(restore.indexDocuments,initial.indexDocuments);
  assert.deepEqual(restore.removedDocuments,[]);assert.deepEqual(mergeWork(planMerge({},local)).removedDocuments,[3]);
  const scope={type:'terfokus',taxes:['PPN']},edited={documentScope:scope};
  markEdit(edited,'documentScope','sp2');assert.deepEqual(validateTimes(edited.editTimes,edited),edited.editTimes);
  assert.equal(planMerge(edited,{documentScope:{type:'lengkap',taxes:[]}}).decisions[0].rule,'pilih');
  const blank={simulation:{end:'',cases:[]}};markEdit(blank,'simulation','sim');
  assert.deepEqual(validateTimes(blank.editTimes,blank),blank.editTimes);
  assert.equal(planMerge(blank,{simulation:{end:'2026-12-01',cases:[]}}).decisions[0].rule,'pilih');
});
test('resetting an indexed review survives reopening, requires a merge choice and permits a fresh review',()=>{
  const line={id:'spt/PPN/2025-01/p00_demo/induk.json#A'},r={...row('hasil'),kkpLine:line.id};
  const index={byId:new Map([[line.id,line],['kode',{id:'kode',refundCode:'1'}]])};
  const original={rows:[r]},work=structuredClone(original);
  clearIndexReview(work,line);clearIndexReview(work,line);
  assert.deepEqual(readClearedRows(work.clearedRows,work.rows,index),[line.id]);
  for(const invalid of [[line.id,line.id],['bukan-baris'],['kode']])assert.throws(()=>readClearedRows(invalid,[],index));
  assert.throws(()=>readClearedRows([line.id],[r],index));
  assert.equal(work.rows.length,0);assert.equal(workAuditRows(work).at(-1).Catatan,'Baris dikembalikan ke belum diuji');
  const plan=planMerge(work,original),choice=plan.decisions[0];
  assert.equal(choice.rule,'pilih');assert.throws(()=>mergeWork(plan));
  const reset=mergeWork(plan,{[choice.key]:'lokal'}),restore=mergeWork(plan,{[choice.key]:'berkas'});
  assert.deepEqual(reset.clearedRows,[line.id]);assert.equal(reset.rows.length,0);
  assert.equal(restore.rows.length,1);assert.deepEqual(restore.clearedRows,[]);
  reset.rows.push(r);markEdit(reset,'rows',rowIdentity(r),null,r);
  assert.equal(reset.clearedRows.length,0);assert.equal(readAudit(reset.auditLog).length,2);
});
const then='2026-10-02T11:12:13.000Z',later='2026-10-03T11:12:13.000Z';
test('edit history retains both sessions and labels legacy last-edit timestamps separately',()=>{
  const local={rows:[row('sama')],editTimes:{[key]:then}};
  markEdit(local,'rows',id);
  const remote=structuredClone(local);
  markEdit(local,'rows',id);markEdit(remote,'rows',id);
  const result=mergeWork(planMerge(local,remote));
  assert.equal(result.auditLog.length,4);
  const report=workAuditRows(result);assert.equal(report.filter(r=>r.Catatan.includes('berkas lama')).length,1);
  assert.equal(report[0].Butir,'Penjualan');
  assert.equal(mergeWork(planMerge(result,remote)).auditLog.length,4);
  const corrupt=structuredClone(remote);
  corrupt.auditLog.at(-1).time=later;
  assert.throws(()=>planMerge(result,corrupt),/penanda perubahan/);
  assert.throws(()=>readAudit([{...result.auditLog[0],time:'2025-02-30T00:00:00.000Z'}]),/waktu/);
});
test('newest dated value wins in either direction and never stamps an unmodified old entry',()=>{
  const local={rows:[row('lokal')],editTimes:{[key]:then}},remote={rows:[row('berkas')],editTimes:{[key]:later}};
  const a=planMerge(local,remote);assert.equal(a.decisions[0].rule,'terbaru');
  const merged=mergeWork(a);assert.equal(merged.rows[0].fakta,'berkas');assert.equal(merged.editTimes[key],later);
  assert.equal(mergeWork(planMerge(remote,local)).rows[0].fakta,'berkas');
  assert.deepEqual(mergeWork(planMerge(merged,remote)),merged);
  markEdit(local,'rows',id,local.rows[0],{...local.rows[0]});assert.equal(local.editTimes[key],then);
  assert.deepEqual(validateTimes(undefined,local),{});assert.throws(()=>validateTimes({[key]:'yesterday'},local),/Waktu perubahan/);
});
test('conflicting legacy rows and equal stamps need explicit choices; different modern IDs remain independent',()=>{
  const old={rows:[{topik:'Penjualan',sumber:'Buku penjualan',fakta:'A',status:'Selesai'}]};
  const legacyId=rowIdentity(identifyRows(old.rows)[0]);
  assert.ok(legacyId.startsWith('lama/'));
  const modern={rows:[row('B')],editTimes:{[key]:later}};
  for(const plan of [planMerge(old,modern),planMerge(modern,old),planMerge(modern,{rows:[row('C')],editTimes:{[key]:later}})]){
    assert.equal(plan.decisions[0].rule,'pilih');
    assert.throws(()=>mergeWork(plan),/Pilih versi/);
    const result=mergeWork(plan,{[plan.decisions[0].key]:'berkas'});assert.equal(result.rows.length,1);
    assert.equal(result.rows[0].fakta,plan.decisions[0].incoming.value.fakta);
  }
  const different='manual/00000000-0000-4000-8000-000000000002';
  assert.equal(mergeWork(planMerge(modern,{rows:[row('B',different)]})).rows.length,2);
});
test('conflicting draft, simulation and document choices are protected even with two timestamps',()=>{
  const keyFor=(g,id)=>JSON.stringify([g,id]);
  const a={rows:[],drafts:[{id:'d',type:'SP2DK',year:'2025',number:'A'}],indexDocuments:[{number:1,name:'A'}],
    simulation:{end:'2025-02-01',cases:[]},editTimes:{}};
  const b=structuredClone(a);b.drafts[0].number='B';b.indexDocuments[0].name='B';b.simulation.end='2025-02-02';
  for(const key of [keyFor('drafts','d'),keyFor('indexDocuments','1'),keyFor('simulation','sim')]){a.editTimes[key]=then;b.editTimes[key]=later;}
  const plan=planMerge(a,b);assert.ok(plan.decisions.every(d=>d.rule==='pilih'));
  const chosen=Object.fromEntries(plan.decisions.map(d=>[d.key,d.incoming.group==='drafts'?'berkas':'lokal']));
  const result=mergeWork(plan,chosen);assert.equal(result.drafts[0].number,'B');assert.equal(result.indexDocuments[0].name,'A');
  assert.equal(result.simulation.end,'2025-02-01');
  const unique=mergeWork(planMerge(a,{drafts:[{id:'d2',type:'BAPK',year:'2025'}]}));assert.equal(unique.drafts.length,2);
});
test('progress has an auditable denominator for package findings, eligible index lines and manual items',()=>{
  const work={rows:[row('A'),{kkpLine:'spt/a#jumlah',topik:'Indeks',status:'Selesai'}],editTimes:{},dispositions:{}};
  const pkg={forms:[],entries:[]}, index={byId:new Map([['spt/a#jumlah',{}],['spt/a#tax',{}]])};
  const progress=progressReport(pkg,'2025',work,index);assert.equal(progress.done,2);assert.equal(progress.total,3);assert.equal(progress.percent,67);
  assert.equal(progressReport(pkg,'2025',{...work,rows:[]},{byId:new Map()}).percent,null);
});

test('inspection dates from different sessions are reviewed as one schedule and legacy work can be merged',()=>{
  const stamp=JSON.stringify(['schedule','jadwal']);
  const local={schedule:{type:'lengkap',spp:'2026-04-01',holidays:['2026-05-01']},editTimes:{[stamp]:then}};
  const other={schedule:{type:'konkret',spp:'2026-04-02',holidays:[]},editTimes:{[stamp]:later}};
  const plan=planMerge(local,other);
  assert.equal(plan.decisions[0].rule,'pilih');
  assert.throws(()=>mergeWork(plan),/Pilih versi/);
  assert.deepEqual(mergeWork(plan,{[stamp]:'berkas'}).schedule,other.schedule);
  assert.deepEqual(mergeWork(plan,{[stamp]:'lokal'}).schedule,local.schedule);
  assert.deepEqual(mergeWork(planMerge(local,{rows:[]})).schedule,local.schedule);
  assert.deepEqual(mergeWork(planMerge({rows:[]},other)).schedule,other.schedule);
  assert.equal(workAuditRows(local)[0].Bagian,'Jadwal pemeriksaan');
  assert.deepEqual(validateTimes(local.editTimes,local),local.editTimes);
});
