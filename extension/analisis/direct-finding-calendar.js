import {monthlyRates} from './tarif-sanksi.js';
import {sptDay} from './model.js';

export const directLaw={
  kup:'https://pajak.go.id/sites/default/files/2023-05/SDSN%202023%207.1_0.pdf',
  coretax:'https://jdih.kemenkeu.go.id/dok/pmk-81-tahun-2024/overview',
  collection:'https://jdih.kemenkeu.go.id/dok/pmk-80-tahun-2023/overview',
  transition:'https://www.pajak.go.id/index.php/id/siaran-pers/keterangan-tertulis-kebijakan-penghapusan-sanksi-administratif-sehubungan-dengan',
  december:'https://pajak.go.id/id/pengumuman/kebijakan-perpajakan-sehubungan-dengan-masa-transisi-implementasi-sistem-inti',
  holidays2025:'https://www.kemenkopmk.go.id/sites/default/files/artikel/2025-08/SKB%20Perubahan%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202025.pdf',
  holidays2026:'https://kemenkopmk.go.id/pemerintah-tetapkan-17-hari-libur-nasional-dan-8-hari-cuti-bersama-tahun-2026'
};
// National holidays and collective leave. A local election or a separately
// granted extension can still alter the applicable deadline for a taxpayer.
const holidaysByYear={
  2025:'01-01 01-27 01-28 01-29 03-28 03-29 03-31 04-01 04-02 04-03 04-04 04-07 04-18 04-20 05-01 05-12 05-13 05-29 05-30 06-01 06-06 06-09 06-27 08-17 08-18 09-05 12-25 12-26',
  2026:'01-01 01-16 02-16 02-17 03-18 03-19 03-20 03-21 03-22 03-23 03-24 04-03 04-05 05-01 05-14 05-15 05-27 05-28 05-31 06-01 06-16 08-17 08-25 12-24 12-25'
};
const holidays=new Set(Object.entries(holidaysByYear).flatMap(([year,dates])=>dates.split(' ').map(day=>year+'-'+day)));
const dateOf=day=>new Date(day+'T00:00:00Z');
const iso=date=>date.toISOString().slice(0,10);
export function directBusinessDay(day){
  if(!day||sptDay(day)!==day)return null;
  const date=dateOf(day);
  while(Object.hasOwn(holidaysByYear,date.getUTCFullYear())){
    const value=iso(date),week=date.getUTCDay();
    if(week!==0&&week!==6&&!holidays.has(value))return value;
    date.setUTCDate(date.getUTCDate()+1);
  }
  return null;
}
export function paymentDeadline(type,period){
  if(!['PPN','PPH2126','UNIFIKASI'].includes(type)||!/^20\d\d-(?:0[1-9]|1[0-2])$/.test(period)||period<'2025-01')return null;
  const [year,month]=period.split('-').map(Number);
  const day=type==='PPN'?new Date(Date.UTC(year,month+1,0)):new Date(Date.UTC(year,month,15));
  return directBusinessDay(iso(day));
}
export function directRelief(type,period,event,day){
  if(!['PPN','PPH2126','UNIFIKASI'].includes(type)||!sptDay(day))return '';
  if(event==='filing'&&type==='PPH2126'&&period==='2025-12'&&day<='2026-02-28')return directLaw.december;
  const early=['2025-01','2025-02','2025-03'].indexOf(period);
  if(early<0||event==='payment'&&early!==0)return '';
  const deadlines=type==='PPN'?['2025-03-10','2025-04-10','2025-05-10']:['2025-02-28','2025-03-31','2025-04-30'];
  return day<=deadlines[early]?directLaw.transition:'';
}
// Article 9(2a) and 14(3) have a different KMK column from article 13(2).
const annualBasisPoints={
  2025:[100,101,99,100,100,99,100,96,95,95,92,93],
  2026:[93,92,95,98,97,98,100,102,102,101,102]
};
export function paymentInterest(amount,start,end){
  if(!Number.isSafeInteger(amount)||amount<=0||!sptDay(start)||sptDay(start)!==start||!sptDay(end)||sptDay(end)!==end||end<=start)return null;
  const a=dateOf(start),b=dateOf(end);
  const elapsed=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
  const last=new Date(Date.UTC(b.getUTCFullYear(),b.getUTCMonth()+1,0)).getUTCDate();
  const months=Math.min(24,elapsed+(b.getUTCDate()>Math.min(last,a.getUTCDate())?1:0));
  const first=dateOf(start);first.setUTCDate(first.getUTCDate()+1);
  const month=iso(first).slice(0,7),basisPoints=annualBasisPoints[first.getUTCFullYear()]?.[first.getUTCMonth()],reference=monthlyRates.get(month);
  if(!Number.isInteger(basisPoints)||!reference)return {months,rate:null,amount:null,source:''};
  const rounded=BigInt(amount)*BigInt(months)*BigInt(basisPoints)/10000n;
  return {months,rate:basisPoints/100,amount:Number(rounded),source:reference.decision+' · '+reference.url};
}
