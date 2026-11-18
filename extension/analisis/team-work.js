import {findingsFor,findingKey,scopeDefaults} from './findings.js';
import {worksheet} from './model.js';
import {box,el,button,select,detail} from './ui.js';

const keyOf=(group,id)=>JSON.stringify([group,id]);
export const rowIdentity=row=>row.kkpLine?'indeks/'+row.kkpLine:row.teamId;
export function markEdit(work,group,id,before,after){
  if(arguments.length===5&&equal(before,after))return;
  const key=keyOf(group,id),time=new Date().toISOString();
  work.auditLog??=readAudit(undefined,work.editTimes);
  (work.editTimes??={})[key]=time;
  work.auditLog.push({event:crypto.randomUUID(),key,time});
}

export function identifyRows(rows){
  const seen=new Set(), counts=new Map();
  return rows.map(row=>{
    if(row.kkpLine){
      const key=rowIdentity(row);
      if(seen.has(key))throw Error('Identitas butir indeks digunakan dua kali.');
      seen.add(key);return row;
    }
    const lineage=JSON.stringify([row.topik,row.sumber]);
    const ordinal=(counts.get(lineage)||0)+1;
    counts.set(lineage,ordinal);
    const teamId=row.teamId??'lama/'+JSON.stringify([row.topik,row.sumber,ordinal]);
    if(typeof teamId!=='string'||!teamId||!(teamId.startsWith('lama/')||/^manual\/[a-f0-9-]{36}$/i.test(teamId))||seen.has(teamId))
      throw Error('Identitas butir kerja tidak sah atau digunakan dua kali.');
    seen.add(teamId);return {...row,teamId};
  });
}
function equal(a,b){
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}
const labels={rows:'Butir pengujian',drafts:'Konsep dokumen',analysis:'Isian KKA',dispositions:'Status temuan',
  scopes:'Lingkup temuan',indexNotes:'Telaah indeks',indexDocuments:'Permintaan dokumen',simulation:'Simulasi ketetapan',business:'Probis dan uji KLU',benchmark:'Acuan benchmark'};
