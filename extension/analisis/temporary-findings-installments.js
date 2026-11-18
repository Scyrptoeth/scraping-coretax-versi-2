import {normalizeId} from '../app-data.js';
import {checkedCompanyEntry} from './kkp-company-annexes.js';
import {rowsOf} from './model.js';
import {sourceAmount} from './withholding-forms.js';

function monthIsComplete(pkg,entry,owner,year,month,period) {
  const cap=entry?.cap,ctx=cap?.konteks,query=cap?.payload||{};
  if(cap?.lengkap!==true||normalizeId(ctx?.npwp)!==owner||!entry.pages?.length||
    ctx.tahun!=null&&String(ctx.tahun)!==year||ctx.masa!=null&&Number(ctx.masa)!==Number(month)||
    query.First!=null&&query.First!==0||cap.halaman!=null&&cap.halaman!==entry.pages.length||
    cap.halamanSumber?.some(h=>h.pencocokan?.morePagesAvailable)||
    pkg.manifest.gagal?.some(f=>[entry.path,'data/'+entry.path].includes(typeof f==='string'?f:f?.path)))return false;
  const allowed=f=>f.PropertyName==='PeriodCode'&&f.MatchMode==='equals'&&String(f.Value)===period||
    f.PropertyName==='Amount'&&f.MatchMode==='notEquals'&&[0,'0'].includes(f.Value)||
    f.PropertyName==='IsCancelled'&&f.MatchMode==='equals'&&[false,'false',0,'0'].includes(f.Value);
  if(query.Filters!=null&&(!Array.isArray(query.Filters)||!query.Filters.every(allowed)))return false;
  const pages=entry.pages.map(p=>p?.Payload??p);
  if(entry.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||!pages.every(p=>Array.isArray(p?.Data)))return false;
  const totals=[cap.total,...pages.map(p=>p.TotalRecords)].filter(n=>n!=null);
  const size=pages.reduce((n,p)=>n+p.Data.length,0);
  return totals.length>0&&totals.every(n=>Number.isSafeInteger(n)&&n===size)&&(cap.baris==null||cap.baris===size);
}

export function installmentComparison(pkg,year,index) {
  const owner=normalizeId(pkg.manifest?.wp?.npwp);
  const group=index.groups.find(g=>g.key==='BADAN/B.13');
  const line=group?.lines.find(l=>l.period===year&&l.source.endsWith('MainFormData.InstallmentOfIncome'));
  const currency=index.groups.find(g=>g.key==='BADAN/B')?.support?.find(r=>r.Kode==='P25')?.Satuan;
  if(!owner||pkg.report?.valid===false||!line||line.partial||!Number.isFinite(line.amount)||!['IDR','Belum dinyatakan'].includes(currency))return null;
  const forms=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===year);
  const latest=Math.max(...forms.map(f=>f.version)),matches=forms.filter(f=>f.version===latest);
  const parent=matches.length===1&&checkedCompanyEntry(pkg,matches[0],'induk');
  if(!parent||!line.source.startsWith(parent.path+' · '))return null;
  const sources=[],payments=new Set(),references=new Set(),aggregates=new Set();
  let value=0;
  for(let i=1;i<=12;i++) {
    const month=String(i).padStart(2,'0'),period=month+month+year,path='bukubesar/'+year+'-'+month+'.json';
    const candidates=pkg.entries.filter(e=>e.path===path),entry=candidates[0];
    if(candidates.length!==1||!monthIsComplete(pkg,entry,owner,year,month,period))return null;
    const aggregate=entry.cap.payload?.TaxpayerAggregateIdentifier;
    if(aggregate)aggregates.add(aggregate);
    for(const row of rowsOf(entry)) {
      if(String(row.PeriodCode)!==period)return null;
      if(row.AccountingTypeCode!=='Payment'||String(row.RevenueCode)!=='411126'||String(row.PaymentCode)!=='100'||row.IsCancelled===true)continue;
      const amount=sourceAmount(row.Amount);
      const reference=row.ReferenceNumber&&JSON.stringify([period,row.ReferenceNumber]);
      if(row.IsCancelled!==false||amount===null||amount<0||!row.RecordId||payments.has(row.RecordId)||
        reference&&references.has(reference)||
        row.CurrencyCode&&String(row.CurrencyCode).toUpperCase()!=='IDR'||
        row.TaxpayerAggregateIdentifier&&aggregate&&row.TaxpayerAggregateIdentifier!==aggregate)return null;
      if(reference)references.add(reference);
      payments.add(row.RecordId);value+=amount;
    }
    sources.push(path);
  }
  if(aggregates.size>1||!payments.size||!Number.isSafeInteger(value)||value===line.amount)return null;
  return {id:line.id,value,source:sources.join(' · '),note:'Jumlah transaksi pembayaran aktif KAP 411126 KJS 100 pada 12 masa buku besar, termasuk pemindahbukuan masuk yang tercatat sebagai pembayaran. Cocokkan pemanfaatan setoran dan satuan dengan SPT sebelum menetapkan kredit.'};
}
