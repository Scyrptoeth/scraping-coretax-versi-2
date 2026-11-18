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
function verifiedCount(entry) {
  if (entry.pages.length!==1) return false;
  const [page]=entry.pages, p=page.Payload;
  return page.IsSuccessful===true && Array.isArray(p?.Data) && (p.Index==null || p.Index===0) && Number.isSafeInteger(p.TotalRecords) &&
    p.TotalRecords===p.Data.length && entry.cap.total===p.TotalRecords && entry.cap.baris===p.TotalRecords &&
    entry.cap.halamanSumber[0]?.metode==='Ekspor lokal';
}
function rowCounts(entry) {
  const counts=new Map();
  for (const page of entry.pages) for (const row of rowsOf(page)) {
    const str=stableText(row);counts.set(str,(counts.get(str)||0)+1);
  }
  return counts;
}
function sourceChoice(entries) {
  if (!entries.some(verifiedCount)) return {primary:entries[0],reason:'Cuplikan pertama dipakai pada formulir. Kelengkapan bagian belum dapat dipastikan.'};
  const counts=entries.map(rowCounts);
  const index=entries.findIndex((e,i)=>verifiedCount(e) && counts.every(other=>[...other].every(([key,n])=>(counts[i].get(key)||0)>=n)));
  if (index<0) return {primary:entries[0],reason:'Isi sumber belum sejalan. Formulir menampilkan cuplikan pertama untuk ditelusuri.'};
  return {primary:entries[index],reason:'Jumlah baris ekspor cocok dengan total pada respons dan mencakup seluruh baris cuplikan lain.'};
}
export function finishSptSources(sections,groups,checks,dedupe) {
  for (const samples of sections.values()) {
    const entries=samples.flatMap(sample=>[...sample.entries.values()]);
    const distinct=[],seen=new Map();
    for (const entry of entries) {
      const fingerprint=dedupe && entries.length>1 ? stableText(entry.pages) : null;
      const same=fingerprint && seen.get(fingerprint);
      if (same) {
        (same.cap.sumberSalinanIdentik ||= []).push(...entry.cap.halamanSumber);
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
