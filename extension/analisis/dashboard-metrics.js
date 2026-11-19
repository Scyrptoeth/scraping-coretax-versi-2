import {sourceAmount, sptDay} from './model.js';
import {annualRatios} from './peer-analysis.js';
import {packageLedger} from './profile.js';
import {listedReturns,revisionProblem} from './return-source.js';

function number(value) {
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) value=Number(value);
  return Number.isFinite(value) ? value : null;
}

function sum(values) {
  return values.every(Number.isFinite) ? values.reduce((total,value)=>total+value,0) : null;
}

function inLedgerYear(row,year) {
  const period=String(row.PeriodCode || '');
  if (/^(0[1-9]|1[0-2])\1\d{4}$/.test(period) && period.slice(-4)===year) return true;
  return (sptDay(row.PostingDate) || sptDay(row.TransactionDate)).slice(0,4)===year;
}

// The annual summary and monthly detail can describe the same transactions.
// If records in both lack an ID and their scopes overlap, their sum is uncertain.
function ambiguousPeriods(rows) {
  const months=new Set(), other=new Set();
  for (const row of rows) {
    if (row.RecordId) continue;
    const path=row['Berkas sumber'];
    const group=/^bukubesar\/\d{4}-(?:0[1-9]|1[0-2])\.json$/i.test(path) ? months : other;
    group.add(String(row.PeriodCode || ''));
  }
  return [...months].some(period=>other.has(period));
}

function vatMetrics(pkg,year) {
  const listed=listedReturns(pkg,year,'VAT_VATR');
  const forms=new Map();
  for(const form of pkg.forms.filter(f=>f.type==='PPN'&&f.year===year)){
    if(!forms.has(form.period))forms.set(form.period,[]);
    forms.get(form.period).push(form);
  }
  const periods=new Set([...listed.keys(),...forms.keys()]);
  const sources=new Set();
  const amounts=[];
  for(const period of periods){
    const versions=forms.get(period)||[], latestVersion=Math.max(...versions.map(f=>f.version));
    const latest=versions.filter(f=>f.version===latestVersion);
    const directory=listed.get(period)||[];
    for(const row of directory)sources.add(row.path);
    if(latest.length!==1||revisionProblem(directory,versions,latest[0]))continue;
    const form=latest[0],main=form.parts.get('induk');
    if(!main)continue;
    sources.add(main.path);
    amounts.push({sales:sourceAmount(form,'TotalDeliveryOfGoodsAndServices.SellingPrice'),
      due:sourceAmount(form,'VATUnderOrOverPaid.VAT'),partial:main.cap?.lengkap===false});
  }
  function indicator(id,label,key,formula,transform=value=>value){
    const known=amounts.filter(item=>Number.isFinite(item[key]));
    const complete=known.length>0&&known.length===periods.size&&known.every(item=>!item.partial);
    const total=known.length?sum(known.map(item=>transform(item[key]))):null;
    const detail=periods.size
      ? known.length+' dari '+periods.size+' masa yang tercatat memiliki angka pada induk versi terakhir. '+formula
      : 'Belum ada masa PPN yang tercatat untuk tahun ini.';
    return {id,label,value:complete?total:null,observedValue:complete?null:total,
      incomplete:total!==null&&!complete,sources:[...sources],detail};
  }
  return [
    indicator('supplies','Penyerahan PPN','sales','Jumlah harga jual seluruh penyerahan.'),
    indicator('vatDue','PPN kurang bayar menurut SPT','due','Jumlah posisi kurang bayar positif. Bukti setoran tercatat di buku besar.',value=>Math.max(0,value))
  ];
}

export function dashboardMetrics(pkg,year) {
  year=String(year);
  const annual=annualRatios(pkg,year), main=annual.form?.parts.get('induk');
  const corporateList=listedReturns(pkg,year,'ICT_RCITR').get(year)||[];
  const canUseAnnual=annual.form&&!revisionProblem(corporateList,pkg.forms.filter(f=>f.type==='BADAN'&&f.year===year),annual.form);
  const corporateNote=!canUseAnnual||!main ? 'Induk SPT Badan versi terakhir belum tersedia untuk tahun ini. ' : '';
  const [supplies,vatDue]=vatMetrics(pkg,year);
  const available=packageLedger(pkg,{includeUncertain:true}).filter(r=>inLedgerYear(r,year));
  const rows=available.filter(r=>r['Status pembatalan untuk analisis']!=='Belum diketahui');
  const sources=[...new Set(rows.map(r=>r['Berkas sumber']))].sort();
  const overlap=ambiguousPeriods(rows);
  const ledgerReady=rows.length>0 && !overlap;
  const paid=rows.filter(r=>/^payment$/i.test(String(r.AccountingTypeCode)));
  const paidAmounts=paid.map(row=>number(row.Amount));
  const debits=rows.filter(row=>number(row.Amount)<0), outstanding=debits.map(row=>number(row.AmountLeft));
  const payValue=ledgerReady && rows.every(row=>row.AccountingTypeCode) && paidAmounts.every(Number.isFinite)
    ? sum(paidAmounts.map(Math.abs)) : null;
  const openValue=ledgerReady && rows.every(row=>number(row.Amount)!==null) && outstanding.every(Number.isFinite)
    ? sum(outstanding.filter(value=>Math.abs(value)>1).map(Math.abs)) : null;
  const uncertain=available.length-rows.length,legacy=rows.filter(r=>r['Status pembatalan untuk analisis']==='Belum diketahui pada paket lama').length;
  const incomplete=pkg.entries.some(entry=>sources.includes(entry.path)&&entry.cap?.lengkap===false);
  const ledgerNote=[overlap?'Rincian bulanan dan tahunan bertumpang tindih tanpa ID transaksi.':
    rows.length+' transaksi. Tahun mengikuti masa bulanan atau tanggal pembukuan dan transaksi.',
    incomplete?'Ada sumber yang ditandai belum lengkap. Angka mengikuti transaksi yang tersedia.':'',
    uncertain?uncertain+' transaksi dengan status pembatalan belum diketahui tersimpan di data mentah dan di luar jumlah.':'',
    legacy?'Angka sementara mencakup '+legacy+' transaksi paket lama yang belum mencantumkan status pembatalan.':''].filter(Boolean).join(' ');
  const annualSources=[...new Set([...(main?[main.path]:[]),...corporateList.map(row=>row.path)])];
  return [
    {id:'sales',label:'Peredaran usaha',value:canUseAnnual?annual.values.sales.value:null,sources:annualSources,
      detail:corporateNote+(annual.values.sales.field || 'Penjualan bersih pada lampiran L1 dari SPT Badan versi terakhir.')},
    supplies,
    {id:'tax',label:'PPh Badan terutang',value:canUseAnnual?annual.values.tax.value:null,sources:annualSources,
      detail:corporateNote+'PPh terutang setahun pada induk SPT Badan versi terakhir.'},
    vatDue,
    {id:'payments',label:'Pembayaran (buku besar)',value:payValue,sources,incomplete:incomplete||uncertain>0,
      detail:ledgerNote+' Nilai setiap transaksi dengan jenis pencatatan Pembayaran dijumlahkan dengan tanda positif.'},
    {id:'outstanding',label:'Kewajiban belum lunas',value:openValue,sources,incomplete:incomplete||uncertain>0,
      detail:ledgerNote+' Jumlah sisa absolut di atas Rp1 pada transaksi debit. Saldo ini mengikuti catatan buku besar.'}
  ];
}
