import {normalizeId} from '../app-data.js';
import {company,documentState,months} from './indicative-source.js';
import {periodFields,rowsOf,sptDay} from './model.js';
import {annualRatios,measures} from './peer-analysis.js';
import {listedReturns,revisionProblem,sourceProblem,usesOtherCurrency} from './return-source.js';
import {ledgerRowsEvidence,ledgerPageCountProven} from './temporary-findings-installments.js';
import {sourceAmount} from './withholding-forms.js';

const amount=sourceAmount;
const sum=parts=>parts.length&&parts.every(Number.isFinite)?parts.reduce((a,b)=>a+b,0):null;
const difference=(a,b)=>[a,b].every(Number.isFinite)?a-b:null;
const ratio=(a,b,m=1)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0&&Number.isFinite(a/b*m)?a/b*m:null;
const measure=(value,source)=>({value:amount(value),source});
const missing=measure(null,'Sumber belum tersedia');
const present=v=>v!==null&&v!==undefined&&v!=='';

function personalReturn(pkg,year){
  const forms=pkg.forms.filter(f=>f.type==='OP'&&f.period===year);
  const latest=forms.filter(f=>f.version===Math.max(...forms.map(v=>v.version)));
  if(latest.length!==1)return null;
  const f=latest[0],e=f.parts.get('induk');
  if(revisionProblem(listedReturns(pkg,year,'ICT_PITR').get(year)||[],forms,f)||sourceProblem(pkg,f,'induk',e))return null;
  const rows=rowsOf(e),body=rows[0],owner=normalizeId(pkg.manifest.wp?.npwp);
  if(rows.length!==1||usesOtherCurrency(f.meta,e.cap,e.cap?.konteks,...e.pages.map(p=>p.Payload),body)||
    [body.TIN,body.TaxpayerTIN,...e.pages.map(p=>p.Payload?.TIN)].filter(present).some(id=>normalizeId(id)!==owner)||
    [body.TaxYear,body.TaxPeriodYear].filter(present).some(y=>String(y)!==year))return null;
  return {body,path:e.path};
}

function annualSource(pkg,year) {
  const hasType=t=>pkg.forms.some(f=>f.period===year&&f.type===t);
  const mixed=hasType('OP')&&hasType('BADAN');
  const annual=mixed?null:company(pkg,year),op=mixed?null:personalReturn(pkg,year);
  const e=annual?.form.parts.get('induk');
  const f=annual&&!usesOtherCurrency(e?.cap,e?.cap?.konteks)?annual:null;
  const values={},ratios={},range=annualRatios(pkg,year);
  for(const [key,metric] of Object.entries(range.values))
    values[key]=f&&range.complete?measure(metric.value,f.path+' · '+metric.field):missing;
  if(f&&range.complete)Object.assign(ratios,range.ratios);
  const source=(field,value)=>measure(value,f?f.path+' · '+field:'Induk SPT Badan dan L1 terverifikasi diperlukan');
  const account=(...codes)=>{
    const found=codes.filter(c=>f?.accounts.has(c));
    return source('L1 akun '+(found.join(' + ')||codes.join(' + ')),sum(found.map(c=>amount(f.accounts.get(c).Amount))));
  };
  const variant=f&&Object.keys(f.body).find(k=>/^L1[ac]FormData$/.test(k)&&f.body[k]),prefix=variant?.slice(0,3);
  const liabilities=f?.body[variant]?.[prefix+'LiabilitiesAndEquity']||{};
  const debts=['AC2102','AC2103'].filter(k=>Object.hasOwn(liabilities,k));
  values.fiscal=source('MainFormData.FiscalNetIncomeAfterTax',f?.main.FiscalNetIncomeAfterTax);
  values.cash=source('L1 aset AC1101',f?.assets.AC1101);
  values.fixed=source('L1 aset tidak lancar AC1699',f?.assets.AC1699);
  values.payables=source('L1 utang usaha '+debts.join(' + '),sum(debts.map(key=>amount(liabilities[key]))));
  values.purchases=account('5001');
  values.depreciation=account('5314');
  values.derDeclared=source('L11BFormData.DebtToEquityRatio',f?.body.L11BFormData?.DebtToEquityRatio);
  const notes=[];
  if(mixed)notes.push('Dua jenis SPT Tahunan berbeda tercatat untuk '+year+'. Cocokkan jenis WP sebelum memakai angka tahunan.');
  else if(hasType('BADAN')&&!f)notes.push('Sumber SPT Badan '+year+' belum memenuhi pemeriksaan versi, identitas, mata uang, atau struktur L1a/L1c.');
  return {values,ratios,account,source,op,corporate:f,hasPersonal:hasType('OP'),notes};
}

