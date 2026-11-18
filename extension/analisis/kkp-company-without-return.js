import {normalizeId} from '../app-data.js';
import {listRowType} from '../app-package-entries.js';
import {rowsOf} from './model.js';
import {sourceAmount} from './withholding-forms.js';
import {signedSumCell} from '../archive/table.js';

const subjects=[
  ['sales','Peredaran usaha'],['cost','Harga pokok penjualan'],['expenses','Beban usaha'],
  ['net','Penghasilan neto'],['taxable','Penghasilan kena pajak'],['tax','PPh terutang'],
  ['credit','Kredit pajak'],['balance','PPh kurang/(lebih) bayar']
];
const none=()=>({groups:[],warnings:[]});
const warn=reason=>({groups:[],warnings:['KKP B tanpa SPT Tahunan Badan belum dapat dibuka. '+reason]});
const known=value=>value!==undefined&&value!==null&&value!=='';
const recordKey=value=>typeof value==='string'&&value.trim()?value.trim():'';
const entryOwner=(e,id)=>normalizeId(e.cap?.konteks?.npwp)===id;
const succeeded=e=>e.cap?.lengkap===true&&e.pages?.length&&e.pages.every(p=>p&&p.IsSuccessful!==false&&!p.Errors?.length)&&
  (e.cap.halaman==null||e.cap.halaman===e.pages.length);
const failed=(pkg,e)=>pkg.manifest.gagal?.some(f=>[e.path,'data/'+e.path,e.cap.path,e.cap.sumber].filter(Boolean)
  .some(id=>typeof f==='string'?f===id:[f?.path,f?.endpoint,f?.label,f?.sumber].includes(id)));
const selfFields=['DomesticDeliveriesOtherThanOtherValue','DomesticDeliveriesUsingOtherValue','DomesticDeliveriesToTourist','DomesticDeliveriesSelfCollected'];
const otherFields=['ExportTangibleTaxableGoods','DomesticDeliveriesCollectedByVATCollector','DomesticDeliveriesUncollectedVAT',
  'DomesticDeliveriesExemptedVAT','DeliveriesOfGoodsNoVAT'];

function sixDeliveryGroups(body,path){
  const value=key=>sourceAmount(body[key]?.SellingPrice);
  const inputs=[...selfFields,...otherFields],amounts=inputs.map(value);
  const source=path+' · '+inputs.map(k=>k+'.SellingPrice').join(', ');
  if(amounts.some(v=>v===null))return {amount:null,self:null,source,note:'Sebagian komponen enam kelompok tidak memiliki angka.'};
  const self=amounts.slice(0,selfFields.length).reduce((a,b)=>a+b,0),other=amounts.slice(selfFields.length).reduce((a,b)=>a+b,0);
  if(self!==0)return {amount:self+other,self,source,note:'Memakai jumlah empat komponen penyerahan dipungut sendiri.'};
  const taxable=value('DeliveryOfTaxableGoodsSubjectToVAT'),exports=value('ExportTangibleTaxableGoods');
  if(taxable===null)return {amount:null,self,source,note:'Komponen dipungut sendiri berjumlah nol dan subtotal penyerahan terutang tidak tersedia.'};
  return {amount:other+Math.max(0,taxable-exports),self,source:source+' · DeliveryOfTaxableGoodsSubjectToVAT.SellingPrice',
    note:'Untuk pembanding enam kelompok, subtotal penyerahan terutang dikurangi ekspor (minimum nol) menggantikan jumlah empat komponen yang nol. Periksa kemungkinan tumpang tindih dengan kelompok lainnya.'};
}

