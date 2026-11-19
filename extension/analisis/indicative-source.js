import {normalizeId} from '../app-data.js';
import {listRowType} from '../app-package-entries.js';
import {rowsOf,sptDay} from './model.js';
import {listedReturns,revisionProblem,sourceProblem,usesOtherCurrency} from './return-source.js';
import {sourceAmount} from './withholding-forms.js';

export const num=value=>{const n=sourceAmount(value);return Number.isSafeInteger(n)&&n>=0?n:null;};
const codes={BADAN:'ICT_RCITR',PPN:'VAT_VATR',PPH2126:'ICT_WITR',UNIFIKASI:'ICT_WTR'};
function confirmedYear(pkg,year,type,period,part,listed) {
  const forms=pkg.forms.filter(f=>f.type===type&&f.period===period);
  const latest=Math.max(...forms.map(f=>f.version)),pool=forms.filter(f=>f.version===latest);
  if(pool.length!==1)return null;
  const form=pool[0],entry=form.parts.get(part);
  if(revisionProblem(listed.get(period)||[],forms,form)||sourceProblem(pkg,form,part,entry))return null;
  const owner=normalizeId(pkg.manifest?.wp?.npwp),annual=type==='BADAN',
    periodCode=annual?'0112'+year:period.slice(5).repeat(2)+year;
  const pages=entry.pages.map(p=>p.Payload??p);
  if(pages.some(p=>p?.IsFound===false||usesOtherCurrency(p)||p?.TIN&&normalizeId(p.TIN)!==owner||
    p?.PeriodCode&&![period,periodCode].includes(String(p.PeriodCode)))||usesOtherCurrency(form.meta))return null;
  const rows=rowsOf(entry);
  if(part==='induk') {
    const r=rows[0],main=r?.MainFormData??{};
    if(rows.length!==1||usesOtherCurrency(r,main)||[r.TIN,main.TIN].filter(Boolean).some(v=>normalizeId(v)!==owner)||
      [r.TaxPeriodYear,main.TaxYear].filter(v=>v!=null).some(v=>String(v)!==year)||
      !annual&&r.TaxPeriodMonth!=null&&Number(r.TaxPeriodMonth)!==Number(period.slice(-2)))return null;
  }else{
    const totals=[entry.cap.total,...pages.map(p=>p?.TotalRecords)].filter(v=>v!=null);
    if(!pages.every(p=>Array.isArray(p?.Data)||Array.isArray(p))||!totals.length||totals.some(n=>n!==rows.length)||
      entry.cap.baris!=null&&entry.cap.baris!==rows.length||entry.cap.halamanSumber?.some(h=>h.pencocokan?.morePagesAvailable))return null;
  }
  return {rows,path:entry.path,form,period};
}
export function months(pkg,year,type,part) {
  const listed=listedReturns(pkg,year,codes[type]);
  return Array.from({length:12},(_,i)=>confirmedYear(pkg,year,type,year+'-'+String(i+1).padStart(2,'0'),part,listed));
}
export function confirmedAbsentPeriods(pkg,year,type) {
  const opts=pkg.manifest?.opsi,range=opts?.periode,owner=normalizeId(pkg.manifest?.wp?.npwp);
  const validMonth=v=>Number.isInteger(v?.y)&&Number.isInteger(v.m)&&v.m>=1&&v.m<=12;
  if(!owner||pkg.report?.valid===false||!opts?.jenisSpt?.includes(codes[type])||!validMonth(range?.from)||!validMonth(range?.to)||
    12*range.from.y+range.from.m>12*Number(year)+1||12*range.to.y+range.to.m<12*Number(year)+12)return new Set();
  const es=pkg.entries.filter(e=>e.path==='spt/daftar.json');
  const entry=es[0],cap=entry?.cap,q=cap?.payload,records=rowsOf(entry);
  if(es.length!==1||cap?.lengkap!==true||cap.total!==records.length||cap.baris!==records.length||
    normalizeId(cap.konteks?.npwp)!==owner||!q?.TaxpayerAggregateIdentifier||q.First!==0||q.Filters?.length||q.isArchieved!==false||
    !entry.pages?.length||entry.pages.some(p=>p.IsSuccessful===false||p.Errors?.length)||
    records.some(r=>!listRowType(r)||!r.RecordId||!r.TaxPeriodCode||r.TaxpayerAggregateIdentifier&&r.TaxpayerAggregateIdentifier!==q.TaxpayerAggregateIdentifier)||
    pkg.manifest.gagal?.some(f=>(typeof f==='string'?f:f?.path)?.endsWith('spt/daftar.json')))return new Set();
  const listed=listedReturns(pkg,year,codes[type]),absent=new Set();
  if(pkg.forms.filter(f=>f.type===type&&f.year===year).some(f=>!listed.get(f.period)?.some(r=>r.id===f.id&&r.version===f.version)))return absent;
  for(let i=1;i<=12;i++){
    const period=year+'-'+String(i).padStart(2,'0');
    if(!listed.has(period)&&!pkg.forms.some(f=>f.type===type&&f.period===period))absent.add(period);
  }
  return absent;
}
export function company(pkg,year){
  const parent=confirmedYear(pkg,year,'BADAN',year,'induk',listedReturns(pkg,year,codes.BADAN));
  if(!parent)return null;
  const body=parent.rows[0],main=body.MainFormData;
  const variants=Object.keys(body).filter(k=>/^L1[a-z]FormData$/i.test(k)&&body[k]&&typeof body[k]==='object');
  if(!main||variants.length!==1||!/^L1[abc]FormData$/.test(variants[0]))return null;
  const prefix=variants[0].slice(0,3),l1=body[variants[0]],accounts=new Map(),tree=l1[prefix+'TreeData'];
  if(!Array.isArray(tree)||!tree.length)return null;
  function visit(nodes){
    for(const n of nodes){
      const code=String(n?.Data?.AccountCode??'');
      if(!code||accounts.has(code)||n.Children!=null&&!Array.isArray(n.Children))return false;
      accounts.set(code,n.Data);if(n.Children&&!visit(n.Children))return false;
    }
    return true;
  }
  if(!visit(tree))return null;
  const calendarYear=Number(main.AccountingPeriodStart)===1&&Number(main.AccountingPeriodEnd)===12&&
    String(parent.form.meta?.TaxPeriodCode)==='0112'+year||
    sptDay(main.AccountingPeriodStart)===year+'-01-01'&&sptDay(main.AccountingPeriodEnd)===year+'-12-31';
  const end=sptDay(main.AccountingPeriodEnd)?.slice(0,7)||(calendarYear?year+'-12':null);
  return {...parent,body,main,accounts,end,calendarYear,assets:l1[prefix+'Assets']||{},
    liabilities:l1[prefix+'LiabilitiesAndEquity']||{}};
}

export function documentState(row){
  const status=String(row.WithholdingSlipsStatus||row.InvoiceStatus||row.DocumentStatus||'').trim().toUpperCase();
  if([true,1,'true','1'].includes(row.IsCancelled)||[true,1,'true','1'].includes(row.IsDraft)||/CANCEL|BATAL|DRAFT|REJECT/.test(status))return 'omit';
  if(status&&!['NORMAL','APPROVED','VALID','POSTED','ACTIVE','ISSUED','SUBMITTED'].includes(status))return 'unknown';
  return 'active';
}
