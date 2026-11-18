import test from 'node:test';
import assert from 'node:assert/strict';
import {previewKind,previewWriter,savedPages,sameScope,coversRows,removePreview} from '../extension/app-spt-progress.js';

const scope={wp:'0000000000000017',period:'2025-01 s.d. 2025-03',types:'VAT_VATR',role:'ar',basis:'RUTIN',letter:'',date:'',officer:'Penguji',nip:''};
const route='/returnsheets/id-ID/submitted-returnsheets/00000000-0000-4000-8000-000000000001';
const row=(model,code)=>({'Model SPT':model,'ID SPT':code});
const a=row('Normal','ID-1'),b=row('Amendment 001','ID-1');
const page=(...rows)=>({rows,columns:['Model SPT','ID SPT'],ownerEvidence:'Panel WP pada SPT Dilaporkan',indexScope:'Daftar SPT lintas masa',
  canAdvance:false,range:rows.length?null:{first:0,last:0,total:0}});
const report=(pages,rows,extra={})=>({pages,rows,total:2,fromFirst:true,toLast:true,filtered:false,note:'',...extra});
function store(){
  const items=new Map();
  return {list:()=>[...items.values()],save:async writes=>{
    for(const {id,remove,value} of writes)if(remove)items.delete(id);else items.set(id,{id,...structuredClone(value)});
  }};
}
const header=db=>db.list().find(e=>e.kind===previewKind);
const writer=(db,save=db.save)=>previewWriter(db.list(),scope,route,save);

test('one atomic page and its unfinished state survive an interruption; a repeated traversal replaces the previous evidence once',async()=>{
  const db=store(),w=writer(db);await w.page(page(a),report(1,1));
  assert.equal(db.list().length,2);assert.ok(header(db).report.note);assert.equal(header(db).report.toLast,false);
  const r=writer(db);await r.page(page(a),report(1,1));await r.page(page(b),report(2,2));await r.finish(report(2,2));
  assert.equal(db.list().length,3);assert.equal(header(db).report.note,'');
  assert.deepEqual(savedPages(db.list(),header(db)).flatMap(d=>d.rows),[a,b]);
});
test('a known full directory survives a smaller, changed, filtered or stopped reread',async()=>{
  const db=store(),w=writer(db);await w.page(page(a,b),report(1,2));await w.finish(report(1,2));
  const original=structuredClone(db.list());
  for(const [records,final] of [[page(a),report(1,1,{total:1})],[page(a,a),report(1,2)],[page(a,b),report(1,2,{filtered:true})],
    [page(a,b),report(1,2,{toLast:false,note:'Dihentikan.'})]]){
    const r=writer(db);assert.equal(await r.page(records,final),false);
    assert.equal(await r.finish(final),false);assert.deepEqual(db.list(),original);
  }
  assert.throws(()=>previewWriter(db.list(),scope,route+'berbeda',db.save),/Alamat daftar/);
});
test('explicit source zero is restorable; missing, foreign or contradictory page evidence is refused',async()=>{
  const db=store(),w=writer(db),zero=report(1,0,{total:0});
  await w.page(page(),zero);await w.finish(zero);assert.deepEqual(savedPages(db.list(),header(db))[0].rows,[]);
  const restore=alter=>{const rs=structuredClone(db.list()),h=rs.find(e=>e.kind===previewKind),p=rs.find(e=>e!==h);alter(rs,h,p);return ()=>savedPages(rs,h);};
  for(const alter of [(rs,h)=>{h.pageIds.push(h.pageIds[0]);},(rs,h,p)=>{p.draftId='different';},(rs,h)=>{h.report.rows++;},
    (rs,h,p)=>{p.data.range=null;},(rs,h,p)=>{p.data.range.first=1;},(rs,h)=>{h.route='/unrelated';},
    (rs,h,p)=>{p.data.rows=[{NPWP:'0000000000000026'}];p.data.range=null;h.report.rows=1;}])assert.throws(restore(alter));
  const draft=header(db),other={id:'unrelated',kind:'result'};
  assert.deepEqual(removePreview({...draft,pageIds:[other.id]},[...db.list(),other]).map(r=>r.id).sort(),[draft.id,...draft.pageIds].sort());
});
test('work scope includes officer, assignment, optional NIP and period; rows compare by complete normalized column order and multiplicity',()=>{
  for(const k of Object.keys(scope))assert.equal(sameScope(scope,{...scope,[k]:'berbeda'}),false);
  assert.ok(sameScope(scope,{...scope}));assert.ok(coversRows([[a,b]],[[{'ID SPT':'ID-1','Model SPT':'Amendment 001'},a]]));
  assert.equal(coversRows([[a,b]],[[a,a]]),false);assert.equal(coversRows([[a,a]],[[a]]),false);
});
test('failed replacement leaves the previously committed header and pages usable',async()=>{
  const db=store(),w=writer(db);await w.page(page(a),report(1,1));
  const r=writer(db,async()=>{throw Error('Simpanan penuh.');});
  await assert.rejects(r.page(page(a),report(1,1)),/penuh/);assert.deepEqual(savedPages(db.list(),header(db)).flatMap(p=>p.rows),[a]);
});
