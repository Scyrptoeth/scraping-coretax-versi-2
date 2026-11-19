import {rowsOf} from './model.js';

function orderedValue(value){
  if(Array.isArray(value))return value.map(orderedValue);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,orderedValue(value[k])]));
  return value;
}

export function combinedLedger(entries,{includeAnnual=false}={}){
  const ledger=entries.filter(e=>/^bukubesar\/(?:19|20)\d{2}-(?:0[1-9]|1[0-2])\.json$/.test(e.path)||
    includeAnnual&&/^bukubesar\/(?:19|20)\d{2}-setahun\.json$/.test(e.path))
    .sort((a,b)=>a.path.localeCompare(b.path));
  if(!ledger.length)return null;
  const records=[],byId=new Map(),keys=new Set();
  let omitted=0;
  for(const entry of ledger){
    for(const [position,row] of rowsOf(entry).entries()){
      for(const k of Object.keys(row))keys.add(k);
      const id=row.RecordId;
      if(typeof id==='string' && id.trim()){
        const signature=JSON.stringify(orderedValue(row));
        const versions=byId.get(id) || new Map();
        if(versions.has(signature)){
          versions.get(signature).sources.add(entry.path);
          omitted++;continue;
        }
        const item={row,position,sources:new Set([entry.path])};
        versions.set(signature,item);byId.set(id,versions);records.push(item);
      }else records.push({row,position,sources:new Set([entry.path])});
    }
  }
  let sourceColumn='Berkas sumber';
  while(keys.has(sourceColumn))sourceColumn+=' (paket)';
  return {rows:records.map(({row,sources})=>({...row,[sourceColumn]:[...sources].join(', ')})),sourceColumn,
    origins:records.map(({sources,position})=>[[...sources][0],position]),omitted,
    conflicting:[...byId.values()].filter(versions=>versions.size>1).length,sourceCount:ledger.length};
}
