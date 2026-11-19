import {normalizeId} from '../app-data.js';
import {displayedLedgerAmount,ledgerAnalysisRow} from './ledger-table.js';
import {rowsOf} from './model.js';
import {usesOtherCurrency} from './return-source.js';
import {sourceAmount} from './withholding-forms.js';
import {ledgerPageCountProven} from './temporary-findings-installments.js';

const pathPattern=/^(bukubesar|bukubesar-total)\/((?:19|20)\d{2}-(?:0[1-9]|1[0-2]|setahun))\.json$/;
const present=v=>v!==null&&v!==undefined&&v!=='';
const amount=value=>{const n=sourceAmount(value);return Number.isSafeInteger(n)?n:null;};

function requestScope(entry){
  const query=entry.cap.payload;
  if(!Array.isArray(query?.Filters))return null;
  if(query.Filters.some(f=>!f||typeof f.PropertyName!=='string'||typeof f.MatchMode!=='string'||typeof f.Value==='object'))return null;
  return JSON.stringify(query.Filters.map(f=>JSON.stringify([f.PropertyName,f.MatchMode,String(f.Value),f.CaseSensitive??null,f.AsString??null])).sort());
}

function selection(entry){
  const pages=entry.cap.halamanSumber;
  if(!pages?.length)return null;
  const scopes=[...pages,...(entry.cap.sumberSalinanIdentik||[])].map(p=>p.pemilihanBukuBesar);
  if(scopes.some(s=>!s||s.filterLainPadaSumber!==false||s.konflikStatus>0||
    (s.jenis==='rincian'&&!s.ikutkanBatal&&s.filterPembatalanSumber==='batal')||
    !['aktif','batal','tanpa-filter-pembatalan'].includes(s.filterPembatalanSumber)))return null;
  // A detail page can be filtered a second time during collection. Totals are preserved as received.
  const values=new Set(scopes.map(s=>s.jenis==='rincian'&&!s.ikutkanBatal&&s.filterPembatalanSumber==='tanpa-filter-pembatalan'?
    (s.tidakDiketahui?'tidak-diketahui':'aktif'):s.filterPembatalanSumber));
  return values.size===1&&!values.has('tidak-diketahui')?[...values][0]:null;
}

function sameScope(detail,total){
  const a=requestScope(detail),b=requestScope(total);
  if(a!==null||b!==null)return a!==null&&a===b;
  const source=selection(detail);
  return source!==null&&source===selection(total);
}

function evidence(entry,period,owner,failed){
  const {cap,path,pages}=entry,ctx=cap.konteks||{};
  const [year,month]=period.split('-'),code=(month==='setahun'?'0112':month+month)+year;
  const filters=cap.payload?.Filters;
  if(present(ctx.masa)&&month!=='setahun'&&Number(ctx.masa)!==Number(month))return false;
  if(Array.isArray(filters)&&!filters.some(f=>f?.PropertyName==='PeriodCode'&&f.MatchMode==='equals'&&String(f.Value)===code))return false;
  return !failed.has(path)&&pages.length>0&&pages.every(p=>p&&p.IsSuccessful!==false&&!p.Errors?.length)&&
    (!present(ctx.tahun)||String(ctx.tahun)===year)&&owner&&normalizeId(ctx.npwp)===owner&&!usesOtherCurrency(cap,ctx);
}

function observed(rows,owner,aggregate,period){
  let sum=0n;const seen=new Set();
  const [year,month]=period.split('-');
  for(const raw of rows){
    const r=ledgerAnalysisRow(raw);
    const n=amount(r.Amount??r.Jumlah);
    if(present(r.PeriodCode)){
      const code=String(r.PeriodCode);
      if(!/^(?:0[1-9]|1[0-2])(?:0[1-9]|1[0-2])\d{4}$/.test(code)||code.slice(-4)!==year||month!=='setahun'&&code!==month+month+year)return null;
    }
    if(n===null||usesOtherCurrency(r)||[r.TaxpayerTIN,r.TaxpayerTin,r.TIN,r.NPWP].filter(present).some(v=>normalizeId(v)!==owner)||
      aggregate&&r.TaxpayerAggregateIdentifier&&r.TaxpayerAggregateIdentifier!==aggregate)return null;
    if(r.RecordId){if(seen.has(r.RecordId))return null;seen.add(r.RecordId);}
    sum+=BigInt(n);
  }
  return Number.isSafeInteger(Number(sum))?Number(sum):null;
}