function series(pkg,year,type,part,selector,code,indices) {
  const all=months(pkg,year,type,part);
  return sourceSeries(indices.map(i=>all[i]),selector,code);
}

function sourceSeries(take,selector,code){
  const complete=take.filter(Boolean);
  const ref=complete.map(s=>s.path).join(' · ');
  const source=complete.length+'/'+take.length+' masa · '+code+(ref?' · '+ref:'');
  if(complete.length!==take.length)return measure(null,source);
  return measure(selector(complete),source);
}

function recipientCount(sources){
  const ids=new Set();
  for(const s of sources)for(const row of s.rows){
    const id=normalizeId(row.TIN);
    if(!id||/^0+$/.test(id))return null;
    ids.add(id);
  }
  return ids.size;
}

function payrollSeries(months,selector,basis){
  const annual=sourceSeries(months,selector,basis);
  const available=months.filter(Boolean);
  if(available.length>0&&available.length<months.length){
    const observed=selector(available);
    if(Number.isFinite(observed))annual.observed=measure(observed,annual.source);
  }
  return annual;
}

function payrollFigures(pkg,year){
  const parents=months(pkg,year,'PPH2126','induk'),parts=months(pkg,year,'PPH2126','l1a');
  const decemberA1=parts[11]?.rows.length===0;
  let basis='L1A';
  if(decemberA1){
    basis+=' · L1A Desember terverifikasi kosong pada '+parts[11].path+'. L1B A1 dipakai untuk Desember dengan mengecualikan bukti berstatus AMENDMENT.';
    parts[11]=months(pkg,year,'PPH2126','l1b-a1')[11];
  }
  const slips=parts.map((part,i)=>{
    if(!part)return null;
    const rows=[];
    for(const r of part.rows){
      const status=String(r.Status??'').trim().toUpperCase(),state=documentState(r);
      if(state==='omit'||(i===11&&decemberA1&&status==='AMENDMENT'))continue;
      if(state!=='active')return null;
      // L1A contains the slips attached to this revision, including AMENDMENT.
      const byStatus=status==='AMENDMENT'?'active':documentState({DocumentStatus:status});
      if(byStatus==='omit')continue;
      if(byStatus!=='active'||usesOtherCurrency(r))return null;
      rows.push(r);
    }
    return {path:part.path,rows};
  });
  const gross=parents.map((parent,i)=>{
    if(!parent)return null;
    const body=parent.rows[0],blocks=['Form1A','Form1B','Form3'].filter(k=>Object.hasOwn(body[k]??{},'GrossIncome'));
    if(blocks.length)return {path:parent.path+' · '+blocks.map(k=>k+'.GrossIncome').join(' + '),
      value:sum(blocks.map(k=>amount(body[k].GrossIncome)))};
    const part=slips[i];
    if(!part)return null;
    return {path:part.path+' · GrossIncome',value:part.rows.length?sum(part.rows.map(r=>amount(r.GrossIncome))):0};
  });
  return {people:payrollSeries(slips,recipientCount,'TIN unik lintas masa · '+basis),
    salaries:payrollSeries(gross,items=>sum(items.map(s=>s.value)),'GrossIncome langsung pada induk atau bruto bukti pada '+basis)};
}

const allMonths=Array.from({length:12},(_,i)=>i);
function monthlyFigures(pkg,year){
  const supplies=items=>sum(items.map(s=>amount(s.rows[0].TotalDeliveryOfGoodsAndServices?.SellingPrice)));
  return {
    supply:series(pkg,year,'PPN','induk',supplies,'TotalDeliveryOfGoodsAndServices.SellingPrice',allMonths),
    vat:series(pkg,year,'PPN','induk',ss=>sum(ss.map(s=>amount(s.rows[0].VATUnderOrOverPaid?.VAT))),'VATUnderOrOverPaid.VAT',allMonths),
    ...payrollFigures(pkg,year)};
}

