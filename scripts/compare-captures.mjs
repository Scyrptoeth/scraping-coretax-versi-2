import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {normalizeId,sources} from '../extension/app-data.js';
import {readPackage} from '../extension/archive/package.js';
import {rowsOf} from '../extension/analisis/model.js';

function rowKey(row){
  return JSON.stringify(row,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}

function rowCounts(entry){
  if(!entry.pages.length||entry.pages.some(p=>p==null||p.IsSuccessful===false||p.Errors?.length||p.Payload===null))return null;
  const counts=new Map();
  for(const row of rowsOf(entry)){
    const key=rowKey(row);
    counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}

// File paths identify the same version and section; aggregate output omits document and taxpayer IDs.
export function compareCaptures(reference,candidate){
  if(!reference.report.valid||!candidate.report.valid)throw Error('Integritas kedua paket harus terverifikasi.');
  const wp=normalizeId(reference.manifest.wp?.npwp);
  if(!wp||/^0+$/.test(wp)||wp!==normalizeId(candidate.manifest.wp?.npwp))throw Error('Kedua paket harus mencantumkan NPWP yang sama.');
  const period=p=>p.manifest.opsi?.periode;
  const first=period(reference),second=period(candidate);
  const periodsKnown=[first,second].every(p=>[p?.from,p?.to].every(d=>Number.isInteger(d?.y)&&Number.isInteger(d?.m)&&d.m>=1&&d.m<=12));
  const a=new Map(reference.entries.map(e=>[e.path,e])),b=new Map(candidate.entries.map(e=>[e.path,e]));
  const groups=new Map();
  for(const path of new Set([...a.keys(),...b.keys()])){
    const ref=a.get(path),own=b.get(path),id=(ref||own).cap.sumber;
    const source=Object.hasOwn(sources,id)?sources[id]:id==='cari2'?'Identitas WP dari pencarian':'Sumber lain';
    if(!groups.has(source))groups.set(source,{sumber:source,hanyaAcuan:0,hanyaPembanding:0,berpasangan:0,
      kodeSumberBerbeda:0,responsSama:0,barisSama:0,barisBerbeda:0,barisBelumDapatDibandingkan:0});
    const item=groups.get(source);
    if(!own){item.hanyaAcuan++;continue;}
    if(!ref){item.hanyaPembanding++;continue;}
    item.berpasangan++;
    if(ref.cap.sumber!==own.cap.sumber){item.kodeSumberBerbeda++;item.barisBelumDapatDibandingkan++;continue;}
    if(isDeepStrictEqual(ref.pages,own.pages))item.responsSama++;
    const refRows=rowCounts(ref),ownRows=rowCounts(own);
    if(!refRows||!ownRows)item.barisBelumDapatDibandingkan++;
    else if(isDeepStrictEqual(refRows,ownRows))item.barisSama++;
    else item.barisBerbeda++;
  }
  return {berkasAcuan:a.size,berkasPembanding:b.size,periodePilihan:periodsKnown?(isDeepStrictEqual(first,second)?'Sama':'Berbeda'):'Tidak dapat dipastikan',
    perSumber:[...groups.values()].sort((a,b)=>a.sumber.localeCompare(b.sumber,'id'))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const paths=process.argv.slice(2);
    if(paths.length!==2)throw Error('Gunakan node scripts/compare-captures.mjs acuan.zip pembanding.zip');
    const packages=[];
    for(const path of paths){
      try{packages.push(await readPackage(await readFile(path)));}
      catch{throw Error('Berkas tidak dapat dibuka. Pilih dua ZIP CAP-PAKET yang dapat dibaca tanpa kata sandi.');}
    }
    console.log(JSON.stringify(compareCaptures(...packages),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