export function reconcileLedgerTotals(pkg){
  const grouped=new Map(),owner=normalizeId(pkg.manifest.wp?.npwp);
  const failed=new Set((pkg.manifest.gagal||[]).map(f=>String(f?.path??f).replace(/^data\//,'')));
  for(const entry of pkg.entries){
    const match=pathPattern.exec(entry.path);if(!match)continue;
    const [,kind,period]=match;
    if(!grouped.has(period))grouped.set(period,{'bukubesar':[],'bukubesar-total':[]});
    grouped.get(period)[kind].push(entry);
  }
  const output=[];
  for(const [period,files] of [...grouped].sort(([a],[b])=>a.localeCompare(b))){
    const [detail]=files.bukubesar,[total]=files['bukubesar-total'];
    const row={'Masa atau tahun':period,'Baris rincian':null,'Jumlah rincian (Rp)':null,'Saldo pembanding (Rp)':null,
      'Selisih (Rp)':null,'Baris total':null,Hasil:'Belum dapat dicocokkan',Cakupan:null,
      'Berkas sumber':[detail?.path,total?.path].filter(Boolean).join(' · ')};
    output.push(row);
    if(files.bukubesar.length!==1||files['bukubesar-total'].length!==1){row.Cakupan='Perlu satu berkas rincian dan satu berkas total untuk periode ini.';continue;}
    const a=detail.cap,b=total.cap,detailId=a.payload?.TaxpayerAggregateIdentifier,totalId=b.payload?.TaxpayerAggregateIdentifier;
    if(pkg.report?.valid===false||!evidence(detail,period,owner,failed)||!evidence(total,period,owner,failed)||
      (b.konteks?.totalOf&&b.konteks.totalOf!==detail.path)||(detailId&&totalId&&detailId!==totalId)){
      row.Cakupan='Periksa WP, periode, berkas yang dirujuk, serta keutuhan pasangan sumber.';continue;
    }
    const records=rowsOf(detail),totals=rowsOf(total);
    const filtered=totals.filter(r=>String(r.Key||'').toLowerCase()==='filtered');
    const chosen=filtered.length?filtered:totals.filter(r=>String(r.Key||'').toLowerCase()==='total');
    row['Baris rincian']=records.length;
    const tabular=detail.pages.every(p=>{const v=p.Payload??p;return Array.isArray(v)||Array.isArray(v.Data)||Array.isArray(v.rows);});
    const sum=tabular?observed(records,owner,detailId,period):null;
    row['Jumlah rincian (Rp)']=sum;
    if(chosen.length!==1||usesOtherCurrency(chosen[0])){row.Cakupan='Saldo sumber untuk lingkup ini belum dapat dipilih.';continue;}
    const balance=chosen[0];
    const expected=amount(Object.hasOwn(balance,'Balance')?balance.Balance:displayedLedgerAmount(balance.Saldo));
    row['Baris total']=chosen[0].Key;row['Saldo pembanding (Rp)']=expected;
    if(!sameScope(detail,total)){row.Cakupan='Filter rincian dan filter total belum dapat dipasangkan.';continue;}
    if(sum===null||expected===null){row.Cakupan='Rincian atau saldo sumber belum memiliki angka rupiah utuh yang dapat dijumlahkan sekali per transaksi.';continue;}
    const delta=sum-expected;
    if(!Number.isSafeInteger(delta)){row.Cakupan='Selisih melampaui ketelitian angka yang didukung.';continue;}
    row['Selisih (Rp)']=delta;
    const complete=ledgerPageCountProven(detail,records.length)&&b.lengkap===true&&(!present(b.halaman)||b.halaman===total.pages.length);
    row.Hasil=delta===0?(complete?'Saldo cocok':'Saldo cuplikan cocok'):'Saldo berbeda';
    row.Cakupan=complete?'Rincian dan total ditandai lengkap oleh sumber.':'Pembandingan hanya mencakup baris tersimpan. Periksa kelengkapan sumber.';
  }
  return output;
}
