import assert from 'node:assert/strict';
import {test} from 'node:test';
import {identifyRows,markEdit,mergeWork,planMerge,progressReport,rowIdentity,validateTimes} from '../extension/analisis/team-work.js';
const id='manual/00000000-0000-4000-8000-000000000001',row=(fact,idValue=id)=>({teamId:idValue,topik:'Penjualan',sumber:'Buku penjualan',fakta:fact,status:'Selesai'});
const key=JSON.stringify(['rows',id]);
const then='2026-10-02T11:12:13.000Z',later='2026-10-03T11:12:13.000Z';
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
