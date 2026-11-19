import {checkIdentity} from './app-data.js';

export const previewKind='spt-preview';
const pageKind='spt-preview-page';
export const sameScope=(a,b)=>a && b && ['wp','period','types','role','basis','letter','date','officer','nip'].every(k=>a[k]===b[k]);
export const wholePreview=r=>Boolean(r?.fromFirst && r.toLast && !r.filtered && !r.note);

// Use column names as well as their values, including model and document identifiers.
function rowKey(row){return JSON.stringify(Object.keys(row).sort().map(k=>[k,row[k]]));}
export function coversRows(older,newer){
  const counts=new Map();
  for(const rows of newer)for(const row of rows){const k=rowKey(row);counts.set(k,(counts.get(k)||0)+1);}
  for(const rows of older)for(const row of rows){
    const k=rowKey(row),n=counts.get(k)||0;if(!n)return false;counts.set(k,n-1);
  }
  return true;
}
export function savedPages(records,draft){
  const byId=new Map(records.map(r=>[r.id,r])),pages=[];
  if(!draft || draft.kind!==previewKind || !Array.isArray(draft.pageIds) || !draft.pageIds.length ||
      !/^\/returnsheets\/id-ID\/submitted-returnsheets\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\/?$/i.test(draft.route) ||
      new Set(draft.pageIds).size!==draft.pageIds.length || draft.pageIds.length!==draft.report?.pages)
    throw Error('Daftar halaman dalam simpanan pratinjau belum lengkap.');
  for(const [index,id] of draft.pageIds.entries()){
    const p=byId.get(id),d=p?.data;
    if(!p || p.kind!==pageKind || p.draftId!==draft.id || p.generation!==draft.generation || p.page!==index+1 ||
        !d || !Array.isArray(d.rows) || !Array.isArray(d.columns) || d.ownerEvidence!=='Panel WP pada SPT Dilaporkan' ||
        d.indexScope!=='Daftar SPT lintas masa' || d.rows.some(r=>!r || typeof r!=='object'||Array.isArray(r)) ||
        !d.rows.length && d.range?.total!==0)throw Error('Halaman tersimpan belum dapat dicocokkan dengan pratinjau ini.');
    const prev=pages.at(-1),range=d.range;
    if(prev && Boolean(prev.pageNumber)!==Boolean(d.pageNumber) || d.pageNumber!=null &&
        (!Number.isSafeInteger(d.pageNumber) || d.pageNumber<1 ||
          prev && d.pageNumber!==prev.pageNumber+1 || !prev && draft.report.fromFirst && d.pageNumber!==1))
      throw Error('Nomor halaman tersimpan tidak sesuai dengan cakupan pratinjau.');
    if(prev && Boolean(prev.range)!==Boolean(range) || range && (
        ![range.first,range.last,range.total].every(Number.isSafeInteger) || range.total!==draft.report.total ||
        (d.rows.length?range.first<1 || range.last>range.total || range.last-range.first+1!==d.rows.length:
          range.first!==0 || range.last!==0 || range.total!==0) ||
        prev && range.first!==prev.range.last+1 || !index && draft.report.fromFirst && range.first>1 ||
        index===draft.pageIds.length-1 && draft.report.toLast && range.last!==range.total))
      throw Error('Rentang baris halaman tersimpan tidak sesuai dengan cakupan pratinjau.');
    checkIdentity(d.rows,draft.scope.wp);pages.push(d);
  }
  if(pages.reduce((n,p)=>n+p.rows.length,0)!==draft.report.rows ||
      wholePreview(draft.report) && draft.report.total!=null && draft.report.total!==draft.report.rows)
    throw Error('Jumlah baris dan keterangan pratinjau tersimpan berbeda.');
  return pages;
}
export const removePreview=(draft,records)=>records.filter(r=>r.id===draft.id || r.kind===pageKind && r.draftId===draft.id).map(r=>({id:r.id,remove:true}));

// The caller holds the navigation lock until finish. Only publish a stronger
// prefix once every previously saved row is represented in this source pass.
export function previewWriter(records,scope,route,save){
  const prior=records.find(r=>r.kind===previewKind && sameScope(r.scope,scope));
  if(prior && prior.route!==route)throw Error('Alamat daftar berbeda dari pratinjau tersimpan untuk penugasan ini. Buka kembali daftar yang sama.');
  const previous=prior?savedPages(records,prior):[],fresh=[],ids=[];
  const id=prior?.id||crypto.randomUUID(),generation=crypto.randomUUID();
  let committed=0;
  async function persist(report,final){
    const complete=wholePreview(report);
    if(!committed && prior && (prior.report.fromFirst && !report.fromFirst || !prior.report.filtered && report.filtered ||
        wholePreview(prior.report) && (!final || !complete) || !coversRows(previous.map(p=>p.rows),fresh.map(p=>p.rows))))return false;
    const writes=fresh.slice(committed).map((data,i)=>({id:ids[committed+i],
      value:{kind:pageKind,draftId:id,generation,page:committed+i+1,data}}));
    if(!committed && prior)writes.push(...prior.pageIds.map(id=>({id,remove:true})));
    const header={kind:previewKind,scope,route,generation,pageIds:[...ids],report:{...report}};
    writes.push({id,value:header});
    await save(writes,!committed?'Simpan kemajuan pratinjau SPT':undefined,{npwp:scope.wp});
    committed=fresh.length;return true;
  }
  return {
    async page(data,report){
      fresh.push(data);ids.push(crypto.randomUUID());
      return persist({...report,toLast:false,note:'Pembacaan belum selesai. Periksa kembali daftar WP sebelum melanjutkan.'},false);
    },
    finish(report){return persist(report,true);}
  };
}
