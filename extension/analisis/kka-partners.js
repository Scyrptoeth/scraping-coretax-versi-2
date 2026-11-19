import {normalizeId} from '../app-data.js';
import {inPeriod,periodOf,rangeIsValid} from '../app-spt-plan.js';
import {confirmedAbsentPeriods,documentState,months} from './indicative-source.js';
import {rowsOf} from './model.js';
import {usesOtherCurrency} from './return-source.js';
import {ledgerPageCountProven} from './temporary-findings-installments.js';
import {sourceAmount} from './withholding-forms.js';

const slipKinds=['BP21','BP26','BPA1','BPA2','BPCY','BPPU','BPSP'];
const text=value=>String(value??'').trim();
const usableId=value=>{
  const id=normalizeId(value);
  return id&&!/^0+$/.test(id)?id:null;
};

function transaction(row,idFields,nameFields,numberFields,path) {
  const ids=idFields.map(k=>text(row[k])).filter(Boolean).map(usableId);
  const id=ids[0]&&ids.every(value=>value===ids[0])?ids[0]:null;
  const name=nameFields.map(k=>text(row[k])).find(Boolean)||null;
  const number=numberFields.map(k=>text(row[k])).find(Boolean);
  const base=sourceAmount(row.TaxBase);
  if(!number||base===null||usesOtherCurrency(row))return null;
  return {id,name,number,base,path};
}

function vatEvidence(pkg,year,part) {
  const isBuyer=part==='a2', prefix=isBuyer?'Buyer':'Seller';
  const range=pkg.manifest?.opsi?.periode,scoped=rangeIsValid(range);
  const absent=confirmedAbsentPeriods(pkg,year,'PPN');
  const records=[],sources=[],unknown=[];
  let verified=0,omitted=0;
  for(const [i,source] of months(pkg,year,'PPN',part).entries()){
    const period=year+'-'+String(i+1).padStart(2,'0');
    if(scoped&&!inPeriod(periodOf(period,false),false,range))continue;
    if(!source){
      if(absent.has(period)){
        verified++;
        if(!sources.includes('spt/daftar.json'))sources.push('spt/daftar.json');
      }
      else unknown.push(period);
      continue;
    }
    verified++;
    sources.push(source.path);
    for(const row of source.rows){
      const state=documentState(row);
      if(state==='omit')continue;
      const record=state==='active'&&transaction(row,[prefix+'Tin',prefix+'TIN','TIN','Tin'],
        [prefix+'Name','Name'],['DocumentNumber','TaxInvoiceNumber','InvoiceRecordId','RecordId'],source.path);
      if(record)records.push({...record,key:JSON.stringify([period,record.id,record.number])});
      else omitted++;
    }
  }
  return {records,sources,omitted,complete:verified===12,
    coverage:verified+'/12 masa terverifikasi'+(unknown.length?' · Belum terverifikasi '+unknown.join(', '):'')};
}

function slipFile(pkg,year,owner,kind) {
  const path='bukti-potong-lawan/'+year+'/'+kind+'.json', matches=pkg.entries.filter(e=>e.path===path);
  if(matches.length!==1||!owner||pkg.report?.valid===false)return null;
  const entry=matches[0],{payload:query={},konteks:context={}}=entry.cap||{};
  const ids=[context.npwp,query.IncomeRecipientTin].map(text).filter(Boolean);
  const years=[context.tahun,query.TaxYear&&text(query.TaxYear).slice(0,4)].map(text).filter(Boolean);
  const kinds=[context.jenis,query.WithholdingSlipsType].map(text).filter(Boolean);
  const failed=(pkg.manifest.gagal||[]).some(f=>[path,'data/'+path].includes(typeof f==='string'?f:f?.path));
  if(!ids.length||ids.some(id=>usableId(id)!==owner)||years.some(y=>y!==year)||kinds.some(k=>k.toUpperCase()!==kind)||
    failed||usesOtherCurrency(entry.cap,context,query)||!entry.pages?.length||
    entry.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length))return null;
  return entry;
}

