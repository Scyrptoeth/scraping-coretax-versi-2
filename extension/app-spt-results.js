import {checkIdentity,normalizeId,reportSource,rowsOf} from './app-data.js';
import {packagePath} from './app-package-entries.js';
import {matchedSptDocument,matchSptVersions,planSptDetails} from './app-spt-plan.js';
import {filteredSptSource} from './app-spt-snapshots.js';
import {readPackage,sha256} from './archive/package.js';

const assignmentFields=['wp','period','role','basis','letter','date','officer','nip'];
export const sameSptAssignment=(a,b)=>a && b && assignmentFields.every(k=>a[k]===b[k]);
export function resultAssignment(meta){
  const p=meta?.penugasan,o=meta?.penarik,range=meta?.opsi?.periode;
  if(!p || !o || !range || !Array.isArray(meta.opsi.jenisSpt))return null;
  const month=t=>t && Number.isInteger(t.y) && Number.isInteger(t.m) && t.m>=1 && t.m<=12?t.y+'-'+String(t.m).padStart(2,'0'):'';
  const period=month(range.from)+' s.d. '+month(range.to);
  if(!month(range.from)||!month(range.to)||meta.periode!==period || !o.nama || !p.peran || !p.jenis)return null;
  return {wp:normalizeId(meta.wp?.npwp),period,role:p.peran,basis:p.jenis,letter:p.nomor||'',date:p.tanggal||'',officer:o.nama,nip:o.nip||''};
}
const slot=d=>JSON.stringify([d.type,d.period,d.revision]);
function sharedVersions(a,b){
  const other=new Map(b.map(doc=>[slot(doc),doc])),matched=new Map();
  for(const doc of a){
    const result=matchSptVersions(doc,other.get(slot(doc)));
    if(result)matched.set(slot(doc),result);
  }
  return matched;
}
const portalIndex=e=>e.source==='sptdaftar' && e.proof?.indexScope==='Daftar SPT lintas masa' && e.proof.ownerEvidence==='Panel WP pada SPT Dilaporkan';
export function verifiedIndexItems(items){return items.filter(portalIndex);}
export async function readPreviousSptPackage(file,password,scope){
  const {entries,manifest,report}=await readPackage(file,{password});
  if(!report.valid || !report.minutesHasChecksum)throw Error('Pemeriksaan integritas paket gagal. Periksa berkas asli.');
  if(manifest.aplikasi!=='Scraping Coretax Versi 2' || !sameSptAssignment(resultAssignment(manifest),scope))
    throw Error('Pilih paket Versi 2 untuk WP, periode dan penugasan yang sama.');
  const directory=new Map(manifest.files.map(f=>[f.path,f]));
  for(const e of entries){
    if(normalizeId(e.cap.konteks?.npwp)!==scope.wp)throw Error('Identitas WP dalam paket tidak konsisten.');
    if(!['sptdaftar','sptisi'].includes(e.cap.sumber))continue;
    if(e.cap.konteks.spt?.npwp && normalizeId(e.cap.konteks.spt.npwp)!==scope.wp)throw Error('Identitas WP pada SPT berbeda.');
    const f=directory.get(e.path),digests=e.cap.shaRespons;
    if(f.sumber!==e.cap.sumber || f.baris!==e.cap.baris || f.halaman!==e.pages.length || e.cap.halaman!==e.pages.length ||
        !Array.isArray(digests) || digests.length!==e.pages.length)throw Error('Rincian halaman SPT berbeda dari manifest paket.');
    for(const [i,p] of e.pages.entries()){
      if(await sha256(JSON.stringify(p))!==digests[i])throw Error('Sidik jari respons SPT berbeda dari isi paket.');
      checkIdentity(rowsOf(p),scope.wp);
    }
  }
  return {id:report.manifestHash,manifestHash:report.manifestHash,meta:manifest,entries};
}