function recentDeliveries(pkg){
  const periods=pkg.forms.filter(f=>f.type==='PPN').map(f=>f.period);
  for(const e of pkg.entries.filter(e=>e.path==='spt/daftar.json'||e.cap?.sumber==='sptdaftar')){
    const years=new Set(rowsOf(e).map(r=>String(r.TaxPeriodCode??'').slice(-4)).filter(y=>/^\d{4}$/.test(y)));
    for(const y of years)periods.push(...listedReturns(pkg,y,'VAT_VATR').keys());
  }
  const last=periods.filter(p=>/^\d{4}-(0[1-9]|1[0-2])$/.test(p)).sort().at(-1);
  if(!last)return measure(null,'Tiga masa PPN terakhir belum diketahui.');
  const end=new Date(last+'-01T00:00:00Z'),years=new Map(),refs=[],amounts=[];
  for(const offset of [-2,-1,0]){
    const d=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+offset,1));
    const y=String(d.getUTCFullYear()),month=d.getUTCMonth();
    if(!years.has(y))years.set(y,months(pkg,y,'PPN','induk'));
    const s=years.get(y)[month];
    refs.push(d.toISOString().slice(0,7)+(s?' · '+s.path:' · induk belum terverifikasi'));
    amounts.push(amount(s?.rows[0].TotalDeliveryOfGoodsAndServices?.SellingPrice));
  }
  return measure(sum(amounts),'TotalDeliveryOfGoodsAndServices.SellingPrice · '+refs.join(' | '));
}

function bookDay(raw){
  const m=/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|$)/.exec(String(raw??''));
  return m?sptDay(m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')):'';
}

