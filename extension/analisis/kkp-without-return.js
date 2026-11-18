import {normalizeId} from '../app-data.js';
import {listRowType} from '../app-package-entries.js';
import {payloads,rowsOf,typeNames} from './model.js';

const sourceKinds=['BP21','BPA1','BPA2','BPPU','BPCY'];
const noReturn='Daftar SPT dilaporkan yang diperiksa tidak memuat SPT Tahunan OP tahun ini. Angka nol dipakai sebagai pembanding KKP.';
const excludedStatuses=new Set(['AMENDED','CANCELLED','CANCELED','DIBATALKAN','DELETED','DRAFT','REJECTED']);
const activeStatuses=new Map([['NORMAL',1],['APPROVED',1],['AMENDMENT',2],['REPLACEMENT',2],['PEMBETULAN',2]]);
const text=value=>String(value??'').trim();

function completeTable(entry){
  const cap=entry.cap,rows=rowsOf(entry),pages=entry.pages;
  if(cap.lengkap!==true||!pages.length||pages.some(p=>!Array.isArray(p?.Payload?.Data)||p.IsSuccessful===false))return false;
  const totals=[cap.total,...pages.map(p=>p.Payload.TotalRecords)].filter(n=>n!==null&&n!==undefined);
  return totals.length>0&&totals.every(n=>n===rows.length)&&(cap.baris==null||cap.baris===rows.length)&&
    (cap.halaman==null||cap.halaman===pages.length);
}
function matchesId(id,values){
  const present=values.filter(v=>v!=null&&v!=='');
  return present.length>0&&present.every(v=>normalizeId(text(v))===id);
}
function ownerProfile(pkg,id){
  const profiles=pkg.entries.filter(e=>e.cap.sumber==='info'||e.path==='profil/informasi-umum.json');
  const rows=profiles.flatMap(e=>payloads(e).flatMap(p=>p?.GeneralInformation?[p.GeneralInformation]:[]));
  if(!rows.length||rows.some(r=>r.TaxpayerType!=='TA001'||!matchesId(id,[r.UniqueIdentificationNumber])))return null;
  const aggregates=new Set(rows.map(r=>r.AggregateIdentifier).filter(Boolean));
  return aggregates.size===1?[...aggregates][0]:null;
}
function yearOf(value){
  const v=text(value);
  return /^(?:\d{4})?(19\d{2}|20\d{2})$/.exec(v)?.[1]||/^(19\d{2}|20\d{2})-/.exec(v)?.[1]||'';
}
function failedPaths(pkg){
  return (pkg.manifest.gagal||[]).map(f=>String(f.path||f.endpoint||f.label||'').toLowerCase());
}
function unrelatedFilters(query){
  return !query||!Array.isArray(query.Filters)||query.Filters.length>0||Number(query.First)!==0;
}
function annualAbsence(pkg,id,aggregate,year,failed){
  if(pkg.forms.some(f=>f.type==='OP'&&f.year===year))return null;
  const range=pkg.manifest.opsi?.periode;
  if(!range||!(Number(range.from?.y)*100+Number(range.from?.m)<=Number(year)*100+1)||
     !(Number(range.to?.y)*100+Number(range.to?.m)>=Number(year)*100+12))return null;
  const selected=pkg.manifest.opsi?.jenisSpt;
  if(Array.isArray(selected)&&!selected.includes('ICT_PITR'))return null;
  const lists=pkg.entries.filter(e=>e.cap.sumber==='sptdaftar'||e.path==='spt/daftar.json');
  if(!lists.length||failed.some(f=>f.includes('spt/daftar')||f.includes('sptdaftar')||f.includes('returnsheetssubmitted')))return null;
  for(const entry of lists){
    const query=entry.cap.payload;
    if(!completeTable(entry)||unrelatedFilters(query)||query.isArchieved===true||
       query.TaxpayerAggregateIdentifier!==aggregate||!matchesId(id,[entry.cap.konteks?.npwp]))return null;
    const ids=new Set();
    for(const row of rowsOf(entry)){
      if(row.TaxpayerAggregateIdentifier&&row.TaxpayerAggregateIdentifier!==aggregate)return null;
      if(!row.RecordId||ids.has(row.RecordId))return null;
      ids.add(row.RecordId);
      const type=listRowType(row);
      if(!type)return null;
      if(type==='ICT_PITR'){
        const rowYear=yearOf(row.TaxPeriodCode);
        if(!rowYear||rowYear===year)return null;
      }
    }
  }
  return lists.map(e=>e.path);
}

