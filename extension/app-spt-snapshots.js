import {rowsOf} from './app-data.js';
import {appendPackageEntry,packagePath} from './app-package-entries.js';

function sectionKey(item, path) {
  if (item.source !== 'sptisi') return '';
  if (path.startsWith('spt/')) return path;
  const proof=item.detailProof;
  return proof?.receipt && proof.docKey && proof.part ? JSON.stringify([proof.docKey,proof.receipt,proof.part]) : '';
}
function sequenceOf(item) {
  if (item.origin !== 'Tabel tampak') return null;
  const proof=item.proof;
  if (proof?.urutan && typeof proof.urutan.id === 'string' && Number.isSafeInteger(proof.urutan.halaman)) {
    return {id:proof.urutan.id,page:proof.urutan.halaman};
  }
  // Earlier saved jobs recorded the verified paginator's ordinal in the source name.
  const old=/^(.*) · halaman pengambilan ([1-9]\d*)$/.exec(item.name);
  if (old && Array.isArray(proof?.columns) && Array.isArray(proof.owner) && Array.isArray(proof.period)) {
    return {id:JSON.stringify([old[1],proof.columns]),page:Number(old[2])};
  }
  return null;
}
export function stageSptSource(sections,item,wp) {
  if (item.source !== 'sptisi') return false;
  const path=packagePath(item),key=sectionKey(item,path);
  if (!key) return false;
  if (!sections.has(key)) sections.set(key,[]);
  const samples=sections.get(key), next=sequenceOf(item);
  let sample=samples.at(-1);
  if (!sample || !next || sample.sequence?.id!==next.id || sample.sequence.page+1!==next.page) {
    sample={entries:new Map(),sequence:null};
    samples.push(sample);
  }
  sample.sequence=next;
  appendPackageEntry(sample.entries,item,wp);
  return true;
}
function stableText(value) {
  return JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v) ?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
export function filteredSptSource(block){
  return Object.entries(block||{}).some(([key,value])=>/^(?:\$?filters?|columnfilters|globalfilter|search|searchtext|searchterm)$/i.test(key) &&
    value!=null && (typeof value==='object'?Object.keys(value).length:String(value).trim().length));
}
function verifiedCount(entry) {
  if (entry.pages.length!==1) return false;
  const [page]=entry.pages, p=page.Payload;
  const meta=[page,p,entry.cap.payload,page.Request,p?.Request,page.Query,p?.Query];
  if(meta.some(filteredSptSource))return false;
  if(meta.some(block=>Object.entries(block||{}).some(([key,value])=>(/^(?:first|offset|startindex)$/i.test(key) && value!=null && Number(value)!==0) ||
    (/^(?:hasmore|morepagesavailable)$/i.test(key) && (value===true || value==='true')))))return false;
  return page.IsSuccessful===true && !page.Errors?.length && Array.isArray(p?.Data) && (p.Index==null || p.Index===0) && Number.isSafeInteger(p.TotalRecords) &&
    p.TotalRecords===p.Data.length && entry.cap.total===p.TotalRecords && entry.cap.baris===p.TotalRecords &&
    entry.cap.halamanSumber[0]?.metode==='Ekspor lokal';
}
function completeView(entry) {
  const pages=entry.cap.halamanSumber || [];
  if(!entry.cap.konteks?.cuplikanTampilan || !pages.length || pages.length!==entry.pages.length)return false;
  const first=pages[0].pencocokan,last=pages.at(-1).pencocokan;
  return first?.awalTampilan===true && last?.akhirTampilan===true && last.morePagesAvailable!==true && Boolean(first.urutan?.id) &&
    pages.every((page,i)=>page.metode==='Tabel tampak' && page.pencocokan?.urutan?.id===first.urutan.id &&
      page.pencocokan.urutan.halaman===i+1 && !page.pencocokan.filterTampilan && !entry.pages[i]?.Errors?.length && entry.pages[i]?.IsSuccessful!==false);
}
function rowCounts(entry) {
  const counts=new Map();
  for (const page of entry.pages) for (const row of rowsOf(page)) {
    const str=stableText(row);counts.set(str,(counts.get(str)||0)+1);
  }
  return counts;
}
function sourceChoice(entries) {
  if (!entries.some(e=>verifiedCount(e) || completeView(e))) return {primary:entries[0],reason:'Cuplikan pertama dipakai pada formulir. Kelengkapan bagian belum dapat dipastikan.'};
  const counts=entries.map(rowCounts);
  const covers=i=>counts.every(other=>[...other].every(([key,n])=>(counts[i].get(key)||0)>=n));
  let index=entries.findIndex((e,i)=>verifiedCount(e) && covers(i));
  if(index<0)index=entries.findIndex((e,i)=>completeView(e) && covers(i));
  if (index<0) return {primary:entries[0],reason:'Isi sumber belum sejalan. Formulir menampilkan cuplikan pertama untuk ditelusuri.'};
  const reusable=entries.every(e=>(!verifiedCount(e) && !completeView(e)) || e.cap.baris===entries[index].cap.baris);
  return {primary:entries[index],reusable,reason:verifiedCount(entries[index])?'Jumlah baris ekspor cocok dengan total pada respons dan mencakup seluruh baris cuplikan lain.':
    'Cuplikan mencakup awal hingga akhir tampilan dan memuat baris dari cuplikan lain.'};
}
export function queuedSptEvidence(samples){
  const entries=samples.flatMap(sample=>[...sample.entries.values()]);
  return sourceChoice(entries);
}
export function finishSptSources(sections,groups,checks,dedupe) {
  for (const samples of sections.values()) {
    const entries=samples.flatMap(sample=>[...sample.entries.values()]);
    const distinct=[],seen=new Map();
    for (const entry of entries) {
      const fingerprint=dedupe && entries.length>1 ? stableText(entry.pages) : null;
      const same=fingerprint && seen.get(fingerprint);
      if (same) {
        if((completeView(entry) || verifiedCount(entry)) && !completeView(same) && !verifiedCount(same)){
          entry.cap.sumberSalinanIdentik=[...(same.cap.sumberSalinanIdentik||[]),...same.cap.halamanSumber];
          distinct[distinct.indexOf(same)]=entry;seen.set(fingerprint,entry);
        }else (same.cap.sumberSalinanIdentik ||= []).push(...entry.cap.halamanSumber);
        continue;
      }
      if (fingerprint) seen.set(fingerprint,entry);
      distinct.push(entry);
    }
    if (distinct.length===1) { groups.set(distinct[0].path,distinct[0]); continue; }
    const {primary,reason}=sourceChoice(distinct);
    const mainPath=primary.path;
    const alternatives=distinct.filter(e=>e!==primary);
    for (const [index,e] of alternatives.entries()) {
      const relative=mainPath.replace(/^spt(?:isi)?\//,'');
      e.path='sptisi/pembanding/'+(index+1)+'/'+relative;
      e.cap.label='Cuplikan pembanding '+(index+1)+' · '+e.cap.asal;
      e.cap.cuplikanSpt={utama:mainPath};
      groups.set(e.path,e);
    }
    primary.cap.cuplikanSpt={utama:mainPath,alasan:reason,pembanding:alternatives.map(e=>e.path)};
    groups.set(mainPath,primary);
    checks.push({tingkat:'SEDANG',kode:'CUPLIKAN-SPT',pesan:distinct.length+' cuplikan mandiri untuk '+mainPath+
      '. '+reason+' Buka Data mentah untuk memeriksa sumber pembanding.'});
  }
}