function registeredOwner(pkg,id){
  const entries=pkg.entries.filter(e=>e.path==='profil/informasi-umum.json'||e.cap?.sumber==='info');
  if(!entries.length)return null;
  const aggregates=new Set();
  for(const entry of entries){
    if(!succeeded(entry)||failed(pkg,entry)||!entryOwner(entry,id))return null;
    const records=rowsOf(entry);
    if(!records.length)return null;
    for(const body of records){
      const g=body?.GeneralInformation;
      if(g?.TaxpayerType!=='TA002'||normalizeId(g.UniqueIdentificationNumber)!==id||g.TaxpayerCategory==='I_IN'||!recordKey(g.AggregateIdentifier))return null;
      aggregates.add(g.AggregateIdentifier);
    }
  }
  return aggregates.size===1?{aggregate:[...aggregates][0],paths:entries.map(e=>e.path)}:null;
}
function indexedPeriod(code){
  const match=/^(\d{2})(\d{2})((?:19|20)\d{2})$/.exec(String(code||''));
  if(!match||+match[1]<1||+match[1]>12||+match[2]<1||+match[2]>12)return null;
  return {year:match[3],month:match[1]===match[2]?match[3]+'-'+match[1]:null};
}
function annualDirectory(pkg,id,owner,year){
  const range=pkg.manifest.opsi?.periode,types=pkg.manifest.opsi?.jenisSpt;
  const point=p=>Number.isSafeInteger(p?.y)&&Number.isSafeInteger(p.m)&&p.m>=1&&p.m<=12?p.y*100+p.m:NaN;
  if(!(point(range?.from)<=Number(year)*100+1&&point(range?.to)>=Number(year)*100+12)||
    Array.isArray(types)&&!types.includes('ICT_RCITR'))return null;
  const lists=pkg.entries.filter(e=>e.path==='spt/daftar.json'||e.cap?.sumber==='sptdaftar');
  // Independent snapshots of the directory could reflect different filing dates.
  if(lists.length!==1)return null;
  const e=lists[0],q=e.cap.payload||{},rows=rowsOf(e);
  if(!succeeded(e)||failed(pkg,e)||!entryOwner(e,id)||q.TaxpayerAggregateIdentifier!==owner.aggregate||
     q.First!==0||!Array.isArray(q.Filters)||q.Filters.length||q.isArchieved!==false||
     e.cap.halamanSumber?.some(s=>s?.pencocokan?.morePagesAvailable))return null;
  if(!e.pages.every(p=>Array.isArray(p.Payload?.Data)))return null;
  const totals=[e.cap.total,...e.pages.map(p=>p.Payload.TotalRecords)].filter(known);
  if(!totals.length||totals.some(n=>n!==rows.length)||known(e.cap.baris)&&e.cap.baris!==rows.length)return null;
  if(e.cap.total==null&&q.Rows===rows.length&&rows.length&&e.pages.at(-1).Payload.Data.length)return null;
  const ids=new Set(),vat=new Map();
  for(const r of rows){
    if(!recordKey(r.RecordId)||ids.has(r.RecordId)||r.TaxpayerAggregateIdentifier!==owner.aggregate||
      [r.TaxpayerTin,r.TaxIdentificationNumber,r.NPWP].filter(known).some(v=>normalizeId(v)!==id))return null;
    ids.add(r.RecordId);
    const type=listRowType(r);
    if(!type){
      // The native SPOP type is a property-tax filing, independently identified by its tax type.
      if(r.ReturnSheetTypeCode!=='LBT_LBTR'||r.TaxTypeCode!=='LBT_LBT'||known(r.TaxReturnTypeCode))return null;
      continue;
    }
    const period=indexedPeriod(r.TaxPeriodCode);
    if(type==='ICT_PITR'||!period||type==='ICT_RCITR'&&period.year===year)return null;
    if(type!=='VAT_VATR'||period.year!==year)continue;
    const raw=String(r.ReturnSheetModel??'').trim(),rev=/^normal$/i.test(raw)?0:
      /^(?:(?:amendment|pembetulan)\s*(?:ke[- ]?)?)?(\d+)$/i.exec(raw)?.[1];
    if(!period.month||rev===undefined)return null;
    const choices=vat.get(period.month)||[];
    choices.push({id:r.RecordId,version:Number(rev)});vat.set(period.month,choices);
  }
  return {path:e.path,vat};
}
function amountsForYear(pkg,year,directory,checked){
  const groups=new Map(),details=[],issues=[];
  for(const f of pkg.forms.filter(f=>f.type==='PPN'&&f.year===year)){
    const list=groups.get(f.period)||[];list.push(f);groups.set(f.period,list);
  }
  for(const period of [...new Set([...directory.vat.keys(),...groups.keys()])].sort()){
    const listed=directory.vat.get(period)||[],forms=groups.get(period)||[],max=Math.max(...listed.map(r=>r.version));
    const latest=listed.filter(r=>r.version===max),versions=forms.filter(f=>f.version===max);
    const f=latest.length===1&&versions.length===1&&versions[0].id===latest[0].id?versions[0]:null;
    if(!f||forms.some(f=>!listed.some(r=>f.id===r.id&&f.version===r.version))) {
      issues.push('Daftar dan detail SPT Masa PPN belum cocok untuk '+period+'.');continue;
    }
    const e=checked(pkg,f,'induk'),rs=rowsOf(e),body=rs.length===1?rs[0]:null;
    const value=sourceAmount(body?.TotalDeliveryOfGoodsAndServices?.SellingPrice);
    if(!e||!entryOwner(e,normalizeId(pkg.manifest.wp.npwp))||value===null){
      issues.push('Jumlah penyerahan pada induk SPT Masa PPN '+period+' belum terkonfirmasi.');continue;
    }
    const raw=[body.CurrencyCode,body.MainFormData?.CurrencyCode,f.meta?.CurrencyCode].filter(known).map(v=>String(v).trim().toUpperCase());
    if(raw.length&&(new Set(raw).size!==1||!/^[A-Z]{3}$/.test(raw[0]))){issues.push('Kode mata uang pada '+period+' belum dapat dicocokkan.');continue;}
    const breakdown=sixDeliveryGroups(body,e.path);
    details.push({Masa:period,Pembetulan:f.version,Penyerahan:value,'Mata uang':raw[0]||'Belum dinyatakan',
      'Dipungut sendiri menurut empat komponen':breakdown.self,'Pembanding enam kelompok':breakdown.amount,
      'Selisih enam kelompok terhadap induk':breakdown.amount===null?null:breakdown.amount-value,
      Sumber:e.path+' · TotalDeliveryOfGoodsAndServices.SellingPrice','Sumber enam kelompok':breakdown.source,Keterangan:breakdown.note});
  }
  if(new Set(details.map(r=>r['Mata uang'])).size>1)issues.push('Satuan mata uang antar-SPT Masa PPN belum sesuai.');
  const periods=details.map(r=>r.Masa);
  const observed=details.length&&!issues.length?{amount:details.reduce((n,r)=>n+r.Penyerahan,0),periods,source:details.map(r=>r.Sumber).join('\n')}:null;
  return {details,issues,observed};
}
export function companyWithoutReturn(pkg,year,checked){
  const id=normalizeId(pkg.manifest?.wp?.npwp),noneFound=none();
  if(!id||/^0+$/.test(id)||pkg.report?.valid!==true||pkg.forms.some(f=>f.type==='OP'||f.type==='BADAN'&&f.year===year))return noneFound;
  const owner=registeredOwner(pkg,id);if(!owner)return noneFound;
  const directory=annualDirectory(pkg,id,owner,year);
  if(!directory)return warn('Periksa identitas, periode dan kelengkapan daftar SPT dilaporkan.');
  const {details,issues,observed}=amountsForYear(pkg,year,directory,checked);
  if(!details.length)return issues.length?warn(issues.join(' ')):noneFound;
  const n=details.length,profile=owner.paths.join('\n'),source=profile+'\n'+directory.path;
  const explanation='Daftar SPT dilaporkan dalam paket tidak memuat SPT Tahunan Badan '+year+'. Nol adalah pembanding KKP. Status pelaporan di luar paket belum diperiksa.';
  const coverage=[...issues,n+' dari 12 masa memiliki nilai penyerahan dari induk SPT Masa PPN versi terakhir.'];
  const groupKey='BADAN/B';
  const lines=subjects.map(([code,topic])=>{
    const sales=code==='sales',detail=sales?details:[];
    return {id:'tanpa-spt-badan/'+id+'/'+year+'/'+code,groupKey,ref:'B',tax:'PPh Badan',period:year,version:null,topic,
      withoutReturn:true,amount:0,source:sales?source+'\n'+details.map(r=>r.Sumber).join('\n'):source,
      prefill:sales&&observed?.periods.length===12?observed.amount:null,observedPrefill:sales?observed:null,
      prefillLabel:'Nilai awal dari SPT Masa PPN',sourceTitle:'Sumber daftar dan SPT Masa PPN',detailTitle:'Rincian SPT Masa PPN',
      partial:sales?n<12||issues.length>0:true,coverage:sales?coverage:['Perlu pengujian dokumen untuk pos ini.'],
      explanation:explanation+(sales?' Penyerahan PPN adalah pembanding awal untuk menguji peredaran usaha.':''),details:detail};
  });
  const six=observed&&details.every(r=>r['Pembanding enam kelompok']!==null)?details.reduce((sum,r)=>sum+r['Pembanding enam kelompok'],0):null;
  const scope=details.map(r=>r.Masa).join(', '),sixSource=details.map(r=>r['Sumber enam kelompok']).join('\n');
  const support=[{Uraian:'Subtotal penyerahan menurut induk SPT Masa PPN',Nilai:observed?.amount??null,Masa:scope,
    Sumber:details.map(r=>r.Sumber).join('\n'),Keterangan:coverage.join(' ')},
    {Uraian:'Subtotal pembanding enam kelompok penyerahan',Nilai:six,Masa:scope,Sumber:sixSource,
      Keterangan:'Ekspor, dipungut sendiri, dipungut pemungut, tidak dipungut, dibebaskan, dan tidak terutang. Lihat dasar dipungut sendiri untuk setiap masa.'},
    {Uraian:'Selisih enam kelompok terhadap jumlah penyerahan induk',Nilai:six===null?null:six-observed.amount,Masa:scope,
      Sumber:'Subtotal enam kelompok dikurangi subtotal menurut induk.',Keterangan:'Bahan rekonsiliasi cakupan penyerahan.'}];
  return {groups:[{key:groupKey,ref:'B',title:'Induk PPh Badan (tanpa SPT dalam paket)',tax:'PPh Badan',
    provisionalCompany:true,lines,support}],warnings:issues};
}