function slipEvidence(pkg,year) {
  const owner=usableId(pkg.manifest?.wp?.npwp),records=[],sources=[],unknown=[];
  let verified=0,omitted=0;
  for(const kind of slipKinds){
    const entry=slipFile(pkg,year,owner,kind),query=entry?.cap?.payload||{};
    const rows=rowsOf(entry);
    if(entry){
      sources.push(entry.path);
      const filtered=Boolean(query.TaxPeriod||query.WithholderTin||query.WithholdingSlipsNumber||
        query.WithholdingSlipsStatus||query.Filters?.length);
      if(!filtered&&ledgerPageCountProven(entry,rows.length))verified++;
      else unknown.push(kind);
    }else unknown.push(kind);
    for(const row of rows){
      const slipStatus=text(row.WithholdingSlipsStatus||row.Status).toUpperCase();
      const status=documentState({...row,WithholdingSlipsStatus:slipStatus});
      if(status==='omit'||['AMENDED','DELETED','DIBATALKAN'].includes(slipStatus))continue;
      const recipients=[row.EmployeeTin,row.IncomeRecipientTin].map(text).filter(Boolean);
      const years=[row.FiscalYear,periodOf(row.TaxPeriodCode,false)?.year].map(text).filter(Boolean);
      const owned=recipients.length&&recipients.every(id=>usableId(id)===owner);
      const periodMatches=years.length&&years.every(y=>y===year)&&(!row.TaxPeriodCode||periodOf(row.TaxPeriodCode,false));
      const active=status==='active'||['AMENDMENT','REPLACEMENT','PEMBETULAN'].includes(slipStatus);
      const record=owned&&periodMatches&&active&&transaction(row,['WitholderTin','WithholderTin'],
        ['WitholderName','WithholderName'],['WithholdingSlipsNumber','WithholdingSlipNumber'],entry.path);
      if(record)records.push({...record,key:JSON.stringify([kind,record.id,record.number])});
      else omitted++;
    }
  }
  return {records,sources,omitted,complete:verified===slipKinds.length,
    coverage:verified+'/'+slipKinds.length+' jenis terverifikasi'+(unknown.length?' · Belum terverifikasi '+unknown.join(', '):'')};
}

function ranking(evidence) {
  const documents=new Map(),conflicts=new Set(),partners=new Map();
  for(const row of evidence.records){
    const known=documents.get(row.key);
    if(known&&known.base!==row.base)conflicts.add(row.key);
    else if(!known)documents.set(row.key,row);
  }
  const unassigned={count:0,base:0,sources:new Set()};
  for(const row of documents.values()){
    if(conflicts.has(row.key))continue;
    if(!row.id){
      unassigned.count++;
      unassigned.base+=row.base;
      unassigned.sources.add(row.path);
      continue;
    }
    if(!partners.has(row.id))partners.set(row.id,{id:row.id,name:row.name,count:0,base:0,sources:new Set()});
    const partner=partners.get(row.id);
    partner.name??=row.name;
    partner.count++;
    partner.base+=row.base;
    partner.sources.add(row.path);
  }
  const values=[...partners.values()].sort((a,b)=>b.base-a.base);
  const omitted=evidence.omitted+conflicts.size,complete=evidence.complete&&!omitted&&!unassigned.count;
  const any=Boolean(values.length||unassigned.count);
  const status=complete?'Terverifikasi':any?'Sebagian':'Belum tersedia';
  const coverage=status+' · '+evidence.coverage+
    (unassigned.count?' · '+unassigned.count+' dokumen tanpa NPWP terkonfirmasi':'')+
    (omitted?' · '+omitted+' baris atau dokumen perlu diperiksa':'');
  return {
    values,coverage,unassigned,
    count:any||complete?values.reduce((sum,p)=>sum+p.count,unassigned.count):null,
    total:any||complete?values.reduce((sum,p)=>sum+p.base,unassigned.base):null
  };
}

export function kkaPartnersTable(pkg,year) {
  year=String(year);
  const summary=[['Kelompok','Mitra ber-NPWP terkonfirmasi','Jumlah dokumen terbaca','DPP terbaca (Rp)','Cakupan']],
    detail=[['Kelompok','Peringkat','Nama mitra','NPWP','Jumlah dokumen','DPP (Rp)','Porsi dari DPP terbaca (%)','Cakupan','Berkas sumber']];
  for(const [label,evidence] of [
    ['Pembeli · Lampiran A2 PPN',vatEvidence(pkg,year,'a2')],
    ['Pemasok · Lampiran B2 PPN',vatEvidence(pkg,year,'b2')],
    ['Pemotong · Bukti potong lawan transaksi',slipEvidence(pkg,year)]
  ]){
    const {values,coverage,count,total,unassigned}=ranking(evidence);
    const partners=count===null?null:values.length;
    summary.push([label,partners,count,total,coverage]);
    detail.push([label,null,'Mitra ber-NPWP terkonfirmasi'+(partners===null?'':' '+partners),null,count,total,null,coverage,evidence.sources.join(' · ')]);
    for(const [i,p] of values.slice(0,10).entries()){
      detail.push([label,i+1,p.name,p.id,p.count,p.base,total>0?p.base*100/total:null,coverage,[...p.sources].join(' · ')]);
    }
    if(unassigned.count)detail.push([label,null,'NPWP belum terkonfirmasi',null,unassigned.count,unassigned.base,
      total>0?unassigned.base*100/total:null,coverage,[...unassigned.sources].join(' · ')]);
  }
  const title='L-12 Mitra transaksi utama';
  return {title,rows:summary,workbook:{name:title,rows:detail}};
}
