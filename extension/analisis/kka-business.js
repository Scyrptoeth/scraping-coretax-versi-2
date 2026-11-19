import {checkIdentity,normalizeId} from '../app-data.js';
import {isRegisteredProbisCode,publicGuide,validatedProbisSource} from '../probis-guide.js';
import {businessSheets,validateBusiness} from './business-work.js';
import {rowsOf} from './model.js';
import {generalProfile,profileDay} from './profile-overview.js';
import {annualBusinessCodes} from './profile.js';

const text=v=>typeof v==='string'||Number.isSafeInteger(v)?String(v).trim():'';
const openEnd=v=>!text(v)||/^(?:0001|1900)-01-01(?:T.*)?$/.test(text(v));
const hasSource=(e,s,path)=>e.cap?.sumber===s||!e.cap?.sumber&&e.path===path;

function inspectedRows(pkg,entry,owner,tabular=false){
  const cap=entry.cap;
  if(!owner||/^0+$/.test(owner)||normalizeId(cap?.konteks?.npwp)!==owner||!entry.pages?.length||
    entry.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length))return null;
  const records=rowsOf(entry);
  try{checkIdentity(records,owner);}catch{return null;}
  const failed=(pkg.manifest.gagal??[]).some(item=>(typeof item==='string'?[item]:[item?.sumber,item?.path])
    .some(value=>text(value).replace(/^data\//,'')===entry.path||value===cap.sumber));
  const totals=[cap.baris,cap.total].filter(v=>v!=null);
  const complete=cap.lengkap===true&&!failed&&totals.every(v=>v===records.length)&&
    !cap.payload?.Filters?.length&&!cap.payload?.First&&
    !cap.halamanSumber?.some(page=>page?.pencocokan?.morePagesAvailable)&&(!tabular||entry.pages.every(page=>{
      const body=page.Payload??page;
      return [body,body.Data,body.Taxpayers,body.rows].some(Array.isArray);
    }));
  return {records,complete};
}

function recordOf(row,path){
  const code=text(row.TradeClassificationCode??row.EconomicCode);
  if(!code)return null;
  const start=profileDay(row.ValidFrom),end=profileDay(row.ValidTo);
  const role=String(row.IsMainEconomicCode).toLowerCase();
  const main=role==='true',roleKnown=main||role==='false';
  const dates=Boolean(start&&(openEnd(row.ValidTo)||end&&end>=start));
  return {TradeClassificationCode:code,ActivityDescription:text(row.ActivityDescription??row.Description),IsMainEconomicCode:roleKnown?main:null,
    ValidFrom:dates?start:text(row.ValidFrom),ValidTo:dates?end:text(row.ValidTo),'Berkas sumber':path,dates,roleKnown};
}

function sourcesFor(pkg){
  const owner=normalizeId(pkg.manifest.wp?.npwp),all=pkg.entries||[];
  const histories=all.filter(e=>hasSource(e,'klu','profil/klu.json'));
  const read=histories.map(entry=>[entry,inspectedRows(pkg,entry,owner,true)]);
  const registry=read.flatMap(([entry,data])=>(data?.records||[]).map(r=>recordOf(r,entry.path)).filter(Boolean));
  const complete=read.length>0&&read.every(([,data])=>data?.complete)&&
    registry.length===read.reduce((count,[,data])=>count+data.records.length,0);
  const snapshots=[];
  for(const entry of all.filter(e=>hasSource(e,'info','profil/informasi-umum.json'))){
    const data=inspectedRows(pkg,entry,owner);
    if(!data?.complete)continue;
    for(const info of data.records){
      if(normalizeId(generalProfile(info).UniqueIdentificationNumber)!==owner||!info.MainEconomicCode)continue;
      const main=info.MainEconomicCode;
      const declared=main.IsMainEconomicCode;
      if(declared!=null&&declared!==true&&text(declared).toLowerCase()!=='true')continue;
      const record=recordOf({...main,IsMainEconomicCode:true},entry.path);
      if(record)snapshots.push(record);
    }
  }
  const primary=new Map(snapshots.map(r=>[JSON.stringify([r.TradeClassificationCode,r.ActivityDescription,r.ValidFrom,r.ValidTo]),r]));
  return {registry,historyCount:histories.length,complete,snapshot:primary.size===1?[...primary.values()][0]:null};
}

export function kkaBusinessAppendices(pkg,year,work={}){
  year=String(year);
  if(!/^(?:19|20)\d{2}$/.test(year)||pkg.report?.valid===false)return [null,null];
  const {registry,historyCount,complete,snapshot}=sourcesFor(pkg);
  const captured=profileDay(pkg.manifest.dibuat);
  const annual=annualBusinessCodes(registry.filter(r=>r.dates),[year],captured);
  const codes=new Set(annual.map(r=>r.KLU));
  const datedHistory=complete&&registry.every(r=>r.dates&&r.roleKnown);
  const historyCode=datedHistory&&codes.size===1?annual[0]:null;
  const datedSnapshot=snapshot?.dates&&captured&&snapshot.ValidFrom<=captured&&Number(year)<=Number(captured.slice(0,4))?
    annualBusinessCodes([snapshot],[year],captured)[0]:null;
  const profileBasis=captured?'Profil WP pada paket '+captured:'Profil WP pada paket';
  const profileCode=registry.length===0&&(!historyCount||complete)?datedSnapshot:null;
  const code=historyCode?.KLU??profileCode?.KLU;
  const description=historyCode?.Uraian??profileCode?.Uraian;
  const basis=historyCode?historyCode['Berkas sumber']:profileCode?
    profileBasis+' · rentang berlaku pada profil · '+profileCode['Berkas sumber']:null;
  const registeredGuide=isRegisteredProbisCode(code)?[code,description,basis]:null;
  const historyStatus=!historyCount?'Berkas riwayat KLU belum tersedia':complete?
    (registry.length?'Riwayat terbaca dari registrasi':'Berkas registrasi mencatat nol baris'):'Cakupan riwayat belum terverifikasi';
  const wordKlu=[
    ['Isian','Nilai','Sumber atau keterangan'],['Tahun pajak',year,''],
    ['Baris riwayat KLU terbaca',complete||registry.length?registry.length:null,historyStatus],
    ['KLU utama pada tahun pilihan',historyCode?.KLU??null,historyCode?historyCode.Uraian+' · '+basis:
      codes.size>1?'Lebih dari satu kode utama tercatat dalam tahun ini.':'KLU utama pada riwayat tahun ini belum dapat dipastikan.'],
    ['KLU utama pada profil paket',snapshot?.TradeClassificationCode??null,snapshot?
      [snapshot.ActivityDescription,profileBasis,snapshot['Berkas sumber']].filter(Boolean).join(' · '):'Profil belum memuat KLU utama yang bisa diperiksa.']
  ];
  const business=validateBusiness(work.business),reference=business.reference;
  if(reference)wordKlu.push(['Acuan petugas',reference.code,'Edisi '+reference.edition]);
  if(business.activity)wordKlu.push(['Uji kegiatan tersimpan',String(Number(year)-1),business.activity.evidence]);
  const requests=(work.indexDocuments||[]).filter(d=>{
    if(!d.probis)return false;
    try{validatedProbisSource(d.probis,year);return true;}catch{return false;}
  });
  const [guideSheet,testSheet]=businessSheets(pkg,year,{business,indexDocuments:requests},
    {registry,annual:datedHistory?annual:[],guide:registeredGuide?[registeredGuide]:[]});
  const selected=reference?[reference.code,'Pilihan petugas · '+reference.edition]:registeredGuide?[code,basis]:null;
  const guide=selected?publicGuide(selected[0]):null;
  const wordProbis=[['Isian','Rincian'],['Tahun pajak',year]];
  if(guide)wordProbis.push(['KLU acuan',selected[0]],['Dasar pemilihan',selected[1]],['Alur kegiatan',guide.flow],
    ['Langkah pengujian',guide.check],['Permintaan dokumen tersimpan',requests.length]);
  else wordProbis.push(['Acuan belum tersedia','Pilih acuan kegiatan dari Probis untuk WP dan tahun ini.']);
  const klu='L-3a KLU',probis='L-3b Probis dan Uji Data';
  const caveat='Panduan ini memuat langkah uji. Kegiatan aktual dan dokumen pendukung masih perlu dikonfirmasi.';
  const snapshotRows=snapshot?[[],['Rincian KLU pada profil paket'],
    ['Kode','Uraian Coretax','Berlaku sejak','Berlaku sampai','Berkas sumber'],
    [snapshot.TradeClassificationCode,snapshot.ActivityDescription,snapshot.ValidFrom,snapshot.ValidTo,snapshot['Berkas sumber']]]:[];
  return [
    {title:klu,rows:wordKlu,workbook:{name:klu,rows:[[klu],...wordKlu,...snapshotRows,[],...testSheet.rows]}},
    {title:probis,rows:[...wordProbis,['Keterangan',caveat]],workbook:{name:probis,rows:[[probis],[caveat],[],...guideSheet.rows]}}
  ];
}
