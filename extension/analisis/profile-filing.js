import {normalizeId} from '../app-data.js';
import {afterWeekend,rowsOf,sptDay,submittedDay,submittedListMetadata} from './model.js';
import {monthlyAccounts} from './direct-finding-transfers.js';
import {fieldValue} from './display-fields.js';
import {directStp} from './direct-finding-stp.js';

const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const kinds={VAT_VATR:'PPN',ICT_WITR:'PPh 21/26',ICT_WTR:'PPh Unifikasi',ICT_RCITR:'PPh Badan',ICT_PITR:'PPh Orang Pribadi',
  VAT_VATTRNTEVATC:'PPN pemungut',LBT_LBTR:'PBB'};
export const filingAccounts={VAT_VATR:monthlyAccounts.PPN,ICT_WITR:monthlyAccounts.PPH2126,ICT_WTR:monthlyAccounts.UNIFIKASI};
const yearKinds=new Set(['ICT_RCITR','ICT_PITR','LBT_LBTR']);
const monthKey=(y,m)=>Number(y)*12+Number(m)-1;
const bound=b=>Number.isInteger(b?.y)&&Number.isInteger(b?.m)&&b.m>=1&&b.m<=12?monthKey(b.y,b.m):null;

export function submittedReturnRows(pkg){
  const owner=normalizeId(pkg.manifest?.wp?.npwp);
  return pkg.entries.filter(entry=>(entry.cap?.sumber==='sptdaftar'||entry.path==='spt/daftar.json')&&
    entry.cap?.payload?.isArchieved!==true&&
    (!entry.cap?.konteks?.npwp||normalizeId(entry.cap.konteks.npwp)===owner))
    .flatMap(entry=>rowsOf(entry).flatMap(row=>{
      const meta=submittedListMetadata(row);
      return !meta.ReturnSheetStatusCode||/^submitted$/i.test(meta.ReturnSheetStatusCode) ?
        [{row,meta:{...meta,'Berkas sumber':entry.path}}] : [];
    }));
}

export function filingPeriod(row){
  const raw=String(row.TaxPeriodCode??''),annual=yearKinds.has(row.ReturnSheetTypeCode);
  const match=/^(0[1-9]|1[0-2])(0[1-9]|1[0-2])((?:19|20)\d{2})$/.exec(raw);
  const year=match?Number(match[3]):annual&&/^(19|20)\d\d$/.test(raw)?Number(raw):null;
  if(!year||!annual&&match?.[1]!==match?.[2])return null;
  return {year,month:annual?0:Number(match[1])};
}
function inRange(year,month,first,last){
  return (first===null||monthKey(year,month||12)>=first)&&(last===null||monthKey(year,month||1)<=last);
}

export function filingCalendar(filed,ledger,range,formatCell=status=>status){
  const first=bound(range?.from),last=bound(range?.to),years=new Map(),paid=new Set();
  for(const row of ledger)if(row.AccountingTypeCode==='Payment'&&row.IsCancelled===false){
    paid.add(row.PeriodCode+'|'+row.RevenueCode);
  }
  for(const row of filed){
    const code=row.ReturnSheetTypeCode;
    if(!code)continue;
    const period=filingPeriod(row);
    if(!period||!inRange(period.year,period.month,first,last))continue;
    const {year:y,month:m}=period,raw=String(row.TaxPeriodCode);
    if(!years.has(y))years.set(y,new Map());
    const year=years.get(y);
    if(!year.has(code))year.set(code,new Map());
    const periods=year.get(code);
    if(!periods.has(m))periods.set(m,new Set());
    const day=submittedDay(row),due=afterWeekend(sptDay(row.ExpectedReturnDate));
    let status;
    if(row.ReturnSheetModel==='Normal'){
      status=day&&due?(day>due?'Terlambat':'Tepat'):'Tanggal belum lengkap';
      if(m&&filingAccounts[code]?.some(k=>paid.has(raw+'|'+k)))status+=', ada setoran';
      if(!m&&day)status+=' · '+day.split('-').reverse().join('-');
    }else if(/^Amendment\s+\d+$/i.test(String(row.ReturnSheetModel)))status='Hanya pembetulan';
    else status='Model belum diketahui';
    periods.get(m).add(status);
  }
  function cell(period){
    if(!period)return 'Belum tercantum';
    const normal=[...period].filter(s=>s!=='Hanya pembetulan'&&s!=='Model belum diketahui');
    return normal.length>1?'Periksa beberapa SPT normal':normal[0]||(period.size===1?[...period][0]:'Model belum diketahui');
  }
  return [...years].sort(([a],[b])=>a-b).map(([year,kindsOfYear])=>{
    const annual=[...kindsOfYear.keys()].some(k=>yearKinds.has(k)),rows=[];
    for(const [code,periods] of kindsOfYear){
      const type=kinds[code]||fieldValue('ReturnSheetTypeCode',code),row={'Jenis SPT':type};
      const describe=month=>formatCell(cell(periods.get(month)),{code,type,year,month});
      for(const [i,name] of months.entries()){
        const month=monthKey(year,i+1);
        row[name]=yearKinds.has(code)||first!==null&&month<first||last!==null&&month>last?null:describe(i+1);
      }
      if(annual)row.Tahunan=yearKinds.has(code)?describe(0):null;
      rows.push(row);
    }
    return {title:'Tahun '+year,rows};
  });
}

export function lateFilings(pkg,filed,ledger){
  const range=pkg.manifest.opsi?.periode,first=bound(range?.from),last=bound(range?.to),factsByYear=new Map(),result=[];
  const noticeAccounts={...filingAccounts,ICT_RCITR:['411126'],ICT_PITR:['411125']};
  for(const row of filed){
    const period=filingPeriod(row),day=submittedDay(row),due=afterWeekend(sptDay(row.ExpectedReturnDate));
    if(row.ReturnSheetModel!=='Normal'||!period||!inRange(period.year,period.month,first,last)||!day||!due||day<=due)continue;
    const {year,month}=period,code=row.ReturnSheetTypeCode,id=row.RecordId;
    const form=id?(pkg.forms||[]).find(f=>f.id===id):null;
    let match;
    if(form){
      if(!factsByYear.has(year))factsByYear.set(year,directStp(pkg,year).facts.filter(f=>f.sourceKey?.startsWith('tl/filing/')));
      match=factsByYear.get(year).find(f=>f.formKey===form.key);
    }
    const notices=noticeAccounts[code]?ledger.filter(r=>r.IsCancelled===false&&r.AccountingTypeCode==='TaxNotice'&&r.ReferenceType==='NoticeOfTaxCollection'&&
      String(r.PeriodCode)===String(row.TaxPeriodCode)&&noticeAccounts[code].includes(String(r.RevenueCode))&&r.ReferenceNumber):null;
    result.push({'Jenis SPT':kinds[code]||fieldValue('ReturnSheetTypeCode',code),
      Masa:month?fieldValue('TaxPeriodCode',row.TaxPeriodCode):'Tahun '+year,
      'Batas lapor setelah akhir pekan':due,'Tanggal lapor':day,'Terlambat (hari)':(Date.parse(day)-Date.parse(due))/86400000,
      'Tanggal pemberitahuan keterlambatan':sptDay(row.DateNoticeOfLateFilling)||null,
      'Potensi denda pada pengujian (Rp)':match?.sanctionAmount??null,
      'STP pada akun dan masa yang sama':notices?[...new Set(notices.map(r=>r.ReferenceNumber))].join(', ')||'Tidak ditemukan dalam paket':'Akun pembanding belum terkonfirmasi'});
  }
  return result;
}