function sourceIdentity(entry){
  const path=/^bukti-potong-lawan\/(\d{4})\/([A-Z0-9]+)\.json$/i.exec(entry.path);
  const {konteks={},payload={}}=entry.cap;
  const years=[path?.[1],konteks.tahun,yearOf(payload.TaxYear)].filter(v=>v!=null&&v!=='').map(String);
  const kinds=[path?.[2],konteks.jenis,payload.WithholdingSlipsType].filter(Boolean).map(v=>text(v).toUpperCase());
  return {years,kinds,consistent:new Set(years).size===1&&new Set(kinds).size===1};
}
function category(kind,row){
  const object=text(row.TaxObjectCode),article=text(row.TaxArticle).toUpperCase(),status=text(row.IncomeTaxStatus).toUpperCase();
  const statedNonFinal=/NON[\s_-]*FINAL|TIDAK[\s_-]*FINAL/.test(status);
  const final=(/FINAL/.test(status)&&!statedNonFinal)||/4\s*(?:AYAT\s*)?\(?2\)?|PASAL\s*15\b/.test(article)||
    /^28-|^21-4/.test(object);
  if(final)return statedNonFinal?'unknown':'excluded';
  if(['BPA1','BPA2'].includes(kind))return 'employee';
  if(statedNonFinal||kind==='BP21'&&/^21-100-\d+$/.test(object)||
     /^23-/.test(object)&&/\b23\b/.test(article))return 'other';
  return 'unknown';
}
function availableSlips(entries,id,year,failed){
  const byNumber=new Map(),issues=[],sources=new Map(),seenKinds=new Set();
  const warn=(kind,message)=>issues.push({kind,message});
  for(const entry of entries){
    const {years,kinds,consistent}=sourceIdentity(entry),kind=kinds[0];
    if(!years.includes(year)||!kinds.some(k=>sourceKinds.includes(k)))continue;
    const {payload={},konteks={}}=entry.cap;
    seenKinds.add(kind);sources.set(entry.path,kind);
    if(!consistent||!matchesId(id,[konteks.npwp,payload.IncomeRecipientTin])||unrelatedFilters(payload)||
       ['TaxPeriod','WithholderTin','WithholdingSlipsNumber','WithholdingSlipsStatus'].some(k=>payload[k]!=null&&payload[k]!=='')){
      warn(consistent?kind:'','Periksa WP, tahun, jenis dan filter pada '+entry.path+'.');continue;
    }
    if(!completeTable(entry))warn(kind,'Cakupan belum lengkap pada '+entry.path+'.');
    rowsOf(entry).forEach((row,i)=>{
      const location=entry.path+' · baris '+(i+1),period=text(row.TaxPeriodCode);
      if(!matchesId(id,[row.EmployeeTin,row.IncomeRecipientTin])||yearOf(period)!==year||row.FiscalYear!=null&&text(row.FiscalYear)!==year){
        warn(kind,'Identitas penerima atau tahun berbeda/tidak terbaca pada '+location+'.');return;
      }
      const status=text(row.WithholdingSlipsStatus??row.Status).toUpperCase(),rank=activeStatuses.get(status);
      const cancelled=['CANCELLED','CANCELED','DIBATALKAN'].includes(status);
      if(excludedStatuses.has(status)&&!cancelled)return;
      if(!rank&&!cancelled){warn(kind,'Status bukti belum dikenali pada '+location+'.');return;}
      const number=text(row.WithholdingSlipsNumber??row.WithholdingSlipNumber);
      const issuer=normalizeId(text(row.WitholderTin??row.WithholderTin));
      if(!number||!issuer||!matchesId(issuer,[row.WitholderTin,row.WithholderTin])){
        warn(kind,'Periksa nomor bukti dan identitas pemotong pada '+location+'.');return;
      }
      if(issuer===id){warn(kind,'Pemotong dan penerima memakai identitas yang sama pada '+location+'.');return;}
      const key=JSON.stringify([kind,number,period,issuer]);
      const slip={kind,number,period,issuer,status,rank:rank||0,cancelled,location,
        category:category(kind,row),object:text(row.TaxObjectCode),base:Number.isFinite(row.TaxBase)?row.TaxBase:null,
        tax:Number.isFinite(row.IncomeTax)?row.IncomeTax:null};
      if(!byNumber.has(key))byNumber.set(key,[]);
      byNumber.get(key).push(slip);
    });
  }
  for(const kind of sourceKinds){
    if(!seenKinds.has(kind))warn(kind,'Sumber '+kind+' belum tersedia.');
    if(failed.some(p=>p.includes('bukti-potong-lawan/'+year+'/'+kind.toLowerCase())))warn(kind,'Manifest mencatat kegagalan pengambilan '+kind+'.');
  }
  if(failed.some(p=>p.includes('tinwithholdingslipsreport')||p.includes('bplawan')))warn('','Manifest mencatat kegagalan pengambilan bukti potong.');
  const slips=[];
  for(const versions of byNumber.values()){
    const active=versions.filter(s=>!s.cancelled);
    if(!active.length)continue;
    const best=Math.max(...active.map(s=>s.rank)),latest=active.filter(s=>s.rank===best);
    const equivalent=new Set(latest.map(s=>JSON.stringify([s.category,s.object,s.base,s.tax])));
    if(versions.some(s=>s.cancelled)||equivalent.size!==1){warn(active[0].kind,'Versi bukti bertentangan untuk '+active[0].location+'.');continue;}
    const slip=latest[0];
    if(slip.category==='unknown'){warn(slip.kind,'Sifat final bukti belum dapat dipastikan pada '+slip.location+'.');continue;}
    if(slip.category!=='excluded')slips.push(slip);
  }
  return {slips,sources,issues};
}

