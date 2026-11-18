import {rowsOf} from './model.js';
import {annualBusinessCodes} from './profile.js';
import {checkedCompanyEntry} from './kkp-company-annexes.js';

export function taxpayerId(pkg) {
  const raw=String(pkg.manifest.wp?.npwp??'').replace(/[.\s-]/g,'');
  return /^\d{15,16}$/.test(raw)&&!/^0+$/.test(raw)?raw.padStart(16,'0'):'';
}

const plainNumber=value=>{
  if(typeof value==='string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))value=Number(value);
  return typeof value==='number' && Number.isFinite(value)?value:null;
};

function businessCode(pkg,year) {
  const entries=pkg.entries.filter(e=>e.path==='profil/klu.json'||e.cap?.sumber==='klu');
  const history=entries.flatMap(e=>rowsOf(e).map(r=>({...r,'Berkas sumber':e.path})));
  const inYear=annualBusinessCodes(history,[year],'');
  const codes=[...new Set(inYear.map(r=>String(r.KLU).trim()))];
  if(codes.length===1)return {code:codes[0],basis:'Registrasi tahun '+year,path:inYear[0]['Berkas sumber']};
  if(codes.length>1)return {code:'',basis:'Beberapa KLU utama dalam tahun ini'};
  if(history.some(r=>r.IsMainEconomicCode===true && r.ValidFrom))return {code:'',basis:'KLU tidak tercatat untuk tahun ini'};
  const info=pkg.entries.filter(e=>e.path==='profil/informasi-umum.json'||e.cap?.sumber==='info');
  const current=info.flatMap(e=>rowsOf(e).map(r=>({code:String(r.MainEconomicCode?.TradeClassificationCode??'').trim(),path:e.path}))).filter(r=>r.code);
  if(new Set(current.map(r=>r.code)).size===1)return {...current[0],basis:'KLU utama pada profil di paket'};
  return {code:'',basis:'KLU utama belum dapat ditentukan'};
}

// A ratio uses amounts from a single corporate return and its own L1 statement.
export const measures=[
  ['gpm','Margin laba kotor (GPM)','%', 'gross','sales'],
  ['opm','Margin laba usaha (OPM)','%', 'operating','sales'],
  ['ppm','Margin laba sebelum pajak (PPM)','%', 'profit','sales'],
  ['npm','Margin laba setelah PPh (NPM)','%', 'net','sales'],
  ['cttor','PPh terutang terhadap penjualan (CTTOR)','%', 'tax','sales'],
  ['etr','Tarif pajak efektif (ETR)','%', 'tax','profit'],
  ['expenses','Beban usaha terhadap penjualan','%', 'expenses','sales'],
  ['roa','Imbal hasil aset (ROA)','%', 'profit','assets'],
  ['roe','Imbal hasil ekuitas (ROE)','%', 'profit','equity'],
  ['der','Utang terhadap ekuitas (DER)','kali','debt','equity'],
  ['current','Rasio lancar','kali','currentAssets','currentDebt'],
  ['dio','Perputaran persediaan','hari','inventory','cogs'],
  ['dso','Umur piutang usaha','hari','receivables','sales']
];
export const fiscalMeasures=['cttor','npm','ppm','gpm','opm','etr'].map(code=>measures.find(m=>m[0]===code));

export function annualRatios(pkg,year) {
  const versions=pkg.forms.filter(f=>f.type==='BADAN'&&f.period===year);
  const last=Math.max(...versions.map(f=>f.version));
  const latest=versions.filter(f=>f.version===last);
  const form=latest.length===1?latest[0]:null,entry=form?.parts.get('induk');
  // Older packages can provide traceable dashboard amounts without an owner for comparisons.
  const source=form?checkedCompanyEntry(pkg,form,'induk',{requireOwner:false}):null;
  const verified=Boolean(source&&taxpayerId(pkg));
  const rows=rowsOf(source),body=rows.length===1?rows[0]:{};
  const variants=Object.keys(body).filter(k=>/^L1[a-l]FormData$/.test(k)&&body[k]&&typeof body[k]==='object');
  const variant=variants.length===1?variants[0].slice(0,3):null;
  const table=variant?body[variant+'FormData']:{};
  const prefix=variant?variant+'FormData.'+variant:'';
  const accounts=new Map();
  function collect(nodes) {
    if(!Array.isArray(nodes))return;
    for(const node of nodes){
      if(!node||typeof node!=='object')continue;
      const data=node.Data??node.data??node;
      if(data.AccountCode!=null){
        const code=String(data.AccountCode);
        accounts.set(code,accounts.has(code)?null:plainNumber(data.Amount));
      }
      collect(node.Children??node.children);
    }
  }
  collect(table[variant+'TreeData']);
  const values={};
  function assign(key,name,amount,field) {values[key]={name,value:plainNumber(amount),field};}
  for(const [key,name,code] of [
    ['sales','Penjualan bersih','4020'],['gross','Laba kotor','4300'],['operating','Laba usaha','4500'],
    ['expenses','Beban usaha','5400'],['cogs','Harga pokok penjualan','5020']
  ])assign(key,name,accounts.get(code),variant?prefix+'TreeData · akun '+code+' · Amount':'');
  assign('profit','Laba sebelum pajak',table[variant+'TreeTotalRow']?.Amount,variant?prefix+'TreeTotalRow.Amount':'');
  assign('tax','PPh Badan terutang',body.MainFormData?.IncomeTaxInAYear,'MainFormData.IncomeTaxInAYear');
  const {profit,tax}=values;
  assign('net','Laba sebelum pajak dikurangi PPh terutang',profit.value!==null&&tax.value!==null?profit.value-tax.value:null,
    profit.field?profit.field+' − '+tax.field:'');
  const balance=side=>table[variant+side]||{};
  const assets=balance('Assets'),liabilities=balance('LiabilitiesAndEquity');
  for(const [key,name,side,code] of [
    ['currentAssets','Aset lancar','Assets','AC1500'],['inventory','Persediaan','Assets','AC1401'],
    ['assets','Jumlah aset','Assets','AC1700'],['debt','Jumlah liabilitas','LiabilitiesAndEquity','AC2999'],
    ['currentDebt','Liabilitas jangka pendek','LiabilitiesAndEquity','AC2229']
  ])assign(key,name,balance(side)[code],variant?prefix+side+'.'+code:'');
  const equityCode=plainNumber(liabilities.AC3299)===null?'AC3229':'AC3299';
  assign('equity','Ekuitas',liabilities[equityCode],variant?prefix+'LiabilitiesAndEquity.'+equityCode:'');
  const receivableCodes=['AC1122','AC1123'].filter(k=>Object.hasOwn(assets,k));
  const amounts=receivableCodes.map(k=>plainNumber(assets[k]));
  assign('receivables','Piutang usaha pada akun yang tersedia',amounts.length && amounts.every(v=>v!==null)?amounts.reduce((a,b)=>a+b,0):null,
    receivableCodes.map(k=>prefix+'Assets.'+k).join(' + '));
  const ratios={};
  for(const [key,,unit,n,d] of measures){
    const a=values[n].value,b=values[d].value,scale=unit==='hari'?365:unit==='%'?100:1;
    const validBase=(d==='sales'||key==='etr')?b>0:b!==0;
    ratios[key]=verified && a!==null && b!==null && validBase ? plainNumber(a/b*scale) : null;
  }
  let condition='Induk dan L1 tersedia';
  if(!versions.length)condition='SPT Badan tahun ini belum tersedia';
  else if(!form)condition='Terdapat beberapa rekaman dengan nomor pembetulan terakhir yang sama';
  else if(entry?.cap?.lengkap===false)condition='Induk ditandai belum lengkap';
  else if(entry&&!verified)condition='Identitas, integritas atau kelengkapan induk belum terkonfirmasi';
  else if(rows.length!==1)condition='Induk tunggal belum tersedia';
  else if(!variant)condition='Varian L1 tunggal belum tersedia';
  return {pkg,form,ratios,values,condition,complete:Boolean(verified&&rows.length===1&&variant),klu:businessCode(pkg,year),year};
}

export function peerBenchmark(active,packages,year,selections=new Map()) {
  const id=taxpayerId(active),alternatives=new Map();
  for(const pkg of packages){
    const other=taxpayerId(pkg);
    if(!other || other===id)continue;
    if(!alternatives.has(other))alternatives.set(other,[]);
    alternatives.get(other).push(pkg);
  }
  const current=annualRatios(active,year),others=[];
  for(const [other,files] of alternatives){
    const chosen=files.length===1?files[0]:files.find(p=>p.fileKey===selections.get(other));
    if(chosen)others.push(annualRatios(chosen,year));
  }
  const same=others.filter(row=>current.klu.code && current.klu.code===row.klu.code);
  const sameSector=same.length>=2, members=sameSector?same:others;
  const rows=[];
  if(id && members.length>=2)for(const [key,label,unit] of measures){
    const sorted=members.map(r=>r.ratios[key]).filter(Number.isFinite).sort((a,b)=>a-b);
    const n=sorted.length,mid=Math.floor(n/2);
    const median=n?(n%2?sorted[mid]:sorted[mid-1]/2+sorted[mid]/2):null;
    const value=current.ratios[key];
    const delta=median!==null && median!==0 && value!==null?plainNumber((value-median)/Math.abs(median)*100):null;
    rows.push({Ukuran:label,Satuan:unit,'WP aktif':value,'Median kelompok':median,Minimum:sorted[0]??null,
      Maksimum:sorted.at(-1)??null,'WP dengan nilai':n,'Deviasi (%)':delta,'Tinjauan':Math.abs(delta)>50?'Deviasi melampaui 50%':''});
  }
  return {alternatives,current,members,sameSector,rows};
}

export function ratioEvidence(result,metric) {
  const [key,label,unit,n,d]=metric;
  return {WP:result.pkg.manifest.wp?.nama,NPWP:result.pkg.manifest.wp?.npwp,Tahun:result.year,
    Ukuran:label,Nilai:result.ratios[key],Satuan:unit,Pembilang:result.values[n].name,'Nilai pembilang':result.values[n].value,
    'Isian pembilang':result.values[n].field,Penyebut:result.values[d].name,'Nilai penyebut':result.values[d].value,
    'Isian penyebut':result.values[d].field,Pengali:unit==='hari'?365:unit==='%'?100:1,
    Versi:result.form?result.form.version===0?'Normal':'Pembetulan '+result.form.version:null,
    'Berkas induk':result.form?.parts.get('induk')?.path,Paket:result.pkg.fileName,KLU:result.klu.code,
    'Dasar KLU':result.klu.basis,'Berkas KLU':result.klu.path,'Kondisi sumber':result.condition,
    'Integritas paket':result.pkg.report.valid?'Konsisten':'Ada peringatan'};
}
