import {checkIdentity,forms,normalizeId,rowsOf} from './app-data.js';
import {planSptDetails} from './app-spt-plan.js';
import {wholePreview} from './app-spt-progress.js';
import {filteredSptSource} from './app-spt-snapshots.js';

const pathSources=new Map([['profil/informasi-umum.json','info'],['profil/pencarian.json','cari2'],
  ['profil/klu.json','klu'],['spt/daftar.json','sptdaftar']]);
const profileSources=new Set(['info','klu','cari2']);
const labels=new Map(forms);
const clean=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const has=v=>v!==undefined&&v!==null&&v!=='';
const key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const typeLabels=new Map([['ta001','Orang Pribadi'],['orangpribadi','Orang Pribadi'],['ta002','Badan'],['badan','Badan']]);
const statusLabels=new Map([['active','Aktif'],['aktif','Aktif'],['inactive','Nonaktif'],['nonaktif','Nonaktif']]);
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(s)?s.slice(0,10):'';
function sourceOf(item){return item.source||pathSources.get(item.path)||item.cap?.sumber;}
function pages(item){return item.pages??(item.page?[item.page]:[]);}
function rowFields(row){return Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[key(k),v]));}
function ownerMatches(row,owner){
  try{checkIdentity([row],owner);}catch{return false;}
  return [row?.UniqueIdentificationNumber,row?.GeneralInformation?.UniqueIdentificationNumber,row?.TaxpayerTIN,row?.TIN]
    .filter(has).every(v=>normalizeId(v)===owner);
}
function owned(item,owner){
  const ids=[item.wp,item.cap?.konteks?.npwp].filter(has);
  return ids.length>0&&ids.every(v=>normalizeId(v)===owner);
}
function single(values){return values.size===1?[...values][0]:null;}
function add(values,v,map){
  const value=clean(v);
  if(value)values.add(map?.get(key(value))||value);
}
function readProfile(wp,items,asOf){
  const sets={name:new Set(),type:new Set(),status:new Set(),klu:new Set()},notes=[];
  const ids=new Set(),registry=new Set(),filtered=[],values=items.filter(e=>profileSources.has(sourceOf(e)));
  let invalid=false,registryUndated=false;
  for(const item of values){
    if(!owned(item,wp)){invalid=true;continue;}
    const source=sourceOf(item);
    if(item.cap?.lengkap===false||item.proof?.pratinjauSumber?.filterAktif)filtered.push(source);
    for(const p of pages(item)){
      if(p?.IsSuccessful===false||p?.Errors?.length){invalid=true;continue;}
      const records=Array.isArray(p?.Payload?.Taxpayers)?p.Payload.Taxpayers:rowsOf(p);
      for(const row of records){
        if(!row||typeof row!=='object'){invalid=true;continue;}
        if(source==='cari2'&&normalizeId(row.UniqueIdentificationNumber)!==wp)continue;
        if(!ownerMatches(row,wp)){invalid=true;continue;}
        const g=row.GeneralInformation||row,c=rowFields(g);
        if(!ownerMatches(g,wp)){invalid=true;continue;}
        if(source==='cari2'||source==='info'){
          for(const v of [c.name,c.nama,c.namawp,c.namawajibpajak,c.taxpayername])add(sets.name,v);
          for(const v of [c.taxpayertype,c.jeniswajibpajak,c.jeniswp])add(sets.type,v,typeLabels);
          for(const v of [c.taxpayerstatus,c.statuswp,c.statuswajibpajak])add(sets.status,v,statusLabels);
          for(const v of [row.MainEconomicCode?.TradeClassificationCode,c.kodekluutama,c.kluutama,c.maintradeclassificationcode])add(sets.klu,v);
          if(g.AggregateIdentifier)ids.add(g.AggregateIdentifier);
        }else{
          const main=c.ismaineconomiccode??c.kluutama??c.utama;
          if(![true,1,'1','true','ya','utama'].includes(typeof main==='string'?main.toLowerCase():main))continue;
          const start=c.validfrom??c.tanggalmulai,end=c.validto??c.tanggalakhir;
          if(has(start)&&(!date(start)||date(start)>asOf)||has(end)&&(!date(end)||date(end)<asOf))continue;
          if(!has(start)&&!has(end))registryUndated=true;
          add(registry,c.tradeclassificationcode??c.kodeklu??c.klu);
        }
      }
    }
  }
  if(invalid||ids.size>1){
    return {name:null,type:null,status:null,klu:null,notes:['Identitas atau pembacaan sumber profil belum dapat dicocokkan.'],hasProfile:values.length>0};
  }
  if(!sets.klu.size){
    sets.klu=registry;
    if(registry.size===1)notes.push(registryUndated?'Registrasi menandai KLU utama ini. Tanggal berlakunya belum tercantum.':
      'KLU utama berasal dari riwayat registrasi yang mencakup akhir periode '+asOf+'.');
  }
  else if(registry.size&&!registry.has(single(sets.klu)))notes.push('KLU utama pada profil berbeda dari registrasi pada akhir periode. Angka yang ditampilkan berasal dari profil.');
  for(const [k,label] of [['name','Nama WP'],['type','Jenis WP'],['status','Status WP'],['klu','KLU utama']]){
    if(sets[k].size>1)notes.push(label+' berbeda antarbaris. Periksa sumber profil.');
  }
  if(filtered.length)notes.push('Profil atau registrasi hanya mencakup baris yang tersedia.');
  if(!sets.klu.size&&!values.some(e=>sourceOf(e)==='info')&&values.some(e=>sourceOf(e)==='klu'))
    notes.push('Belum ada baris registrasi yang menandai KLU utama pada akhir periode.');
  return {...Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,single(v)])),notes,hasProfile:values.length>0};
}

