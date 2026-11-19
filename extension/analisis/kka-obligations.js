import {checkIdentity,normalizeId} from '../app-data.js';
import {filingAccounts,filingCalendar,filingPeriod,submittedReturnRows} from './profile-filing.js';
import {packageLedger} from './profile.js';
import {financialPosition} from './spt-forms.js';
import {returnCodes,rowsOf,sptDay} from './model.js';
import {sourceProblem,usesOtherCurrency} from './return-source.js';
import {sourceAmount} from './withholding-forms.js';

const title='L-4b Pemenuhan Kewajiban';
const noFiling='Belum tercantum';
const monthCode=month=>String(month).padStart(2,'0');
const key=(code,year,month)=>[code,year,month].join('/');
const sources=paths=>[...new Set(paths.filter(Boolean))].join(' · ');
const stated=value=>value!=null&&String(value).trim()!=='';

function groupRows(rows,getKey){
  const groups=new Map();
  for(const row of rows){
    const id=getKey(row);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  return groups;
}

function owned(row,owner){
  try{checkIdentity([row],owner);}catch{return false;}
  return [row.TaxpayerTIN,row.TaxpayerTin].filter(stated).every(id=>normalizeId(id)===owner);
}

function availablePayments(pkg,owner){
  const relevant=pkg.entries.filter(entry=>entry.cap?.sumber==='bb'||entry.path.startsWith('bukubesar/'));
  const ledger={...pkg,entries:relevant.filter(entry=>!entry.pages.some(page=>page?.Errors?.length)&&
    (!stated(entry.cap?.konteks?.npwp)||normalizeId(entry.cap.konteks.npwp)===owner))};
  return groupRows(packageLedger(ledger).filter(r=>r.AccountingTypeCode==='Payment'&&
    (r['Status pembatalan untuk analisis']==='Aktif'||r.IsCancelled===false&&
      r['Status pembatalan untuk analisis']==='Belum diketahui pada paket lama')&&
    sourceAmount(r.Amount)>0&&(sptDay(r.TransactionDate)||sptDay(r.PostingDate))&&
    !usesOtherCurrency(r)&&owned(r,owner)),
  r=>String(r.PeriodCode)+'/'+String(r.RevenueCode));
}

function position(pkg,form,owner){
  const entry=form?.parts.get('induk');
  if(!form||sourceProblem(pkg,form,'induk',entry))return {status:'Induk versi terakhir belum terverifikasi',source:entry?.path};
  const values=rowsOf(entry),body=values[0],main=body?.MainFormData||{};
  if(values.length!==1||usesOtherCurrency(body,main,entry.cap,entry.cap?.konteks)||
    !owned(body,owner)||[body.TIN,main.TIN].filter(stated).some(id=>normalizeId(id)!==owner)||
    [body.TaxPeriodYear,body.TaxYear,main.TaxYear].filter(stated).some(year=>String(year)!==form.year)||
    form.period.includes('-')&&stated(body.TaxPeriodMonth)&&Number(body.TaxPeriodMonth)!==Number(form.period.slice(5)))
    return {status:'Induk belum dapat dibandingkan',source:entry.path};
  const {amount,basis,status,kind}=financialPosition(form,pkg.manifest.wp);
  const described=amount===null?'Angka pada induk belum tersedia':
    kind==='reported-payment'?'Angka setoran tercantum pada induk':
    kind==='withholding'?'Angka pemotongan pada induk':status;
  return {status:described,amount,basis,source:entry.path};
}

export function kkaObligationsAppendix(pkg,year){
  const selected=String(year),owner=normalizeId(pkg.manifest?.wp?.npwp);
  const trusted=owner&&!/^0+$/.test(owner)&&pkg.report?.valid!==false;
  const directoryPackage={...pkg,entries:pkg.entries.filter(entry=>!entry.pages.some(page=>page?.Errors?.length))};
  const filed=trusted?submittedReturnRows(directoryPackage).map(({meta})=>meta).filter(row=>owned(row,owner)):[];
  const directory=groupRows(filed,row=>{
    const p=filingPeriod(row);
    return p?key(row.ReturnSheetTypeCode,p.year,p.month):'';
  });
  const latest=new Map((pkg.forms||[]).filter(form=>form.latest).map(form=>
    [key(returnCodes[form.type],form.year,Number(form.period.slice(5))),form]));
  const payments=trusted?availablePayments(pkg,owner):new Map();
  const details=[],counts=new Map();
  const bump=name=>counts.set(name,(counts.get(name)||0)+1);
  function describe(status,{code,type,year:taxYear,month}){
    if(status===noFiling){
      if(String(taxYear)===selected)bump(status);
      return status;
    }
    const slot=key(code,taxYear,month),digits=monthCode(month);
    const period=month?taxYear+'-'+digits:String(taxYear);
    const documents=directory.get(slot)||[];
    const state=code==='LBT_LBTR'?{status:'Periksa objek pada daftar SPT'}:position(pkg,latest.get(slot),owner);
    const accounts=month?(filingAccounts[code]||[]):[];
    const observed=accounts.flatMap(account=>payments.get(digits+digits+taxYear+'/'+account)||[]);
    const payment=observed.length?'Ada setoran sejenis':accounts.length?
      'Setoran sejenis belum terlihat':'KAP dan masa pembanding belum ditentukan';
    const filing=code==='LBT_LBTR'&&documents.length>1?'Beberapa rekaman objek PBB':
      documents.filter(row=>row.ReturnSheetModel==='Normal').length>1?'Periksa beberapa SPT normal':status;
    if(String(taxYear)===selected){
      bump(filing.split(' · ')[0]);
      if(observed.length)bump('Ada setoran sejenis');
    }
    details.push([taxYear,type,period,filing,state.status,state.amount??null,state.basis??null,payment,
      sources(documents.map(row=>row['Berkas sumber'])),state.source??null,sources(observed.map(row=>row['Berkas sumber']))]);
    return filing+' · '+state.status+(observed.length?' · '+payment:'');
  }
  const calendar=filingCalendar(filed,[],pkg.manifest?.opsi?.periode,describe);
  const summary=[['Status pada tahun '+selected,'Jumlah jenis SPT dan masa']];
  for(const name of ['Tepat','Terlambat','Tanggal belum lengkap','Hanya pembetulan','Periksa beberapa SPT normal',
    'Beberapa rekaman objek PBB','Model belum diketahui',noFiling,'Ada setoran sejenis']){
    if(counts.has(name))summary.push([name,counts.get(name)]);
  }
  if(summary.length===1)summary.push(['Daftar SPT belum cukup untuk membentuk matriks tahun ini',null]);
  const rows=[[title],['Tahun KKA',selected],
    ['Matriks mencakup tahun dan masa pada daftar pelaporan dalam rentang paket. Periksa kewajiban WP untuk masa yang belum tercantum.'],
    ['Ketepatan lapor memakai batas dari sumber dan penyesuaian akhir pekan. Periksa hari libur dan relaksasi yang berlaku.'],
    ['Setoran sejenis berasal dari transaksi aktif berangka positif dengan KAP dan masa yang sama. Periksa alokasinya sebelum memastikan pelunasan.'],[],...summary];
  for(const block of calendar){
    const columns=Object.keys(block.rows[0]);
    rows.push([],[block.title],columns,...block.rows.map(row=>columns.map(column=>row[column])));
  }
  rows.push([],['Rincian sumber matriks'],['Tahun','Jenis SPT','Masa','Status lapor','Posisi pada induk','Nilai pada induk (Rp)',
    'Dasar nilai','Setoran menurut buku besar','Berkas daftar SPT','Berkas induk','Berkas buku besar'],...details);
  return {title,rows:summary,workbook:{name:title,rows}};
}