function validTime(time){
  return typeof time==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time)&&
    Number.isFinite(Date.parse(time))&&new Date(time).toISOString()===time;
}
export function readAudit(log,times={}){
  if(log===undefined)return Object.entries(times||{}).map(([key,time])=>({event:'lama/'+key+'/'+time,key,time}));
  if(!Array.isArray(log))throw Error('Format riwayat perubahan tidak dikenali.');
  const seen=new Set();
  return log.map(r=>{
    let pair;try{pair=JSON.parse(r?.key);}catch{/* Reject malformed record keys below. */}
    if(!Array.isArray(pair)||pair.length!==2||!Object.hasOwn(labels,pair[0])||typeof pair[1]!=='string'||
        !validTime(r.time)||typeof r.event!=='string'||seen.has(r.event)||
        !(r.event==='lama/'+r.key+'/'+r.time||/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.event)))throw Error('Periksa waktu, identitas butir, dan penanda riwayat perubahan.');
    seen.add(r.event);return {event:r.event,key:r.key,time:r.time};
  });
}
function joinAudit(a,b){
  const events=new Map();
  for(const r of [...readAudit(a.auditLog,a.editTimes),...readAudit(b.auditLog,b.editTimes)]){
    const previous=events.get(r.event);
    if(previous&&(previous.key!==r.key||previous.time!==r.time))throw Error('Dua riwayat memuat penanda perubahan yang sama dengan isi berbeda.');
    events.set(r.event,r);
  }
  return [...events.values()].sort((x,y)=>x.time.localeCompare(y.time));
}
export function workAuditRows(work){
  const known=records(work);
  return readAudit(work.auditLog,work.editTimes).map(r=>{
    const [group,id]=JSON.parse(r.key);
    return {'Waktu (UTC)':r.time,Bagian:labels[group],Butir:known.get(r.key)?.title||id,
      Catatan:r.event.startsWith('lama/')?'Sunting terakhir yang tercatat pada berkas lama':'Isian disunting'};
  });
}
function records(work){
  const map=new Map();
  function add(group,id,title,value){
    const key=keyOf(group,id);
    if(map.has(key))throw Error('Ditemukan identitas ganda di '+labels[group]+'.');
    map.set(key,{group,id,title,value,time:work.editTimes?.[key]||''});
  }
  for(const r of identifyRows(work.rows||[]))add('rows',rowIdentity(r),r.topik,r);
  for(const d of work.drafts||[])add('drafts',d.id,d.type+' · '+(d.number||d.year),d);
  for(const d of work.indexDocuments||[])add('indexDocuments',String(d.number),'DOK.'+d.number+' · '+d.name,d);
  for(const group of ['analysis','dispositions','indexNotes','scopes','business']){
    for(const [id,value] of Object.entries(work[group]||{})){
      if(group==='scopes'&&value===scopeDefaults[id]&&!work.editTimes?.[keyOf(group,id)])continue;
      add(group,id,id,value);
    }
  }
  const sim=work.simulation;
  if(sim&&(sim.end||sim.cases?.length))add('simulation','sim','Tanggal dan seluruh masa simulasi',sim);
  if(work.benchmark?.length||work.editTimes?.[keyOf('benchmark','acuan')])add('benchmark','acuan','Acuan benchmark dan tarif simulasi',work.benchmark||[]);
  return map;
}
export function validateTimes(input,work){
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Format waktu perubahan tidak dikenali.');
  const known=records({...work,editTimes:input}), valid={};
  for(const [key,time] of Object.entries(input)){
    if(!validTime(time))throw Error('Waktu perubahan atau rujukan butir pada berkas tidak sah.');
    if(known.has(key))valid[key]=time;
  }
  return valid;
}
export function planMerge(current,incoming){
  const local=records(current), received=records(incoming), decisions=[];
  // An older application can discard the persistent ID on export. Relate only an unambiguous pair.
  function byLegacyName(map){
    const groups=new Map();
    for(const [k,r] of map){
      if(r.group!=='rows'||r.value.kkpLine)continue;
      const name=JSON.stringify([r.value.topik,r.value.sumber]);
      if(!groups.has(name))groups.set(name,[]);
      groups.get(name).push(k);
    }
    return groups;
  }
  const oldGroups=byLegacyName(local),newGroups=byLegacyName(received);
  for(const [name,currentKeys] of oldGroups){
    const receivedKeys=newGroups.get(name);
    if(currentKeys.length!==1||receivedKeys?.length!==1)continue;
    const currentKey=currentKeys[0],receivedKey=receivedKeys[0];
    if(currentKey===receivedKey||received.has(currentKey)||local.has(receivedKey))continue;
    const here=local.get(currentKey),other=received.get(receivedKey);
    if(!here.id.startsWith('lama/')&&!other.id.startsWith('lama/'))continue;
    received.delete(receivedKey);received.set(currentKey,{...other,id:here.id,value:{...other.value,teamId:here.id}});
  }
  for(const [key,other] of received){
    const here=local.get(key);
    let rule='tambah';
    if(here){
      if(equal(here.value,other.value))rule='sama';
      else if(['drafts','simulation','indexDocuments','business','benchmark'].includes(other.group)||!here.time||!other.time||here.time===other.time)rule='pilih';
      else rule=here.time<other.time?'terbaru':'lokal';
    }
    decisions.push({key,local:here,incoming:other,rule});
  }
  return {local,decisions,auditLog:joinAudit(current,incoming)};
}
export function mergeWork(plan,choices={}){
  const selected=new Map(plan.local);
  for(const d of plan.decisions){
    const choice=choices[d.key];
    if(d.rule==='pilih'&&!['lokal','berkas'].includes(choice))throw Error('Pilih versi untuk tiap isian yang bertentangan.');
    if(d.rule==='tambah'||d.rule==='terbaru'||d.rule==='sama'&&d.incoming.time>d.local.time||d.rule==='pilih'&&choice==='berkas')selected.set(d.key,d.incoming);
  }
  const result={rows:[],drafts:[],indexDocuments:[],analysis:{},scopes:{...scopeDefaults},dispositions:{},indexNotes:{},business:{},benchmark:[],editTimes:{},simulation:{end:'',cases:[]}};
  for(const [key,record] of selected){
    const {group,id,value,time}=record, cloned=structuredClone(value);
    if(group==='simulation'||group==='benchmark')result[group]=cloned;
    else if(Array.isArray(result[group]))result[group].push(cloned);
    else result[group][id]=cloned;
    if(time)result.editTimes[key]=time;
  }
  result.auditLog=plan.auditLog;
  return result;
}