export function withoutReturnIndices(pkg,year){
  year=String(year);
  const entries=pkg.entries.filter(e=>e.cap?.sumber==='bplawan'||e.path.startsWith('bukti-potong-lawan/'));
  const none={groups:[],warnings:[]},id=normalizeId(text(pkg.manifest.wp?.npwp));
  if(!id||!entries.length||!entries.some(e=>sourceIdentity(e).years.includes(year)))return none;
  const aggregate=ownerProfile(pkg,id);
  if(!aggregate||pkg.forms.some(f=>f.type==='OP'&&f.year===year))return none;
  const failed=failedPaths(pkg),lists=annualAbsence(pkg,id,aggregate,year,failed);
  if(pkg.report?.valid===false||!lists)return {groups:[],warnings:['KKP tanpa SPT belum tersedia. Periksa integritas paket serta cakupan daftar SPT tahunan OP untuk '+year+'.']};
  const evidence=availableSlips(entries,id,year,failed),groups=[];
  for(const [ref,title,topic,field] of [
    ['B-8','Penghasilan lainnya dalam negeri','DPP pada bukti potong nonfinal selain A1/A2','base'],
    ['B-17','Kredit pajak','PPh pada bukti potong nonfinal termasuk A1/A2','tax']]){
    const slips=evidence.slips.filter(s=>field==='tax'||s.category==='other');
    if(!slips.length)continue;
    const relevant=kind=>field==='tax'||!['BPA1','BPA2'].includes(kind);
    const warnings=[...new Set(evidence.issues.filter(i=>relevant(i.kind)).map(i=>i.message))];
    if(slips.some(s=>s[field]===null))warnings.push('Ada bukti tanpa nominal '+(field==='tax'?'PPh':'DPP')+' yang dapat dibaca.');
    const key='OP/'+ref,explanation=noReturn+' '+(field==='base'?'DPP adalah dasar pada bukti potong. Penghasilan neto perlu diuji tersendiri.':'Kelayakan kredit pajak perlu diuji dengan dokumen pendukung.');
    const source=[...lists,...[...evidence.sources].filter(([,kind])=>relevant(kind)).map(([path])=>path)].join('\n');
    const line={id:'tanpa-spt/'+id+'/'+year+'/'+ref,groupKey:key,ref,period:year,version:null,topic,tax:typeNames.OP,
      amount:0,partial:warnings.length>0,source,withoutReturn:true,prefill:warnings.length?null:slips.reduce((sum,s)=>sum+s[field],0),
      explanation,coverage:warnings,details:slips.map(s=>({Jenis:s.kind,Nomor:s.number,Masa:s.period,'NPWP pemotong':s.issuer,
        Status:s.status,'Kode objek':s.object,DPP:s.base,PPh:s.tax,Sumber:s.location}))};
    groups.push({key,ref,title,tax:typeNames.OP,lines:[line]});
  }
  return {groups,warnings:[...new Set(evidence.issues.map(i=>i.message))]};
}
