import {receiptFields,sptDay,typeNames} from './model.js';
import {packageLedger} from './profile.js';

const months=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const monthlyIncomeTax=new Set(['411121','411124','411125','411126']);
function lateDays(date,due){
  return date&&due?Math.max(0,(Date.parse(date)-Date.parse(due))/86400000):null;
}

export function filingAndPaymentRows(pkg,year){
  const forms=pkg.forms.filter(f=>f.year===String(year));
  const rows=[['Pelaporan SPT normal'],['Jenis SPT','Masa','BPE','Tanggal lapor','Batas sumber','Batas setelah akhir pekan','Ketepatan','Terlambat (hari)','Berkas asal','Nomor penerimaan dokumen','Nomor pada BpsNo']];
  for(const f of forms.filter(f=>f.version===0)){
    const numbers=receiptFields(f.meta);
    rows.push([typeNames[f.type]||f.type,f.period,numbers.BPE,f.reportDate,f.dueDate,f.filingDueDate,
      f.filingLate==null?'Belum dinilai':f.filingLate?'Lewat batas':'Tepat',lateDays(f.reportDate,f.filingDueDate),f.reportSource,
      numbers['Nomor penerimaan dokumen'],numbers['Nomor pada BpsNo']]);
  }
  rows.push([],['Versi SPT yang tersedia dalam paket'],['Jenis SPT',...months]);
  const kindPeriods=new Map();
  for(const f of forms){
    if(!kindPeriods.has(f.type))kindPeriods.set(f.type,new Map());
    const periods=kindPeriods.get(f.type);
    periods.set(f.period,Math.max(periods.get(f.period)??0,f.version));
  }
  for(const [type,periods] of kindPeriods){
    if(periods.has(String(year))){rows.push([typeNames[type]||type,'Tahunan · '+version(periods.get(String(year)))]);continue;}
    rows.push([typeNames[type]||type,...months.map((_,m)=>version(periods.get(year+'-'+String(m+1).padStart(2,'0'))))]);
  }
  rows.push([],['Setoran pada buku besar untuk masa terpilih'],['KAP','KJS','Kode masa','Tanggal transaksi','Tanggal pembukuan','Jumlah','Batas pada sumber','Hari setelah batas sumber','Referensi','Berkas asal']);
  const ledger=packageLedger(pkg).filter(r=>/^\d{8}$/.test(r.PeriodCode)&&String(r.PeriodCode).slice(-4)===String(year));
  const toCheck=[];
  for(const r of ledger.filter(r=>r.AccountingTypeCode==='Payment')){
    const period=String(r.PeriodCode);
    const date=sptDay(r.TransactionDate),due=sptDay(r.DueDate);
    rows.push([r.RevenueCode,r.PaymentCode,period,date,sptDay(r.PostingDate),r.Amount,due,lateDays(date,due),r.ReferenceNumber,r['Berkas sumber']]);
    const month=Number(period.slice(0,2));
    if(Number(year)<2025||period.slice(0,2)!==period.slice(2,4)||month<1||month>12||
        !monthlyIncomeTax.has(String(r.RevenueCode))||String(r.PaymentCode)!=='100')continue;
    const nominal=new Date(Date.UTC(Number(year),month,15)).toISOString().slice(0,10);
    const days=lateDays(date,due||nominal);
    if(days>0)toCheck.push([r.RevenueCode,r.PaymentCode,period,date,due||nominal,days,r.Amount,
      due?'Batas yang tercantum pada sumber':'Tanggal 15 sebelum penyesuaian hari libur',r['Berkas sumber']]);
  }
  rows.push([],['Setoran masa PPh yang perlu diperiksa tanggalnya'],['Periksa hari kerja berikutnya jika tanggal 15 jatuh pada hari libur, serta relaksasi yang berlaku untuk WP.'],
    ['KAP','KJS','Kode masa','Tanggal transaksi','Tanggal pembanding','Hari setelah pembanding','Jumlah','Dasar pembanding','Berkas asal'],...toCheck);
  rows.push([],['Sisa kewajiban dan status yang tercatat'],['Kode masa','Tipe','KAP','Referensi','Jumlah kewajiban','Sisa kewajiban','Status pada sumber','Berkas asal']);
  for(const r of ledger){
    if(!Number.isFinite(r.Amount)||r.Amount>=0)continue;
    const flags=[[r.IsUnderObjection,'Sedang keberatan'],[r.IsLegallyBound,'Berkekuatan hukum tetap']];
    const status=flags.filter(([flag])=>flag===true).map(([,name])=>name).join(' · ');
    if(!(Number.isFinite(r.AmountLeft)&&r.AmountLeft<0)&&!status)continue;
    rows.push([String(r.PeriodCode),r.AccountingTypeCode,r.RevenueCode,r.ReferenceNumber,-r.Amount,
      Number.isFinite(r.AmountLeft)?-r.AmountLeft:null,status,r['Berkas sumber']]);
  }
  return rows;
}

function version(value){
  if(value===undefined)return 'Tidak tercantum';
  return value===0?'Normal':'P'+value;
}