export function progressReport(pkg,year,work,index){
  const manual=work.rows.filter(r=>!r.kkpLine);
  const indexed=work.rows.filter(r=>r.kkpLine&&!(r.legacyOptionReview&&r.status==='Perlu tindak lanjut'));
  const issues=findingsFor(pkg,String(year),[]);
  const reviewed=issues.filter(f=>Object.hasOwn(work.dispositions,findingKey(f)));
  const summary=[['Kelompok','Sudah dikerjakan','Jumlah','Persentase (%)']];
  const counts=[['Status butir dari paket',reviewed.length,issues.length],['Baris KKP berindeks',indexed.length,index.byId.size],
    ['Butir manual',manual.filter(row=>row.status!=='Belum diuji').length,manual.length]];
  for(const [label,n,total] of counts)summary.push([label,n,total,total?Math.round(100*n/total):null]);
  const total=counts.reduce((n,r)=>n+r[2],0), done=counts.reduce((n,r)=>n+r[1],0);
  const percent=total?Math.round(100*done/total):null;
  summary.push(['Seluruh kelompok',done,total,percent]);
  const rows=work.rows.map(r=>({Butir:r.topik,Status:r.status,Sumber:r.sumber,Petugas:r.petugas,
    'Waktu sunting (UTC)':work.editTimes[keyOf('rows',rowIdentity(r))]||'',Simpulan:r.simpulan}));
  const findings=issues.map(f=>({Butir:f.detail,Masa:f.period,Sumber:f.source,Status:work.dispositions[findingKey(f)]||'Belum diuji'}));
  return {done,total,percent,counts,sheets:[{name:'Kemajuan',rows:summary},{name:'Status butir paket',rows:worksheet(findings)},
    {name:'Isian kertas kerja',rows:worksheet(rows)}]};
}
export function showMergePreview(plan,dialog){
  const choices={}, content=box('stack'), picker=box('stack'),counts={};
  for(const row of plan.decisions)counts[row.rule]=(counts[row.rule]||0)+1;
  content.append(el('p',(counts.tambah||0)+' isian baru, '+(counts.terbaru||0)+' versi berkas lebih baru, '+(counts.lokal||0)+' versi lokal lebih baru, '+(counts.sama||0)+' sama dan '+(counts.pilih||0)+' perlu dipilih.'));
  const summary=el('ul');
  for(const d of plan.decisions){
    const title=labels[d.incoming.group]+' · '+d.incoming.title;
    if(d.rule!=='pilih'){
      summary.append(el('li',title+' · '+({tambah:'ditambahkan',terbaru:'memakai berkas',lokal:'memakai lokal',sama:'sama'}[d.rule])));
      continue;
    }
    const panel=el('details');panel.open=true;panel.append(el('summary',title),
      el('p',['drafts','simulation','indexDocuments'].includes(d.incoming.group)?'Isian terkait berbeda. Periksa kedua versi sebelum memilih.':
        d.local.time&&d.incoming.time?'Waktu perubahan sama.':'Salah satu atau kedua versi belum memiliki waktu perubahan.'),
      detail('Lokal · '+(d.local.time||'tanpa waktu perubahan'),el('pre',JSON.stringify(d.local.value,null,2))),
      detail('Berkas · '+(d.incoming.time||'tanpa waktu perubahan'),el('pre',JSON.stringify(d.incoming.value,null,2))),
      select([['','Pilih versi'],['lokal','Pertahankan lokal'],['berkas','Pakai versi berkas']],'',v=>{choices[d.key]=v;merge.disabled=plan.decisions.some(r=>r.rule==='pilih'&&!choices[r.key]);},'Versi untuk '+title));
    picker.append(panel);
  }
  const merge=button('Gabungkan isian',()=>dialog.merge(mergeWork(plan,choices)));
  merge.disabled=Boolean(counts.pilih);
  content.append(detail('Rincian penggabungan',summary),picker,el('p','Isian yang hanya terdapat di sesi ini tetap tersedia sesudah penggabungan. Ganti isi sesi ini memuat seluruh isian dari berkas.'),
    box('toolbar',merge,button('Ganti isi sesi ini',dialog.replace)));
  return content;
}