function recentDeposits(pkg) {
  const owner=normalizeId(pkg.manifest.wp?.npwp),end=sptDay(pkg.manifest.dibuat);
  const ledger=pkg.entries.filter(e=>/^bukubesar\/\d{4}-(?:0[1-9]|1[0-2]|setahun)\.json$/.test(e.path));
  const ref='Buku besar bulanan dan tahunan yang tersedia · Payment aktif · PostingDate · Amount';
  if(!owner||/^0+$/.test(owner)||pkg.report?.valid===false||!end||!ledger.length)return measure(null,ref);
  const cutoff=new Date(end+'T00:00:00Z');
  const day=cutoff.getUTCDate();cutoff.setUTCDate(1);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);
  const lastDay=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day,lastDay));
  const begin=cutoff.toISOString().slice(0,10),basis=ref+' · sesudah '+begin+' sampai '+end+' · '+ledger.length+' berkas';
  const failed=new Set((pkg.manifest.gagal||[]).map(f=>String(f?.path??f).replace(/^data\//,'')).filter(p=>p.startsWith('bukubesar/')));
  const seen=new Map(),paths=new Set(),aggregates=new Set();
  let relevantSource=false,completeFiles=0;
  for(const e of ledger){
    const [,year,month]=/^bukubesar\/(\d{4})-(.+)\.json$/.exec(e.path);
    const code=(month==='setahun'?'0112':month+month)+year;
    if(paths.has(e.path))return measure(null,basis+' · Berkas periode yang sama muncul dua kali.');
    paths.add(e.path);
    if(failed.has(e.path))continue;
    const evidence=ledgerRowsEvidence(pkg,e,owner,year,month==='setahun'?null:month,code);
    if(!evidence||usesOtherCurrency(e.cap,e.cap.konteks,...evidence.pages))
      return measure(null,basis+' · Identitas, cakupan, mata uang, atau isi sumber belum dapat diverifikasi.');
    const first=year+'-'+(month==='setahun'?'01':month),last=year+'-'+(month==='setahun'?'12':month);
    if(first<=end.slice(0,7)&&last>=begin.slice(0,7))relevantSource=true;
    const aggregate=e.cap.payload?.TaxpayerAggregateIdentifier;
    if(aggregate)aggregates.add(aggregate);
    const fileIds=new Set();
    let overlaps=false;
    for(const r of rowsOf(e)){
      if(!r||typeof r!=='object'||[r.TaxpayerTIN,r.TaxpayerTin,r.TIN,r.NPWP].filter(present).some(id=>normalizeId(id)!==owner))
        return measure(null,basis+' · Identitas pada baris buku besar belum dapat dipasangkan.');
      if(r.TaxpayerAggregateIdentifier)aggregates.add(r.TaxpayerAggregateIdentifier);
      if(r.RecordId){if(fileIds.has(r.RecordId))overlaps=true;fileIds.add(r.RecordId);}
      if(!r.AccountingTypeCode&&r.IsCancelled!==true)return measure(null,basis);
      if(r.AccountingTypeCode!=='Payment')continue;
      const v=amount(r.Amount),date=bookDay(r.PostingDate);
      if(typeof r.IsCancelled!=='boolean'||!date||!r.RecordId||!Number.isSafeInteger(v)||v<0||usesOtherCurrency(r))
        return measure(null,basis+' · Tanggal, nomor transaksi, status aktif, atau nilai pembayaran belum dapat diverifikasi.');
      const period=String(r.PeriodCode??'');
      if(!/^(?:0[1-9]|1[0-2])(?:0[1-9]|1[0-2])\d{4}$/.test(period)||period.slice(-4)!==year||month!=='setahun'&&period!==code)return measure(null,basis);
      const previous=seen.get(r.RecordId);
      if(previous&&(previous.date!==date||previous.v!==v||previous.cancelled!==r.IsCancelled||previous.period!==period))return measure(null,basis+' · Nomor transaksi yang sama memiliki rincian berbeda.');
      seen.set(r.RecordId,{date,v,cancelled:r.IsCancelled,period});
    }
    const filtered=e.cap.halamanSumber?.some(h=>{
      const s=h?.pemilihanBukuBesar;
      return s&&(s.filterLainPadaSumber!==false||s.konflikStatus>0||!['aktif','tanpa-filter-pembatalan'].includes(s.filterPembatalanSumber));
    });
    if(!filtered&&!overlaps&&ledgerPageCountProven(e,evidence.size))completeFiles++;
  }
  const inWindow=[...seen.values()].filter(r=>!r.cancelled&&r.date>begin&&r.date<=end);
  const total=inWindow.reduce((s,r)=>s+r.v,0);
  const checked=basis+' · '+completeFiles+'/'+ledger.length+' berkas dengan seluruh baris terverifikasi · '+inWindow.length+' transaksi pembayaran unik'+(failed.size?' · '+failed.size+' berkas gagal':'');
  if((!relevantSource&&!inWindow.length)||aggregates.size>1||!Number.isSafeInteger(total))return measure(null,checked);
  if(completeFiles===ledger.length&&!failed.size)return measure(total,checked);
  return {...measure(null,checked+' · Kelengkapan halaman atau cakupan baris belum terbukti.'),
    ...(inWindow.length&&{observed:measure(total,checked+' · Hanya transaksi aktif yang tersimpan dan dapat dipasangkan.')})};
}

const comparison=[
  ['sales','Peredaran usaha'],['cogs','Harga pokok penjualan'],['gross','Laba kotor'],['expenses','Beban usaha'],
  ['profit','Laba sebelum pajak'],['fiscal','Penghasilan neto fiskal'],['tax','PPh Badan terutang'],
  ['supply','Penyerahan PPN'],['vat','PPN kurang atau lebih bayar'],['salaries','Penghasilan bruto PPh 21'],
  ['people','Penerima penghasilan PPh 21 (orang)']];
const mainRatios=['gpm','npm','cttor','expenses','der','dso','dio','turnover'];
const supplementary=[
  ['fiscalChange','Selisih neto fiskal terhadap laba komersial','%','fiscalDiff','profit'],['quick','Rasio cepat','kali','quickAssets','currentDebt'],
  ['cashRatio','Rasio kas','kali','cash','currentDebt'],['dar','Utang terhadap aset','%','debt','assets'],
  ['turnover','Perputaran aset','kali','sales','assets'],['dpo','Umur utang usaha','hari','payables','purchases']];
const costRatios=[
  ['5311','Gaji dan tunjangan'],['5314','Penyusutan dan amortisasi'],['5316','Bunga'],
  ['5320+5321','Promosi dan jamuan'],['5315','Sewa'],['5317+5319','Jasa dan royalti'],
  ['4600','Penghasilan di luar usaha'],['5500','Beban di luar usaha']];
const names={fiscalDiff:'Selisih neto fiskal dan laba komersial',quickAssets:'Aset lancar dikurangi persediaan',cash:'Kas',payables:'Utang usaha',purchases:'Pembelian',
  net:'Laba setelah PPh',sales:'Penjualan',profit:'Laba sebelum pajak',tax:'PPh terutang',gross:'Laba kotor',operating:'Laba usaha',expenses:'Beban usaha',assets:'Total aset',
  equity:'Ekuitas',debt:'Total liabilitas',currentAssets:'Aset lancar',currentDebt:'Utang lancar',inventory:'Persediaan',cogs:'HPP',receivables:'Piutang usaha'};

function prepareRatios(s){
  const v=s.values,out=new Map();
  v.quickAssets=measure(difference(v.currentAssets.value,v.inventory.value),'Aset lancar − persediaan');
  v.fiscalDiff=measure(difference(v.fiscal.value,v.profit.value),'Neto fiskal − laba sebelum pajak');
  function append(key,label,unit,value,formula,source){out.set(key,{key,label,unit,value,formula,source});}
  for(const [key,label,unit,n,d] of [...measures,...supplementary]){
    const scale=unit==='%'?100:unit==='hari'?365:1;
    const value=Object.hasOwn(s.ratios,key)?s.ratios[key]:ratio(v[n].value,v[d].value,scale);
    append(key,label,unit,value,names[n]+' ÷ '+names[d]+(scale===1?'':' × '+scale),v[n].source+' / '+v[d].source);
  }
  append('derDeclared','DER menurut SPT L11B','kali',v.derDeclared.value,'Rasio yang dicantumkan WP di L11B',v.derDeclared.source);
  const cycle=sum([out.get('dso').value,out.get('dio').value,Number.isFinite(out.get('dpo').value)?-out.get('dpo').value:null]);
  append('cycle','Siklus kas','hari',cycle,'Umur piutang + umur persediaan − umur utang',s.corporate?.path||'Induk L1');
  for(const [codes,label] of costRatios){
    const m=s.account(...codes.split('+'));
    append(codes,label+' terhadap penjualan','%',v.sales.value>0?ratio(m.value,v.sales.value,100):null,'Akun tercantum '+codes+' ÷ penjualan × 100',m.source+' / '+v.sales.source);
  }
  return out;
}

export function kkaFigures(pkg,year,{principal=null}={}) {
  pkg={...pkg,manifest:pkg?.manifest||{},entries:pkg?.entries||[],forms:pkg?.forms||[]};
  const y=String(year),previous=String(Number(y)-1);
  const older=annualSource(pkg,previous),current=annualSource(pkg,y);
  const last=monthlyFigures(pkg,previous),thisYear=monthlyFigures(pkg,y);
  const old={...older.values,...last},now={...current.values,...thisYear};
  const comparisons=older.hasPersonal||current.hasPersonal?[
    ...(older.corporate||current.corporate?comparison.slice(0,7):[]),
    ...Object.entries(periodFields.OP).map(([label,key])=>{
      old[key]=older.op?measure(older.op.body[key],older.op.path+' · '+key):missing;
      now[key]=current.op?measure(current.op.body[key],current.op.path+' · '+key):missing;
      return [key,label+' (SPT OP)'];
    }),...comparison.slice(7)]:comparison;
  const fmtRef=(a,b)=>previous+' · '+a+' | '+y+' · '+b;
  const table1={key:'4.1',title:'Tabel 4.1. Perbandingan SPT dua tahun',rows:[['Uraian',previous,y,'Selisih','Perubahan (%)','Sumber'],
    ...comparisons.map(([key,label])=>{
      const a=old[key],b=now[key],change=difference(b.value,a.value);
      return [label,a.value,b.value,change,ratio(change,Math.abs(a.value??0),100),fmtRef(a.source,b.source)];
    })]};
  for(const [key,label] of [['salaries','Subtotal bruto PPh 21 pada masa yang terbaca'],['people','Penerima unik PPh 21 pada masa yang terbaca (orang)']]){
    const a=old[key].observed,b=now[key].observed;
    if(a||b)table1.rows.push([label,a?.value??null,b?.value??null,null,null,
      [a&&previous+' · '+a.source,b&&y+' · '+b.source].filter(Boolean).join(' | ')]);
  }
  const ratOld=prepareRatios(older),ratNow=prepareRatios(current);
  const table2={key:'4.2',title:'Tabel 4.2. Rasio keuangan',rows:[['Rasio','Satuan',previous,y,'Perhitungan','Sumber'],
    ...mainRatios.map(k=>{const m=ratNow.get(k),a=ratOld.get(k);return [m.label,m.unit,a.value,m.value,m.formula,fmtRef(a.source,m.source)];})]};
  const cf=[['Laba sebelum pajak',now.profit],['PPh terutang (pengurang)',measure(difference(0,now.tax.value),now.tax.source)],
    ['Penyusutan dan amortisasi',now.depreciation],...[
      ['Perubahan piutang usaha','receivables',-1],['Perubahan persediaan','inventory',-1],['Perubahan utang usaha','payables',1]
    ].map(([label,key,sign])=>{const d=difference(now[key].value,old[key].value);return [label,measure(d===null?null:d*sign,fmtRef(old[key].source,now[key].source))];})];
  const cashflow=measure(sum(cf.map(([,m])=>m.value)),'L-13 · jumlah enam komponen arus kas operasi');
  const capital=measure(difference(now.currentAssets.value,now.currentDebt.value),'L-13 · aset lancar dikurangi utang lancar');
  const denominator=measure(Number.isFinite(principal)&&principal>=0?principal:null,'Tabel 5 · pokok dalam lingkup temuan yang dipilih');
  const deposits=recentDeposits(pkg);
  const ability=[
    ['Potensi pokok pajak',denominator],['Kas dan setara kas',now.cash],['Aset lancar',now.currentAssets],['Utang lancar',now.currentDebt],
    ['Modal kerja',capital],['Perkiraan arus kas operasi',cashflow],['Aset tidak lancar',now.fixed],
    ['Pembayaran tercatat dalam 12 bulan sampai tanggal paket',deposits],['Penyerahan pada tiga masa PPN terakhir dalam paket',recentDeliveries(pkg)],
    ...[['Kas',now.cash],['Modal kerja',capital],['Perkiraan arus kas operasi',cashflow]].map(([label,m])=>[label+' terhadap potensi pokok',
      measure(ratio(m.value,denominator.value),m.source+' / '+denominator.source),'kali']),
    ...(deposits.observed?[['Subtotal pembayaran teramati dalam 12 bulan',deposits.observed]]:[])];
  const table3={key:'5.3',title:'Tabel 5.3. Kemampuan membayar',rows:[['Uraian','Nilai','Satuan','Sumber'],...ability.map(([label,m,unit])=>[label,m.value,unit||'Rp',m.source])]};
  const notes=[...older.notes,...current.notes,'Agregat SPT setahun memerlukan angka pada 12 masa. Penyerahan tiga masa mengikuti bulan terakhir yang tercantum dalam paket dan dua bulan sebelumnya. Setiap masa memakai versi terakhir yang dapat diverifikasi.',
    'Pembayaran selama 12 bulan dihitung sampai tanggal pembuatan paket, dari transaksi aktif pada buku besar yang tersedia, termasuk buku tahunan. Nomor transaksi yang sama dihitung sekali. Cakupan pembayaran di luar paket perlu dikonfirmasi.',
    ...(deposits.observed?['Subtotal pembayaran teramati hanya mencakup transaksi yang dapat ditelusuri. Total pembayaran pada periode tersebut masih menunggu bukti kelengkapan sumber.']:[]),
    'Perkiraan arus kas memakai perubahan saldo antara dua neraca. Cakupan terhadap potensi memerlukan pokok yang terisi dan lebih besar dari nol.'];
  if(!current.corporate)notes.push('Rasio Badan dan arus kas operasi memerlukan laporan keuangan Badan yang dapat diverifikasi.');
  const sheet={name:'L-13',rows:[[table1.title],...table1.rows,[],[table2.title],...table2.rows,[],
    ['Rincian rasio tahun '+y],['Ukuran','Satuan','Nilai','Rumus atau isian','Sumber'],
    ...[...ratNow.values()].filter(m=>Number.isFinite(m.value)).map(m=>[m.label,m.unit,m.value,m.formula,m.source]),[],
    ['Perkiraan arus kas operasi'],['Komponen','Nilai (Rp)','Sumber'],...cf.map(([label,m])=>[label,m.value,m.source]),
    ['Perkiraan arus kas operasi',cashflow.value,cashflow.source],[],[table3.title],...table3.rows,[],['Catatan'],...notes.map(n=>[n])]};
  return {tables:[table1,table2,table3],sheet,notes};
}
