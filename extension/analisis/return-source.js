import {normalizeId} from '../app-data.js';
import {listRowType} from '../app-package-entries.js';
import {rowsOf} from './model.js';

const given=v=>v!==null&&v!==undefined&&v!=='';
const taxCodes={PPN:'VAT_VATR',PPH2126:'ICT_WITR',UNIFIKASI:'ICT_WTR',BADAN:'ICT_RCITR',OP:'ICT_PITR'};
const currencyFields=['CurrencyCode','Currency','MataUang','Mata Uang','TaxBaseCurrencyCode','IncomeTaxCurrencyCode'];
const rupiahLabels=new Set(['IDR','RP','RP.','RUPIAH']);
export function usesOtherCurrency(...records){
  return records.some(r=>currencyFields.some(k=>given(r?.[k])&&!rupiahLabels.has(String(r[k]).trim().toUpperCase())));
}
const annualCode=/^(?:0[1-9]|1[0-2])(?:0[1-9]|1[0-2])(\d{4})$/;

export function sourceProblem(pkg,form,part,entry){
  if(!entry)return 'Bagian ini belum ada dalam paket.';
  const {cap={},pages=[]}=entry,ctx=cap.konteks||{},spt=ctx.spt||{},query=cap.payload||{};
  const m=form.period.slice(-2),periodCode=m+m+form.year,owner=normalizeId(pkg.manifest.wp?.npwp);
  const annual=['BADAN','OP'].includes(form.type);
  const sourcePeriod=String(spt.masa??'');
  const periodMatches=annual?annualCode.exec(sourcePeriod)?.[1]===form.year&&
    (!given(form.meta?.TaxPeriodCode)||String(form.meta.TaxPeriodCode)===sourcePeriod):sourcePeriod===periodCode;
  if(!owner||/^0+$/.test(owner))return 'NPWP paket belum dapat diperiksa.';
  const matches=(values,expected)=>values.filter(given).every(v=>String(v)===String(expected));
  if(!matches([ctx.bagian],part)||!matches([spt.recordId,query.RecordId,query.ReturnSheetRecordId],form.id)||
    !matches([spt.tahun],form.year)||!matches([spt.pemb],form.version)||
    !matches([spt.jenis],taxCodes[form.type])||
    (given(spt.masa)&&sourcePeriod!==form.period&&!periodMatches)||
    [ctx.npwp,spt.npwp].filter(given).some(v=>!owner||normalizeId(v)!==owner))return 'Identitas sumber berbeda dari SPT yang dipilih.';
  const failures=Array.isArray(pkg.manifest.gagal)?pkg.manifest.gagal:[];
  if(pkg.report?.valid===false||failures.some(f=>[entry.path,'data/'+entry.path].includes(typeof f==='string'?f:f?.path))||
     cap.lengkap!==true||!pages.length||pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||
     !matches([cap.halaman],pages.length))return 'Sumber belum lengkap atau ada halaman gagal.';
  if(Number(query.First)>0||query.Filters?.length)return 'Sumber memakai filter atau dimulai setelah baris pertama.';
  if(Array.isArray(cap.halamanSumber)&&cap.halamanSumber.some(s=>s?.pencocokan?.morePagesAvailable))return 'Masih ada halaman sumber yang belum disertakan.';
  return '';
}

export function listedReturns(pkg,year,type){
  const periods=new Map(),owner=normalizeId(pkg.manifest.wp?.npwp);
  for(const entry of pkg.entries.filter(e=>e.path==='spt/daftar.json'||e.cap?.sumber==='sptdaftar')){
    const cap=entry.cap||{},query=cap.payload||{};
    if(query.isArchieved===true||(given(cap.konteks?.npwp)&&normalizeId(cap.konteks.npwp)!==owner))continue;
    for(const row of rowsOf(entry)){
      if(listRowType(row)!==type||(given(row.ReturnSheetStatusCode)&&String(row.ReturnSheetStatusCode).toUpperCase()!=='SUBMITTED')||
        (given(row.TaxpayerAggregateIdentifier)&&given(query.TaxpayerAggregateIdentifier)&&row.TaxpayerAggregateIdentifier!==query.TaxpayerAggregateIdentifier))continue;
      const code=String(row.TaxPeriodCode??'');
      const annual=type===taxCodes.BADAN||type===taxCodes.OP;
      const period=annual?(annualCode.exec(code)?.[1]??code):
        /^(0[1-9]|1[0-2])\1(\d{4})$/.test(code)?code.slice(4)+'-'+code.slice(0,2):code;
      if(period.slice(0,4)!==String(year)||(annual?!/^\d{4}$/.test(period):!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)))continue;
      const model=String(row.ReturnSheetModel||'').trim(),amendment=/^(?:Amendment|Pembetulan)\s*(\d+)$/i.exec(model);
      const version=/^Normal$/i.test(model)?0:amendment?Number(amendment[1]):null;
      if(!periods.has(period))periods.set(period,[]);
      periods.get(period).push({id:row.RecordId,version,path:entry.path});
    }
  }
  return periods;
}

export function revisionProblem(list,versions,form){
  const later=list.find(r=>r.version>form.version||
    given(r.id)&&r.version===form.version&&r.id!==form.id||
    given(r.id)&&r.version===null&&!versions.some(f=>f.id===r.id));
  return later?'Pembetulan terakhir pada '+later.path+' belum cocok dengan rekaman SPT dalam paket.':'';
}