// Rebuild the original page provenance so the normal queue can reevaluate
// complete captures, competing snapshots and filters instead of trusting labels.
function restoreEntry(entry,doc,scope,record){
  const cap=entry.cap,context=cap.konteks,part=context.bagian,observations=cap.halamanSumber;
  if(context.periode!==scope.period || typeof part!=='string' || filteredSptSource(cap.payload) || !Array.isArray(observations) || !entry.pages?.length ||
      observations.length!==entry.pages.length || context.spt.jenis!==doc.type)return [];
  const sources=[],names=observations.map(p=>p?.metode);
  if(!names.every(n=>n===names[0]) || !['Tabel tampak','Satu halaman tampilan SPT','Ekspor lokal'].includes(names[0]))return [];
  for(const [i,page] of entry.pages.entries()){
    const captured=observations[i];if(!captured || !page?.Payload)return [];
    const proof=captured.pencocokan||{},count=reportSource(page);
    if(page.IsSuccessful===false || page.Errors?.length || !Number.isSafeInteger(captured.baris) || count.rows!==captured.baris ||
        captured.total!=null && captured.total!==count.total || entry.pages.length===1 && cap.total!=null && cap.total!==count.total ||
        !count.rows && !(page.Payload.TotalRecords===0 && proof.nolPadaSumber===true) || captured.jenisSpt!==doc.type)return [];
    const rows=rowsOf(page);
    if(rows.some(row=>!row || typeof row!=='object' || Array.isArray(row)))return [];
    if(doc.recordId && rows.some(row=>Object.entries(row).some(([k,v])=>['taxreturnrecordid','idrekamspt','idspt'].includes(k.toLowerCase().replace(/[^a-z]/g,'')) &&
      v!=null && String(v).trim() && String(v).trim()!==doc.recordId)))return [];
    try{checkIdentity(rows,scope.wp);}catch{return [];}
    const evidence={};
    for(const name of ['columns','owner','period'])if(Array.isArray(proof[name]) && proof[name].every(v=>typeof v==='string'))evidence[name]=proof[name];
    for(const name of ['morePagesAvailable','nolPadaSumber','awalTampilan','akhirTampilan','filterTampilan'])if(typeof proof[name]==='boolean')evidence[name]=proof[name];
    if(typeof proof.urutan?.id==='string' && Number.isSafeInteger(proof.urutan.halaman))evidence.urutan={id:proof.urutan.id,halaman:proof.urutan.halaman};
    if([page,page.Payload,page.Request,page.Payload?.Request].some(filteredSptSource))evidence.filterTampilan=true;
    const info={wp:scope.wp,period:scope.period,spt:doc.type,source:'sptisi',sptAssignment:scope,sptResultId:record.id,
      proof:{...evidence,hasilSebelumnya:{waktu:record.meta.dibuat,berkas:entry.path,halaman:i+1,...(record.manifestHash?{shaManifest:record.manifestHash}:{})}},
      id:crypto.randomUUID(),...count,page,name:captured.asal,origin:captured.metode};
    if(context.cuplikanTampilan===true){
      if(names[0]==='Ekspor lokal' || !evidence.columns && names[0]==='Tabel tampak')return [];
      info.detailProof={recordId:context.spt.recordId||'',receipt:context.spt.nomor||'',period:doc.period,revision:doc.revision,
        part,label:context.labelBagian||part,docKey:doc.key};
    }else if(names[0]!=='Ekspor lokal')return [];
    const path=packagePath(info);
    const representative=cap.cuplikanSpt?.utama;
    if(representative && representative!==entry.path){
      if(!/^sptisi\/pembanding\/[1-9]\d*\//.test(entry.path) || !record.entries.some(e=>e.path===representative && e.cap.cuplikanSpt?.pembanding?.includes(entry.path)))return [];
    }
    const required=representative||entry.path;
    if(path!==required && !(context.cuplikanTampilan && !context.spt.recordId && context.spt.nomor && /^sptisi\/[a-f\d-]{36}\.json$/i.test(required)))return [];
    sources.push(info);
  }
  return sources.reduce((n,s)=>n+s.rows,0)===cap.baris?sources:[];
}
export function recoverSptResult(record,scope,options,items,liveItems){
  const none={pages:[],observed:[],legacyNotes:0,skippedFiles:0};
  if(!sameSptAssignment(resultAssignment(record.meta),scope) || !Number.isFinite(Date.parse(record.meta.dibuat)) || !Array.isArray(record.entries))return none;
  const input={wp:scope.wp,period:options.periode,types:options.jenisSpt.filter(t=>record.meta.opsi.jenisSpt.includes(t))};
  const documents=entries=>planSptDetails({...input,items:entries,strictReceipts:true}).documents;
  const verified=sharedVersions(documents(verifiedIndexItems(items)),documents(liveItems));
  const current=sharedVersions([...verified.values()],documents(items));
  const oldIndex=record.entries.filter(e=>e.cap?.sumber==='sptdaftar' && e.cap.konteks?.periode===scope.period);
  const versions=sharedVersions([...current.values()],documents(oldIndex));
  const pages=[],observed=[],groups=new Map();
  for(const e of record.entries){
    if(e.cap?.sumber!=='sptisi' || !e.cap.konteks?.spt || !Array.isArray(e.pages))continue;
    const doc=matchedSptDocument(e,scope.wp,versions);
    if(!doc)continue;
    const key=JSON.stringify([doc.key,e.cap.konteks.bagian]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({e,doc});
  }
  for(const family of groups.values()){
    const paths=new Set(family.map(({e})=>e.path));
    if(family.some(({e})=>e.cap.cuplikanSpt?.pembanding?.some(path=>!paths.has(path))))continue;
    const alternative=e=>Boolean(e.cap.cuplikanSpt?.utama && e.cap.cuplikanSpt.utama!==e.path);
    family.sort((a,b)=>Number(alternative(a.e))-Number(alternative(b.e)));
    const captures=family.map(({e,doc})=>restoreEntry(e,doc,scope,record));
    if(captures.every(c=>c.length))for(const capture of captures)pages.push(...capture);
  }
  for(const index of oldIndex)for(const note of Array.isArray(index.cap.bagianSptTeramati)?index.cap.bagianSptTeramati:[]){
    const doc=matchedSptDocument(note,scope.wp,versions);
    if(doc && note.docKey===doc.key && typeof note.failed==='boolean' && typeof note.cap.konteks.bagian==='string')observed.push({docKey:doc.key,failed:note.failed,
      cap:{konteks:{npwp:scope.wp,bagian:note.cap.konteks.bagian.toLowerCase(),spt:{recordId:doc.recordId,nomor:doc.receipt,jenis:doc.type,masa:doc.period,pemb:doc.revision}}}});
  }
  const legacyNotes=oldIndex.some(e=>e.cap.bagianSptTeramati?.length)?0:
    (record.meta.cek||[]).filter(note=>note.kode==='SPT-TAMPILAN').length;
  const usedFiles=new Set(pages.map(p=>p.proof.hasilSebelumnya.berkas));
  const skippedFiles=record.entries.filter(e=>e.cap?.sumber==='sptisi' && !usedFiles.has(e.path)).length;
  return {pages,observed,legacyNotes,skippedFiles};
}
export function remainingSptChecks(items,wp,opts){
  if(!opts.sumber?.includes('sptisi'))return [];
  const recovered=items.filter(e=>e.proof?.hasilSebelumnya || e.sptResultId);
  if(!recovered.length)return [];
  const previous=new Set();
  for(const item of recovered){
    if(item.detailProof)previous.add(JSON.stringify([item.detailProof.docKey,item.detailProof.part]));
    for(const note of item.sptObservedParts||[])previous.add(JSON.stringify([note.docKey,note.cap.konteks.bagian]));
  }
  const plan=planSptDetails({wp,items,period:opts.periode,types:opts.jenisSpt});
  return plan.documents.flatMap(doc=>{
    const missing=doc.parts.filter(p=>p.status!=='ready' && previous.has(JSON.stringify([doc.key,p.name]))).map(p=>p.name);
    return missing.length?[{tingkat:'SEDANG',kode:'SPT-BAGIAN-BELUM-PULIH',
      pesan:doc.type+' · '+doc.period+' · pembetulan '+doc.revision+' · Bagian '+missing.join(', ')+' masih gagal atau cakupannya belum terkonfirmasi.'}]:[];
  });
}