const derived=[
  {title:'Penghasilan neto berdasarkan hasil uji',terms:[['sales',1],['cost',-1],['expenses',-1]]},
  {title:'PPh kurang/(lebih) bayar berdasarkan hasil uji',terms:[['tax',1],['credit',-1]]}
];
// An annual corporate return is unavailable. Monthly VAT records cannot determine the currency for a taxable-profit rounding rule.
export function companyProvisionalSupport(group,reviewed,excel=false){
  if(!group.provisionalCompany)return group.support;
  const output=[...group.support];
  for(const {title,terms} of derived){
    const inputs=terms.map(([code,sign])=>{
      const i=group.lines.findIndex(l=>l.id.endsWith('/'+code)),line=group.lines[i];
      return {sign,row:7+i,line,amount:reviewed?.get(line.id)?.menurutPetugas};
    });
    const complete=inputs.every(i=>Number.isFinite(i.amount));
    const result=complete?inputs.reduce((sum,i)=>sum+i.sign*i.amount,0):null;
    output.push({Uraian:title,Nilai:excel?signedSumCell(inputs,5,result):result,Masa:group.lines[0].period,
      Sumber:inputs.map(i=>(i.sign===1?'+ ':'− ')+i.line.topic).join(' '),Keterangan:complete?'Dihitung dari nilai yang telah diuji.':'Menunggu nilai hasil uji untuk setiap komponen.'});
  }
  output.push({Uraian:'Penghasilan kena pajak',Nilai:null,Masa:group.lines[0].period,Sumber:'Hasil uji penghasilan neto dan dasar penghitungan PKP.',
    Keterangan:'Mata uang pembukuan dan dasar penghitungan tahunan perlu diperiksa sebelum pembulatan PKP.'});
  return output;
}