function indexCoverage(item){
  const a=item.proof?.daftarPratinjau;
  if(a)return wholePreview(a);
  const ps=pages(item),cap=item.cap||{},q=cap.payload||{};
  if(!ps.length||ps.some(p=>p?.IsSuccessful===false||p?.Errors?.length)||item.proof?.morePagesAvailable||
    cap.lengkap===false||filteredSptSource(q)||Number(q.First)>0||ps.some(p=>[p,p?.Payload,p?.Request,p?.Payload?.Request,p?.Query,p?.Payload?.Query]
      .some(x=>filteredSptSource(x)||Number(x?.First)>0||x?.HasMore===true))||cap.halamanSumber?.some(p=>p?.pencocokan?.morePagesAvailable||
      p?.pencocokan?.indexScope?.filtered||p?.pencocokan?.daftarPratinjau&&!wholePreview(p.pencocokan.daftarPratinjau)))return false;
  const count=ps.reduce((n,p)=>n+rowsOf(p).length,0);
  const totals=[cap.total,...ps.map(p=>p?.Payload?.TotalRecords),item.total].filter(has);
  return totals.length>0&&totals.every(t=>Number.isSafeInteger(Number(t))&&Number(t)===count);
}
function submitted(wp,items,period,types){
  const lists=items.filter(e=>sourceOf(e)==='sptdaftar'),cleanItems=[];
  let complete=lists.length>0,scopeIssues=0;
  for(const item of lists){
    if(!owned(item,wp)||item.cap?.payload?.isArchieved===true){scopeIssues++;continue;}
    complete=complete&&indexCoverage(item);
    for(const page of pages(item)){
      if(page?.IsSuccessful===false||page?.Errors?.length){scopeIssues++;continue;}
      const records=rowsOf(page).filter(r=>{
        if(!r||typeof r!=='object'){scopeIssues++;return false;}
        const c=rowFields(r),query=item.cap?.payload?.TaxpayerAggregateIdentifier;
        if(!ownerMatches(r,wp)||query&&r.TaxpayerAggregateIdentifier&&r.TaxpayerAggregateIdentifier!==query){scopeIssues++;return false;}
        const status=clean(c.returnsheetstatuscode||c.statuspelaporan||c.statusspt).toUpperCase();
        if(status&&!['SUBMITTED','DILAPORKAN','TELAH DILAPORKAN'].includes(status)){scopeIssues++;return false;}
        return true;
      });
      cleanItems.push({wp,source:'sptdaftar',page:{Payload:{Data:records}}});
    }
  }
  const {documents,counts}=planSptDetails({wp,period,types,items:cleanItems,strictReceipts:true});
  const errors=scopeIssues+counts.missing+counts.conflicts+counts.unknown+counts.failedIndexPages;
  complete=complete&&!errors;
  const groups=new Map();
  for(const d of documents){
    const year=d.period.slice(0,4),id=year+'/'+d.type;
    if(!groups.has(id))groups.set(id,{year,type:d.type,normal:0,amendments:0});
    groups.get(id)[d.revision===0?'normal':'amendments']++;
  }
  const rows=[...groups.values()].sort((a,b)=>b.year.localeCompare(a.year)||forms.findIndex(([t])=>t===a.type)-forms.findIndex(([t])=>t===b.type));
  const notes=[];
  if(!lists.length)notes.push('Daftar SPT dilaporkan belum tersedia untuk WP dan periode ini.');
  else if(!complete)notes.push('Jumlah mengikuti versi yang bisa dicocokkan. Cakupan daftar sebagian atau belum terkonfirmasi.');
  if(errors)notes.push(errors+' baris atau sumber tidak dapat dicocokkan dengan WP, jenis, masa, status pelaporan, atau versi SPT.');
  return {total:complete||documents.length?documents.length:null,complete,rows,notes,available:lists.length>0};
}

export function wpPreview({wp,period,types,items,previous}){
  const owner=normalizeId(wp);
  if(!owner||/^0+$/.test(owner))throw Error('Pratinjau memerlukan satu NPWP yang valid.');
  const last=new Date(Date.UTC(period.to.y,period.to.m,0)).toISOString().slice(0,10);
  let profile=readProfile(owner,items,last);
  if(!profile.hasProfile&&previous&&normalizeId(previous.meta?.wp?.npwp)===owner){
    const saved=readProfile(owner,previous.entries||[],last);
    if(saved.hasProfile){profile=saved;profile.notes.push('Profil berasal dari hasil tersimpan pada '+(date(previous.meta.dibuat)||'tanggal yang belum tercantum')+'.');}
  }
  return {profile,spt:submitted(owner,items,period,types)};
}

export function renderWpPreview(container,summary,table,row){
  const {spt,profile}=summary;
  if(spt.rows.length){
    const body=table(container,'Rincian SPT dilaporkan per tahun dan jenis',['Tahun','Jenis SPT','Normal','Pembetulan','Jumlah versi']);
    for(const g of spt.rows)row(body,[g.year,labels.get(g.type),g.normal,g.amendments,g.normal+g.amendments]);
  }
  const notes=[...profile.notes,...spt.notes];
  if(spt.available)notes.push('Setiap versi dihitung sekali pada tahun dan jenis SPT yang dipilih.');
  for(const note of notes){const p=document.createElement('p');p.className='hint';p.textContent=note;container.append(p);}
}
