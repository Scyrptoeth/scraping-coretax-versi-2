import {sourceAmount, sptDay} from './model.js';
import {annualRatios} from './peer-analysis.js';
import {packageLedger} from './profile.js';

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

export function dashboardMetrics(pkg,year) {
  year=String(year);
  const annual=annualRatios(pkg,year), main=annual.form?.parts.get('induk');
  const vat=pkg.forms.filter(f=>f.type==='PPN' && f.year===year && f.latest);
  const vatSources=vat.map(f=>f.parts.get('induk')?.path).filter(Boolean);
  const supplies=vat.map(f=>sourceAmount(f,'TotalDeliveryOfGoodsAndServices.SellingPrice'));
  const liabilities=vat.map(f=>sourceAmount(f,'VATUnderOrOverPaid.VAT'));
  const paymentsDue=liabilities.map(value=>value===null ? null : Math.max(0,value));
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
  const ledgerNote=[overlap?'Rincian bulanan dan tahunan bertumpang tindih tanpa ID transaksi.':
    rows.length+' transaksi. Tahun mengikuti masa bulanan atau tanggal pembukuan dan transaksi.',
    uncertain?uncertain+' transaksi dengan status pembatalan belum diketahui tersimpan di data mentah dan di luar jumlah.':'',
    legacy?'Angka sementara mencakup '+legacy+' transaksi paket lama yang belum mencantumkan status pembatalan.':''].filter(Boolean).join(' ');
  const annualSources=main ? [main.path] : [];
  return [
    {id:'sales',label:'Peredaran usaha',value:annual.values.sales.value,sources:annualSources,
      detail:annual.values.sales.field || 'Penjualan bersih pada lampiran L1 dari SPT Badan versi terakhir.'},
    {id:'supplies',label:'Penyerahan PPN',value:vat.length ? sum(supplies) : null,sources:vatSources,
      detail:vat.length+' masa dengan induk PPN versi terakhir. Jumlah harga jual seluruh penyerahan.'},
    {id:'tax',label:'PPh Badan terutang',value:annual.values.tax.value,sources:annualSources,
      detail:'PPh terutang setahun pada induk SPT Badan versi terakhir.'},
    {id:'vatDue',label:'PPN kurang bayar disetor',value:vat.length ? sum(paymentsDue) : null,sources:vatSources,
      detail:vat.length+' masa. Jumlah nilai kurang bayar positif pada induk terakhir tiap masa. Bukti setoran diperiksa di buku besar.'},
    {id:'payments',label:'Pembayaran (buku besar)',value:payValue,sources,
      detail:ledgerNote+' Nilai pembayaran berasal dari jumlah absolut transaksi Payment.'},
    {id:'outstanding',label:'Kewajiban belum lunas',value:openValue,sources,
      detail:ledgerNote+' Jumlah sisa absolut di atas Rp1 pada transaksi debit. Saldo ini mengikuti catatan buku besar.'}
  ];
}
