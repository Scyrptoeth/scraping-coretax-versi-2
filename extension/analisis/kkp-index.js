import {differenceCell,numericReference,sheetLink} from '../archive/table.js';
import {probisRequestKey,probisSourceFields,validatedProbisSource} from '../probis-guide.js';
import {compare, rowsOf, typeNames, worksheet} from './model.js';
import {filingAndPaymentRows} from './formal-compliance.js';
import {businessSheets} from './business-work.js';
import {benchmarkSheet} from './benchmark-work.js';
import {companyAnnexIndices} from './kkp-company-annexes.js';
import {simulationTables} from './sanksi.js';
import {rateSourceLabel} from './rate-updates.js';
import {withoutReturnIndices} from './kkp-without-return.js';
import {workAuditRows} from './team-work.js';
import {findingKey,findingRows,findingsFor} from './findings.js';
import {normalizeId} from '../app-data.js';
import {listRowType} from '../app-package-entries.js';
import {projectWithholdingTax} from './kkp-withholding-tax.js';
import {sourceAmount} from './withholding-forms.js';
import {companySupportWorksheet} from './kkp-company-controls.js';

// Each rule names an explicit value on the SPT. Empty or nonnumeric source cells stay empty.
const annualCompany=[
  ['B','Induk PPh Badan','Laba sebelum pajak','MainFormData.NetIncomeBeforeTax'],
  ['B','Induk PPh Badan','Penghasilan neto fiskal','MainFormData.FiscalNetIncomeAfterTax'],
  ['B','Induk PPh Badan','Penghasilan kena pajak','MainFormData.TaxableIncome'],
  ['B','Induk PPh Badan','PPh kurang/(lebih) bayar','MainFormData.UnderpaymentIncomeTax'],
  ['B.10','Kompensasi kerugian','Kompensasi tercantum','MainFormData.TotalCarriedForward'],
  ['B.11','PPh terutang','PPh terutang setahun','MainFormData.IncomeTaxInAYear'],
  ['B.13','Angsuran PPh','Angsuran PPh pada induk','MainFormData.InstallmentOfIncome']
];
const annualIndividual=[
  ['B','Induk PPh OP','Penghasilan neto setahun','AnnualNetIncome'],
  ['B','Induk PPh OP','Penghasilan kena pajak','TaxableIncome'],
  ['B','Induk PPh OP','Kurang atau lebih bayar','UnderOrOverPaymentTax'],
  ['B-7','Penghasilan dari pekerjaan','Neto dari pekerjaan','NetIncomeFromEmployment'],
  ['B-8','Penghasilan lainnya dalam negeri','Penghasilan lainnya dalam negeri','OtherDomesticIncome'],
  ['B-9','Penghasilan luar negeri','Penghasilan luar negeri','OtherForeignIncome'],
  ['B-10','Penghasilan final','Penghasilan final','IncomeFinal'],
  ['B-11','Penghasilan bukan objek','Penghasilan bukan objek','ExcludedIncomeFinal'],
  ['B-15','Penghasilan tidak kena pajak','PTKP pada induk','TaxExemptionAmountValue'],
  ['B-16','PPh terutang','PPh terutang pada induk','IncomeTaxPayable'],
  ['B-17','Kredit pajak','PPh dipotong atau dipungut pihak lain','IncomeTaxWhitheldOtherParty'],
  ['B-17','Kredit pajak','Angsuran PPh','InstallmentOfIncome']
];
const vat=[
  ['N','Induk PPN','Penyerahan barang dan jasa','TotalDeliveryOfGoodsAndServices.SellingPrice'],
  ['N','Induk PPN','Pajak masukan yang dapat diperhitungkan','InputTaxCanBeCalculated.VAT'],
  ['N','Induk PPN','PPN kurang atau lebih bayar','VATUnderOrOverPaid.VAT'],
  ['N.2','Ekspor','Ekspor BKP berwujud','ExportTangibleTaxableGoods.SellingPrice'],
  ['N.3.1','Pajak keluaran','Pajak keluaran yang dipungut sendiri','OutputTaxMustBeSelfCollected.VAT'],
  ['N.5','Penyerahan tidak dipungut','Penyerahan dengan PPN tidak dipungut','DomesticDeliveriesUncollectedVAT.SellingPrice']
];
const withholding=[
  ['C','Induk PPh Pasal 21','PPh Pasal 21 dipotong','A21IncomeTaxWithheld'],
  ['C.2.1','Objek PPh Pasal 21','Penghasilan bruto pada Form 1A','Form1A.GrossIncome']
];
const accounts={
  '4020':['B.1','Peredaran usaha'],'5020':['B.2','Harga pokok penjualan'],'5400':['B.3','Biaya usaha'],
  '4600':['B.4','Penghasilan dari luar usaha'],'5500':['B.5','Biaya dari luar usaha']
};
const formFields={BADAN:annualCompany,OP:annualIndividual,PPN:vat,PPH2126:withholding};
const readValue=(row,path)=>path.split('.').reduce((v,k)=>v?.[k],row);
const pathText=(path,field)=>path+' · '+field;

const salesFields=['DomesticDeliveriesOtherThanOtherValue','DomesticDeliveriesUsingOtherValue','DomesticDeliveriesToTourist','DomesticDeliveriesSelfCollected'];
const taxableSales='DeliveryOfTaxableGoodsSubjectToVAT',exportsSales='ExportTangibleTaxableGoods';
const articleBases=[['E.2.1','22','PPh Pasal 22'],['G.2.1','23','PPh Pasal 23'],['K.2.1','4(2)','PPh Pasal 4 ayat (2)']];
const given=v=>v!==null&&v!==undefined&&v!=='';

function sourceProblem(pkg,form,part,entry){
  if(!entry)return 'Bagian ini belum ada dalam paket.';
  const {cap={},pages=[]}=entry,ctx=cap.konteks||{},spt=ctx.spt||{},query=cap.payload||{};
  const m=form.period.slice(-2),periodCode=m+m+form.year,owner=normalizeId(pkg.manifest.wp?.npwp);
  if(!owner||/^0+$/.test(owner))return 'NPWP paket belum dapat diperiksa.';
  const matches=(values,expected)=>values.filter(given).every(v=>String(v)===String(expected));
  if(!matches([ctx.bagian],part)||!matches([spt.recordId,query.RecordId,query.ReturnSheetRecordId],form.id)||
    !matches([spt.tahun],form.year)||!matches([spt.pemb],form.version)||
    !matches([spt.jenis],{PPN:'VAT_VATR',PPH2126:'ICT_WITR',UNIFIKASI:'ICT_WTR'}[form.type])||
    (given(spt.masa)&&![periodCode,form.period].includes(String(spt.masa)))||
    [ctx.npwp,spt.npwp].filter(given).some(v=>!owner||normalizeId(v)!==owner))return 'Identitas sumber berbeda dari SPT yang dipilih.';
  const failures=Array.isArray(pkg.manifest.gagal)?pkg.manifest.gagal:[];
  if(pkg.report?.valid===false||failures.some(f=>[entry.path,'data/'+entry.path].includes(typeof f==='string'?f:f?.path))||
     cap.lengkap!==true||!pages.length||pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||
     !matches([cap.halaman],pages.length))return 'Sumber belum lengkap atau ada halaman gagal.';
  if(Number(query.First)>0||query.Filters?.length)return 'Sumber memakai filter atau dimulai setelah baris pertama.';
  if(Array.isArray(cap.halamanSumber)&&cap.halamanSumber.some(s=>s?.pencocokan?.morePagesAvailable))return 'Masih ada halaman sumber yang belum disertakan.';
  return '';
}

function selfCollectedBase(row){
  const listed=salesFields.filter(k=>Object.hasOwn(row,k));
  if(!listed.length)return {reason:'Belum ada komponen DPP dipungut sendiri yang dapat dicocokkan dengan subtotal induk.'};
  const amounts=listed.map(k=>sourceAmount(row[k]?.SellingPrice));
  const direct=listed.map(k=>k+'.SellingPrice').join(' + ');
  if(amounts.some(v=>!Number.isFinite(v)))return {reason:'Ada komponen penyerahan yang nominalnya belum terbaca.'};
  const sum=amounts.reduce((a,b)=>a+b,0);
  if(listed.length===salesFields.length)return {amount:sum,source:direct};
  // Older forms omit unused groups. Confirm the reduced set against a separate subtotal.
  const taxable=sourceAmount(row[taxableSales]?.SellingPrice),exported=sourceAmount(row[exportsSales]?.SellingPrice);
  if(!Number.isFinite(taxable)||!Number.isFinite(exported))return {reason:'Komponen DPP dipungut sendiri belum lengkap dan subtotal konfirmasi belum tersedia.'};
  const remainder=taxable-exported;
  if(remainder<0||Math.abs(remainder-sum)>1e-6)return {reason:'DPP berdasarkan komponen dan subtotal induk belum dapat dicocokkan.'};
  return {amount:sum,source:direct+' · Dicocokkan dengan '+taxableSales+'.SellingPrice − '+exportsSales+'.SellingPrice'};
}

function ranges(positions){
  const spans=[];
  for(const position of positions){
    const last=spans.at(-1);
    if(last&&last[1]+1===position)last[1]=position;else spans.push([position,position]);
  }
  return spans.map(([a,b])=>a===b?String(a):a+'–'+b).join(', ');
}
function articleCode(value){
  const text=String(value??'').trim().replace(/^PPh\s+/i,'');
  if(/^(?:Article|Pasal)\s+4\s*(?:(?:Section|Ayat)\s*\(?2\)?|\(2\))$/i.test(text))return '4(2)';
  return /^(?:Article|Pasal)\s+(15|21|22|23|26)$/i.exec(text)?.[1]||'';
}

const currencyIssue='Mata uang sumber belum dapat dijumlahkan dalam rupiah pada KKP.';
const currencyFields=['CurrencyCode','Currency','MataUang','Mata Uang','TaxBaseCurrencyCode','IncomeTaxCurrencyCode'];
const rupiahLabels=new Set(['IDR','RP','RP.','RUPIAH']);
function usesOtherCurrency(...records){
  return records.some(r=>currencyFields.some(k=>given(r?.[k])&&!rupiahLabels.has(String(r[k]).trim().toUpperCase())));
}

function article22Tax(pkg,form,entry,row){
  const source='IncomeTaxes · Tax Article · Pasal 22 · TotalWithholding';
  const problem=sourceProblem(pkg,form,'induk',entry);
  if(problem)return {source,reason:problem};
  if(!row||!Array.isArray(row.IncomeTaxes))return {source,reason:'Daftar pasal pada induk belum tersedia.'};
  const body=entry.pages[0]?.Payload??entry.pages[0];
  const owner=normalizeId(pkg.manifest.wp?.npwp),month=form.period.slice(-2),periodCode=month+month+form.year;
  if(body.IsFound===false||[body.TIN,row.TaxIdentificationNumber].filter(given).some(v=>normalizeId(v)!==owner)||
    [body.PeriodCode,row.TaxPeriodCode].filter(given).some(v=>![periodCode,form.period].includes(String(v)))||
    given(row.ReturnSheetRecordIdentifier)&&String(row.ReturnSheetRecordIdentifier)!==form.id)
    return {source,reason:'Identitas WP, masa atau rekaman pada isi induk tidak cocok.'};
  const formCurrencyIssue=usesOtherCurrency(form.meta,entry.cap,entry.cap?.konteks,body,row),matches=[];
  row.IncomeTaxes.forEach((node,i)=>{
    const wrapper=node?.data?'.data':node?.Data?'.Data':'',item=node?.data??node?.Data??node;
    if(/^Tax Article$/i.test(item?.Type)&&articleCode(item.Name)==='22')
      matches.push({source:'IncomeTaxes['+i+']'+wrapper+'.TotalWithholding · Pasal 22',amount:sourceAmount(item.TotalWithholding),otherCurrency:usesOtherCurrency(item)});
  });
  if(matches.length!==1)return {source,reason:matches.length?'Ada beberapa subtotal Pasal 22 pada induk.':'Subtotal Pasal 22 belum tercantum pada induk.'};
  const result={...matches[0],present:true};
  if(formCurrencyIssue||result.otherCurrency)return {...result,amount:null,formCurrencyIssue,reason:currencyIssue};
  if(result.amount===null)result.reason='Jumlah PPh yang dipotong atau dipungut pada induk kosong atau bukan angka.';
  return result;
}

function withholdingBases(entry){
  const results=new Map(articleBases.map(([,code])=>[code,{amount:0,parts:[]}]));
  const cap=entry.cap,totals=[cap.total].filter(given),numbered=new Map(),anonymous=new Set();
  const cancelled22={amount:0,parts:[]};
  let count=0,lastPageSize=0;
  for(const [pageIndex,page] of entry.pages.entries()){
    const body=Object.hasOwn(page,'Payload')?page.Payload:page;
    const tableCurrencyIssue=usesOtherCurrency(cap,cap.konteks,page,body);
    if(tableCurrencyIssue)results.get('22').reason=currencyIssue;
    const rows=Array.isArray(body)?body:body?.Data??body?.rows;
    if(!Array.isArray(rows))return {reason:'Bentuk tabel D1-BPU belum dapat diperiksa.'};
    for(const t of [body?.TotalRecords,body?.TotalRecordCount,body?.TotalCount])if(given(t))totals.push(t);
    count+=rows.length;lastPageSize=rows.length;
    const positions=new Map(),cancelledPositions=[];
    for(const [i,r] of rows.entries()){
      const slip=r?.data??r?.Data??r;
      if(!slip||typeof slip!=='object'||Array.isArray(slip))return {reason:'Ada baris D1-BPU yang tidak terbaca.'};
      const statuses=[slip.WithholdingSlipsStatus,slip.Status].map(s=>String(s??'').trim().toUpperCase()).filter(Boolean);
      const cancelled=slip.IsCancelled===true||statuses.some(s=>['CANCELED','CANCELLED','DIBATALKAN'].includes(s));
      if(!cancelled){
        const inactive=statuses.filter(s=>['AMENDED','DRAFT','DELETED','REJECTED'].includes(s));
        const active=statuses.filter(s=>['NORMAL','AMENDMENT','APPROVED','REPORTED','SUBMITTED','REPLACEMENT','PEMBETULAN'].includes(s));
        if(inactive.length+active.length!==statuses.length||inactive.length&&active.length)return {reason:'Status bukti belum dikenali atau saling bertentangan.'};
        if(inactive.length||slip.IsDraft===true)continue;
      }
      const number=String(slip.WithholdingSlipsNumber??slip.WithholdingSlipNumber??'').trim();
      const record=String(slip.RecordId??'').trim();
      const ids=[number&&'number/'+number,record&&'record/'+record].filter(Boolean);
      for(const id of ids){
        const next=cancelled?'cancelled':'active',previous=numbered.get(id);
        if(previous&&(previous==='active'||next==='active'))return {reason:'Nomor atau ID bukti muncul berulang atau memiliki status yang bertentangan.'};
        if(previous==='cancelled'&&next==='cancelled'&&articleCode(slip.TaxArticle)==='22')cancelled22.amount=null;
        numbered.set(id,next);
      }
      if(!ids.length){
        const signature=JSON.stringify(Object.keys(slip).sort().map(k=>[k,slip[k]]));
        if(anonymous.has(signature)){
          if(!cancelled)return {reason:'Ada baris yang sama persis tanpa nomor atau ID bukti.'};
          if(articleCode(slip.TaxArticle)==='22')cancelled22.amount=null;
        }
        anonymous.add(signature);
      }
      const code=articleCode(slip.TaxArticle);
      if(cancelled){
        if(code==='22'){
          const amount=sourceAmount(slip.TaxBase);
          cancelledPositions.push(i+1);
          if(tableCurrencyIssue||usesOtherCurrency(slip))cancelled22.reason=currencyIssue;
          cancelled22.amount=cancelled22.reason||amount===null||cancelled22.amount===null?null:cancelled22.amount+amount;
        }
        continue;
      }
      if(!code)return {reason:'Ada baris D1-BPU dengan pasal yang belum dapat diidentifikasi.'};
      const found=results.get(code);if(!found)continue;
      if(!positions.has(code))positions.set(code,[]);positions.get(code).push(i+1);
      const amount=sourceAmount(slip.TaxBase);
      if(code==='22'&&usesOtherCurrency(slip))found.reason=currencyIssue;
      else if(amount===null)found.reason='Ada baris pasal ini dengan TaxBase kosong atau bukan angka.';
      else found.amount+=amount;
    }
    for(const [code,indices] of positions)results.get(code).parts.push('halaman '+(pageIndex+1)+' baris '+ranges(indices));
    if(cancelledPositions.length)cancelled22.parts.push('halaman '+(pageIndex+1)+' baris '+ranges(cancelledPositions));
  }
  const limit=cap.payload?.Rows;
  if(cap.total==null&&cap.payload?.First===0&&Number.isSafeInteger(limit)&&limit>0&&totals.every(t=>t===limit)&&count===limit&&lastPageSize>0)
    return {reason:'Jumlah baris mencapai batas permintaan dan halaman penutup belum tersedia.'};
  if(!totals.length||totals.some(t=>!Number.isSafeInteger(t)||t!==count)||(given(cap.baris)&&cap.baris!==count))return {reason:'Jumlah baris D1-BPU belum terkonfirmasi oleh total sumber.'};
  return {results,count,cancelled22};
}

function withholdingReturnList(pkg,year,type){
  const periods=new Map(),owner=normalizeId(pkg.manifest.wp?.npwp);
  for(const entry of pkg.entries.filter(e=>e.path==='spt/daftar.json'||e.cap?.sumber==='sptdaftar')){
    const cap=entry.cap||{},query=cap.payload||{};
    if(query.isArchieved===true||(given(cap.konteks?.npwp)&&normalizeId(cap.konteks.npwp)!==owner))continue;
    for(const row of rowsOf(entry)){
      if(listRowType(row)!==type||(given(row.ReturnSheetStatusCode)&&String(row.ReturnSheetStatusCode).toUpperCase()!=='SUBMITTED')||
        (given(row.TaxpayerAggregateIdentifier)&&given(query.TaxpayerAggregateIdentifier)&&row.TaxpayerAggregateIdentifier!==query.TaxpayerAggregateIdentifier))continue;
      const code=String(row.TaxPeriodCode??'');
      const period=/^(0[1-9]|1[0-2])\1(\d{4})$/.test(code)?code.slice(4)+'-'+code.slice(0,2):code;
      if(period.slice(0,4)!==String(year)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))continue;
      const model=String(row.ReturnSheetModel||'').trim(),amendment=/^(?:Amendment|Pembetulan)\s*(\d+)$/i.exec(model);
      const version=/^Normal$/i.test(model)?0:amendment?Number(amendment[1]):null;
      if(!periods.has(period))periods.set(period,[]);
      periods.get(period).push({id:row.RecordId,version,path:entry.path});
    }
  }
  return periods;
}

function revisionProblem(list,versions,form){
  const later=list.find(r=>r.version>form.version||
    given(r.id)&&r.version===form.version&&r.id!==form.id||
    given(r.id)&&r.version===null&&!versions.some(f=>f.id===r.id));
  return later?'Pembetulan terakhir pada '+later.path+' belum cocok dengan rekaman SPT dalam paket.':'';
}

function annualArticle22(group,label,months,year,listed,grossByPeriod){
  const lines=new Map(group.lines.map(l=>[l.period,l])),missing=[],sources=[];
  let sum=0;
  for(const month of months){
    const line=lines.get(month),gross=grossByPeriod?.get(month);
    const value=gross?gross.Nilai:line?.amount;
    const paths=[...new Set((listed.get(month)||[]).map(r=>r.path))].join(', ');
    sources.push(month+' · '+(gross?.Sumber||line?.source||paths||'Rekaman pembetulan terakhir belum dapat dipastikan.'));
    if(!line||line.partial||!Number.isFinite(value))missing.push(month);
    else sum+=value;
  }
  const unobserved=Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0')).filter(m=>!months.includes(m));
  (group.support??=[]).push({Uraian:label,Masa:String(year),Nilai:missing.length?null:sum,Satuan:'Rp (format KKP)',
    'Masa SPT dalam paket':months.length,'Masa terkonfirmasi':months.length-missing.length,
    'Masa belum terkonfirmasi':missing.join(', '),'Masa tanpa rekaman SPT di paket':unobserved.join(', '),
    Sumber:sources.join('\n'),Keterangan:missing.length?'Jumlah menunggu konfirmasi seluruh masa SPT yang tercatat.':'Jumlah hanya mencakup masa SPT yang tercatat pada paket.'});
}

export function buildIndex(pkg,year) {
  const groups=new Map(), warnings=[];
  const listed=withholdingReturnList(pkg,year,'ICT_WTR'),months22=new Set(listed.keys()),gross22ByPeriod=new Map();
  let hasArticle22Base=false,hasArticle22Tax=false;
  const periods=new Map();
  for(const form of pkg.forms.filter(f=>f.year===String(year))){
    if(form.type==='UNIFIKASI')months22.add(form.period);
    const period=form.type+'/'+form.period;
    if(!periods.has(period))periods.set(period,[]);
    periods.get(period).push(form);
  }
  for(const versions of periods.values()){
    const mostRecent=Math.max(...versions.map(f=>f.version));
    const latest=versions.filter(f=>f.version===mostRecent);
    const form=latest[0], kind=typeNames[form.type]||form.type;
    if(latest.length!==1){warnings.push(kind+' '+form.period+' memiliki lebih dari satu rekaman versi P'+mostRecent+'.');continue;}
    function add(ref,title,topic,entry,field,amount,tax=kind){
      const key=form.type+'/'+ref;
      if(!groups.has(key))groups.set(key,{key,ref,title,tax,lines:[]});
      const id=entry.path+'#'+field;
      const line={id,ref,groupKey:key,period:form.period,version:form.version,topic,tax,source:pathText(entry.path,field),
        amount:Number.isFinite(amount)?amount:null,partial:entry.cap?.lengkap===false};
      groups.get(key).lines.push(line);return line;
    }
    const entry=form.parts.get('induk'), parents=entry?rowsOf(entry):[], row=parents.length===1?parents[0]:null;
    if(parents.length>1)warnings.push(kind+' '+form.period+' memuat beberapa baris induk. Periksa berkas sumber.');
    function addSource(ref,title,tax,part,field,amount,reason,source){
      const sourceEntry=form.parts.get(part)||{path:form.key+'/'+part+'.json'};
      const line=add(ref,title,title,sourceEntry,field,reason?null:amount,tax);
      line.source=pathText(sourceEntry.path,[source,reason].filter(Boolean).join(' · '));
      line.partial=Boolean(reason);
      return line;
    }
    if(form.type==='PPN'){
      const reason=sourceProblem(pkg,form,'induk',entry);
      const basis=!reason&&row?selfCollectedBase(row):{};
      const own=addSource('N.3','DPP penyerahan yang dipungut sendiri',kind,'induk','DPP-dipungut-sendiri',basis.amount,
        reason||basis.reason||(!row?'Induk belum memuat satu formulir yang dapat diperiksa.':''),basis.source||'SellingPrice · Penyerahan dalam negeri');
      if(!reason&&row){
        const taxable=sourceAmount(row[taxableSales]?.SellingPrice),exported=sourceAmount(row[exportsSales]?.SellingPrice);
        if(Number.isFinite(taxable)&&Number.isFinite(exported)){
          const group=groups.get(own.groupKey);
          (group.support??=[]).push({Uraian:'Penyerahan terutang dikurangi ekspor BKP berwujud',Masa:form.period,
            Pembetulan:form.version,Nilai:taxable-exported,Satuan:typeof row.CurrencyCode==='string'?row.CurrencyCode:'',
            Sumber:pathText(entry.path,taxableSales+'.SellingPrice − '+exportsSales+'.SellingPrice'),
            Keterangan:'Subtotal pembanding. Cakupannya dapat meliputi penyerahan ke pemungut, penyerahan tidak dipungut dan penyerahan dibebaskan.'});
        }
      }
    }
    if(form.type==='UNIFIKASI'){
      const part='d1-bpu',annex=form.parts.get(part),problem=sourceProblem(pkg,form,part,annex);
      const bases=problem?{reason:problem}:withholdingBases(annex);
      const revisionIssue=revisionProblem(listed.get(form.period)||[],versions,form);
      const declared=revisionIssue?{reason:revisionIssue,source:'Daftar SPT dilaporkan'}:article22Tax(pkg,form,entry,row);
      addSource('E.2.2','PPh Pasal 22 terutang','PPh Pasal 22','induk','TotalWithholding-per-pasal-22',declared.amount,declared.reason,declared.source);
      if(declared.amount>0)hasArticle22Tax=true;
      if(declared.present&&declared.reason)warnings.push('PPh Pasal 22 '+form.period+' · '+pathText(entry.path,declared.reason));
      for(const [ref,code,tax] of articleBases){
        const group=bases.results?.get(code);
        const source=['TaxArticle / TaxBase · '+tax+(code==='22'?' · bukti aktif':''),...(group?.parts||[])];
        if(group&&!group.parts.length)source.push('Tidak ada bukti aktif pasal ini pada '+bases.count+' baris sumber yang diperiksa.');
        const reason=(code==='22'&&(revisionIssue||declared.formCurrencyIssue&&currencyIssue))||bases.reason||group?.reason;
        const line=addSource(ref,'Objek '+tax,tax,part,'TaxBase-per-pasal-'+code,group?.amount,reason,source.join(' · '));
        if(code==='22'){
          const cancelled=bases.cancelled22;
          if(declared.present&&(bases.reason||group?.reason))warnings.push('DPP PPh Pasal 22 '+form.period+' · '+line.source);
          if(line.amount>0||cancelled?.amount>0){
            if(declared.present){hasArticle22Base=true;hasArticle22Tax=true;}
            else{
              const evidence=line.source;
              const group22=groups.get(line.groupKey);
              (group22.support??=[]).push({Uraian:'DPP bukti aktif Pasal 22 tanpa subtotal induk yang cocok',Masa:form.period,
                Pembetulan:form.version,Nilai:line.amount,Sumber:evidence});
              line.amount=null;line.partial=true;
              line.source+=' · '+declared.reason+' · '+pathText(form.key+'/induk.json',declared.source);
              warnings.push('D1-BPU '+form.period+' memuat bukti Pasal 22. '+line.source);
            }
          }
          if(cancelled?.parts.length&&!revisionIssue){
            const gross=!reason&&cancelled.amount!==null?group.amount+cancelled.amount:null;
            const support=groups.get(line.groupKey).support??=[];
            const evidence=pathText(annex.path,['TaxArticle / TaxBase · bukti dibatalkan',...cancelled.parts,cancelled.reason].filter(Boolean).join(' · '));
            const listedBase={Uraian:'DPP bukti Pasal 22 yang tercantum, termasuk bukti dibatalkan',Masa:form.period,Pembetulan:form.version,Nilai:gross,
              Sumber:line.source+' · '+evidence,Keterangan:'Pembanding dengan daftar D1-BPU. Nilai utama pada lembar ini hanya menjumlahkan bukti aktif.'};
            support.push({Uraian:'DPP pada bukti Pasal 22 yang dibatalkan',Masa:form.period,Pembetulan:form.version,
              Nilai:declared.formCurrencyIssue?null:cancelled.amount,Sumber:evidence},listedBase);
            gross22ByPeriod.set(form.period,listedBase);
            warnings.push('D1-BPU '+form.period+' memuat bukti Pasal 22 yang dibatalkan. Periksa status sebelum menggunakan jumlah DPP. · '+evidence);
          }
        }
      }
    }
    if(row){
      for(const [ref,title,topic,field] of formFields[form.type]||[])add(ref,title,topic,entry,field,readValue(row,field));
      if(form.type==='BADAN'){
        const optionField='MainFormData.OverpaymentIncomeTax',option=readValue(row,optionField);
        const line=add('B','Induk PPh Badan','Kode pilihan pengembalian',entry,optionField,null);
        line.refundCode=(typeof option==='string'||Number.isFinite(option))?String(option):null;
        line.legacyCodeAmount=Number.isFinite(option)?option:null;
        const matches=new Map();
        const visit=(nodes,prefix)=>{
          if(!Array.isArray(nodes))return;
          nodes.forEach((node,i)=>{
            const path=prefix+'['+i+']',data=node?.Data,code=String(data?.AccountCode??'');
            if(Object.hasOwn(accounts,code)){
              if(!matches.has(code))matches.set(code,[]);
              matches.get(code).push({field:path+'.Data.Amount',data});
            }
            if(node?.Children)visit(node.Children,path+'.Children');
          });
        };
        for(const [key,values] of Object.entries(row)){
          if(!/^L1[a-z]FormData$/i.test(key)||!values||typeof values!=='object')continue;
          for(const [tree,nodes] of Object.entries(values))if(/TreeData$/.test(tree))visit(nodes,key+'.'+tree);
        }
        for(const [code,items] of matches){
          const [ref,title]=accounts[code];
          if(items.length!==1){warnings.push('Akun '+code+' muncul beberapa kali di '+kind+' '+form.period+'.');continue;}
          const item=items[0];
          add(ref,title,code+' · '+(item.data.Description||title),entry,item.field,item.data.Amount);
        }
      }
      if(form.type==='UNIFIKASI'&&Array.isArray(row.IncomeTaxes)){
        row.IncomeTaxes.forEach((item,i)=>{
          const data=item?.data;
          if(data?.Type!=='Tax Article')return;
          const ref={'Article 23':'G','Article 4 Section 2':'K'}[data.Name];
          if(!ref)return;
          const tax=ref==='G'?'PPh Pasal 23':'PPh Pasal 4 ayat (2)';
          for(const [field,topic] of [['TotalWithholding','Jumlah dipotong atau dipungut'],['TotalIncomeTaxPaid','Jumlah disetor']]){
            add(ref,'Induk '+tax,topic,entry,'IncomeTaxes['+i+'].data.'+field,data[field],tax);
          }
        });
      }
    }
    if(form.type==='PPN'){
      for(const [part,ref,title] of [['b1','N.8.1','Pajak masukan impor'],['b2','N.10','Pajak masukan dalam negeri']]){
        const annex=form.parts.get(part);
        if(!annex)continue;
        rowsOf(annex).forEach((doc,i)=>{
          if(doc.IsCancelled===true||!Object.hasOwn(doc,'VAT'))return;
          add(ref,title,'PPN · '+(doc.DocumentNumber||'baris '+(i+1)),annex,'baris['+(i+1)+'].VAT',doc.VAT);
        });
      }
    }
  }
  const months=[...months22].sort();
  if(hasArticle22Base){
    const group=groups.get('UNIFIKASI/E.2.1');
    annualArticle22(group,'Jumlah DPP bukti aktif Pasal 22',months,year,listed);
    if(gross22ByPeriod.size)annualArticle22(group,'Jumlah DPP Pasal 22 termasuk bukti dibatalkan',months,year,listed,gross22ByPeriod);
  }else groups.delete('UNIFIKASI/E.2.1');
  if(hasArticle22Tax)annualArticle22(groups.get('UNIFIKASI/E.2.2'),'Jumlah PPh Pasal 22 menurut induk',months,year,listed);
  else groups.delete('UNIFIKASI/E.2.2');
  projectWithholdingTax(groups,pkg,year,periods,{UNIFIKASI:listed,PPH2126:withholdingReturnList(pkg,year,'ICT_WITR')},sourceProblem,revisionProblem,usesOtherCurrency);
  const provisional=withoutReturnIndices(pkg,year);
  const company=companyAnnexIndices(pkg,year,{groups});
  for(const group of [...provisional.groups,...company.groups])groups.set(group.key,group);
  const byId=new Map();
  for(const group of groups.values())for(const line of group.lines)byId.set(line.id,line);
  return {groups:[...groups.values()].sort((a,b)=>compare(a.ref,b.ref)||compare(a.tax,b.tax)),byId,warnings:[...warnings,...provisional.warnings,...company.warnings]};
}

export function assessLine(line,{value,document,note='',officer,classification='indicative',principal=null,prefillBasis}){
  if(line&&Object.hasOwn(line,'refundCode'))throw Error('Kode pilihan hanya dapat ditelaah sebagai keterangan.');
  if(!line||!Number.isFinite(value)||!document?.trim()||!officer?.trim())throw Error('Isi nilai hasil uji, rujukan bukti dan nama penguji.');
  if(!['verified','indicative'].includes(classification))throw Error('Pilih klasifikasi pengujian.');
  const delta=line.amount===null?null:value-line.amount;
  if(principal!==null&&(!Number.isFinite(principal)||principal<0))throw Error('Periksa nilai pokok hasil pengujian.');
  if((delta!==0||line.withoutReturn)&&!note?.trim())throw Error('Tuliskan penjelasan hasil pengujian.');
  const observed=line.observedPrefill;
  if(prefillBasis!==undefined&&(prefillBasis!=='observed'||!observed||value!==observed.amount))
    throw Error('Subtotal yang dipilih tidak sesuai dengan masa dan sumber yang tersedia.');
  const basis=prefillBasis==='observed'?' · Subtotal penyerahan menurut induk SPT Masa PPN '+observed.periods.join(', '):'';
  const conclusion=line.withoutReturn?(delta===0?'Hasil uji sama dengan pembanding nol.':'Terdapat selisih hasil uji terhadap pembanding nol.') :
    delta===0?'Sesuai dengan SPT.':delta===null?'Nilai SPT untuk pembandingan belum tersedia.':'Terdapat selisih terhadap SPT.';
  return {kkpLine:line.id,kkpPeriod:line.period,document:document.trim(),kkpNote:note.trim(),
    topik:line.ref+' · '+line.topic+' · '+line.period,
    sumber:(line.withoutReturn?line.explanation+' ':'')+line.source+basis+' · Bukti pengujian '+document.trim(),
    ...(prefillBasis?{kkpPrefill:prefillBasis}:{}),
    fakta:note.trim()||'Nilai telah dicocokkan dengan bukti pengujian.',simpulan:conclusion,
    menurutWp:line.amount,menurutPetugas:value,petugas:officer.trim(),tax:line.tax,
    status:'Selesai',principal:delta===0?null:principal,evidence:delta===0?'none':classification,review:'Dalam pengujian'};
}

function historicalOptionReview(old,line){
  const fields=['topik','sumber','fakta','simpulan','status','petugas','document','kkpNote','review','evidence'];
  if(!old||fields.some(field=>typeof old[field]!=='string')||old.menurutWp!==line.legacyCodeAmount||
    !Number.isFinite(old.menurutPetugas)||old.principal!==null&&(!Number.isFinite(old.principal)||old.principal<0))
    throw Error('Riwayat pengujian kode pilihan tidak sesuai dengan berkas sumber.');
  return Object.fromEntries([...fields,'menurutWp','menurutPetugas','principal'].map(field=>[field,old[field]]));
}

export function reviewRefundCode(line,{document,note,officer},previous=null){
  if(!line||!Object.hasOwn(line,'refundCode')||!document?.trim()||!note?.trim()||!officer?.trim())
    throw Error('Isi rujukan, catatan telaah kode dan nama petugas.');
  return {kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:document.trim(),kkpNote:note.trim(),
    topik:line.ref+' · '+line.topic+' · '+line.period,sumber:line.source+' · '+document.trim(),
    fakta:note.trim(),simpulan:'Kode pilihan telah ditelaah.',menurutWp:null,menurutPetugas:null,
    petugas:officer.trim(),tax:line.tax,status:'Selesai',principal:null,evidence:'none',review:'Dalam pengujian',
    ...(previous?{legacyOptionReview:historicalOptionReview(previous,line)}:{})};
}

function restoreRefundCode(raw,row,line){
  if(!Object.hasOwn(raw,'refundCode')){
    const history=historicalOptionReview({...row,document:raw.document,kkpNote:raw.kkpNote},line);
    return {...row,kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:history.document,kkpNote:history.kkpNote,
      topik:line.ref+' · '+line.topic+' · '+line.period,simpulan:'Perlu telaah ulang. Berkas lama memperlakukan kode pilihan sebagai nominal.',
      menurutWp:null,menurutPetugas:null,principal:null,evidence:'none',status:'Perlu tindak lanjut',legacyOptionReview:history};
  }
  if(raw.refundCode!==line.refundCode||row.menurutWp!==null||row.menurutPetugas!==null||row.principal!==null||row.evidence!=='none'||
    typeof raw.document!=='string'||typeof raw.kkpNote!=='string')
    throw Error('Telaah kode pilihan berbeda dari sumber atau memuat nominal.');
  return {...row,kkpLine:line.id,kkpPeriod:line.period,refundCode:line.refundCode,document:raw.document,kkpNote:raw.kkpNote,
    ...(raw.legacyOptionReview?{legacyOptionReview:historicalOptionReview(raw.legacyOptionReview,line)}:{})};
}

export function restoreIndexedRows(rawRows,rows,index){
  const seen=new Set();
  return rows.map((row,i)=>{
    const raw=rawRows[i];
    if(raw.kkpLine===undefined)return row;
    const line=index.byId.get(raw.kkpLine);
    if(!line||seen.has(raw.kkpLine)||raw.kkpPeriod!==line.period)
      throw Error('Indeks atau nilai SPT pada berkas kerja berbeda dari sumber.');
    seen.add(raw.kkpLine);
    if(Object.hasOwn(line,'refundCode'))return restoreRefundCode(raw,row,line);
    if(row.menurutWp!==line.amount)throw Error('Indeks atau nilai SPT pada berkas kerja berbeda dari sumber.');
    const result=assessLine(line,{value:row.menurutPetugas,document:raw.document,note:raw.kkpNote,officer:row.petugas,
      classification:row.evidence==='none'?'indicative':row.evidence,principal:row.principal,prefillBasis:raw.kkpPrefill});
    return {...result,review:row.review};
  });
}

export const reviewDecisions=['','Setuju','Revisi','Tolak'];
export function restoreNotes(notes,index){
  if(notes===undefined)return {};
  const valid=new Set(index.groups.map(g=>g.key));
  if(!notes||typeof notes!=='object'||Array.isArray(notes))throw Error('Format penelaahan indeks tidak dikenali.');
  for(const [key,n] of Object.entries(notes)){
    if(!valid.has(key)||!n||!Number.isSafeInteger(n.revision)||n.revision<0||
      !['unit','preparer','reviewer'].every(k=>typeof n[k]==='string')||
      (n.decision!==undefined&&!reviewDecisions.includes(n.decision))||
      (n.reviewNote!==undefined&&typeof n.reviewNote!=='string'))throw Error('Isian penelaahan indeks tidak sah.');
  }
  return notes;
}

export const documentStatuses=['Saran','Diminta','Diterima sebagian','Diterima','Tidak diberikan'];
export function validateIndexDocuments(documents,index,year){
  if(documents===undefined)return [];
  if(!Array.isArray(documents))throw Error('Daftar permintaan dokumen tidak sah.');
  const groups=new Set(index.groups.map(g=>g.key)),numbers=new Set(),sources=new Set();
  return documents.map(d=>{
    if(!d||!Number.isSafeInteger(d.number)||d.number<1||numbers.has(d.number)||!groups.has(d.index)||
      typeof d.name!=='string'||!d.name.trim()||!documentStatuses.includes(d.status)||
      typeof d.date!=='string'||typeof d.due!=='string'||typeof d.reference!=='string')throw Error('Periksa nomor, indeks, nama dan status dokumen.');
    for(const date of [d.date,d.due].filter(Boolean)){
      const parsed=new Date(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw Error('Tanggal dokumen tidak sah.');
    }
    if(d.date&&d.due&&d.date>d.due)throw Error('Tenggat mendahului tanggal permintaan.');
    numbers.add(d.number);
    const result={number:d.number,index:d.index,name:d.name.trim(),status:d.status,date:d.date,due:d.due,reference:d.reference.trim()};
    if(d.probis!==undefined){
      result.probis=validatedProbisSource(d.probis,year);
      const key=probisRequestKey(d.index,result.probis);
      if(sources.has(key))throw Error('Saran Probis yang sama muncul dua kali pada indeks ini.');
      sources.add(key);
    }
    return result;
  });
}
export function documentRows(documents){
  const source=documents.find(d=>d.probis)?.probis, extra=Object.keys(probisSourceFields(source));
  return [['Nomor','Jenis dokumen','Indeks','Status','Tanggal permintaan','Tenggat tercatat','Rujukan',...extra],
    ...documents.map(d=>{
      const fields=probisSourceFields(d.probis);
      return ['DOK.'+d.number,d.name,d.index.split('/')[1],d.status,d.date,d.due,d.reference,...extra.map(k=>fields[k]??'')];
    })];
}

export function indexStatus(group,reviewed){
  let tested=0,changed=0;
  for(const line of group.lines){
    const row=reviewed.get(line.id);
    if(!row||row.legacyOptionReview&&row.status==='Perlu tindak lanjut')continue;
    tested++;
    if(line.amount!==null&&row.menurutPetugas!==line.amount)changed++;
  }
  return {tested,changed,state:changed?'Ada koreksi':tested===group.lines.length?'Selesai':tested?'Sebagian diuji':'Belum diuji'};
}

export function indexSheets(group,reviewed,notes={},documents=[]){
  const meta=notes[group.key]||{}, version=meta.revision?' (P'+meta.revision+')':'';
  const rows=[['Indeks',group.ref+version],['Kertas kerja',group.title],['UP2',meta.unit],['Dibuat oleh',meta.preparer],
    ['Ditelaah oleh',meta.reviewer],['Masa','P SPT','Uraian','Menurut SPT/WP','Menurut petugas','Koreksi','Status','Sumber SPT','Rujukan bukti','Penguji','Penjelasan']];
  const history=[];
  if(group.lines.some(l=>Object.hasOwn(l,'refundCode')))rows.at(-1).push('Kode pilihan pengembalian');
  if(group.lines.some(l=>l.withoutReturn)){
    const provisional=group.lines.find(l=>l.withoutReturn),header=rows.at(-1);
    header[3]='Pembanding KKP';header[7]=provisional.sourceTitle||'Sumber daftar dan bukti potong';
    header.push(provisional.prefillLabel||'Nilai awal dari bukti potong','Dasar pembanding','Cakupan bukti');
  }
  for(const line of group.lines){
    const row=reviewed.get(line.id), value=row?.menurutPetugas??null;
    const delta=line.amount===null||value===null?null:value-line.amount;
    const isCode=Object.hasOwn(line,'refundCode');
    rows.push([line.period,line.version,line.topic,line.amount,value,isCode?null:differenceCell(rows.length+1,4,5,delta),
      row?row.simpulan:'Belum diuji',line.source,row?.document,row?.petugas,row?.kkpNote]);
    if(line.withoutReturn){
      rows.at(-1).push(line.prefill,line.explanation,line.coverage.join('\n')||'Sumber tahun terpilih telah diperiksa.');
      if(row?.kkpPrefill==='observed')rows.at(-1)[7]=row.sumber;
    }
    if(isCode){
      rows.at(-1).push(line.refundCode);
      const old=row?.legacyOptionReview;
      if(old)history.push([line.period,old.topik,old.status,old.review,old.sumber,old.document,old.petugas,old.kkpNote,
        old.menurutWp,old.menurutPetugas,old.principal,old.evidence,old.fakta,old.simpulan]);
    }
  }
  for(const line of group.lines.filter(l=>l.withoutReturn&&l.details.length))rows.push([],[line.detailTitle||'Rincian bukti potong'],...worksheet(line.details));
  if(history.length)rows.push([],['Riwayat pengujian kode pada berkas lama. Angka disimpan untuk penelusuran.'],
    ['Masa','Butir lama','Status lama','Telaah lama','Sumber lama','Rujukan lama','Penguji','Catatan lama','Isian WP lama',
      'Isian petugas lama','Pokok lama','Klasifikasi lama','Fakta lama','Simpulan lama'],...history);
  const linked=documents.filter(d=>d.index===group.key);
  if(group.support?.length)rows.push([],['Rincian dan angka pembanding'],...companySupportWorksheet(group,rows.length+4,reviewed));
  if(linked.length)rows.push([],['Dokumen pendukung'],...documentRows(linked));
  return {name:group.ref+' '+group.title,rows};
}

export function completeIndexBook(pkg,year,index,reviewed,notes,documents=[],simulation={cases:[],end:''},work={}){
  const wp=pkg.manifest.wp||{}, assignment=pkg.manifest.penugasan||{},officer=pkg.manifest.penarik||{};
  const list=[['Indeks','Uraian','Jenis pajak','Status','Baris diuji','Jumlah baris','Baris koreksi','Revisi']];
  const findings=[['Indeks','Masa','Uraian','Menurut SPT/WP','Menurut petugas','Koreksi','Rujukan bukti','Sumber SPT']];
  const source=[['Indeks','Jenis pajak','Masa','P SPT','Uraian','Menurut SPT/WP','Sumber','Berkas ditandai belum lengkap']];
  const sourceSheet={name:'SPT Data',rows:source}, groupSheets=[],canonicalCells=new Map();
  for(const group of index.groups){
    const sheet=indexSheets(group,reviewed,notes,documents);groupSheets.push(sheet);
    group.lines.forEach((l,i)=>{if(l.canonicalKey===group.key)canonicalCells.set(l.id,{sheet,row:i+7});});
  }
  const review=[['Indeks','Judul','Baris diuji','Baris koreksi','Pembuat','Penelaah','Catatan penelaah','Keputusan','Revisi']];
  const hasProvisional=index.groups.some(g=>g.lines.some(l=>l.withoutReturn));
  if(hasProvisional)source[0].push('Dasar pembanding KKP',index.groups.some(g=>g.provisionalCompany)?'Nilai awal pembanding':'Nilai awal dari bukti potong');
  const main=[['Jenis pajak','Indeks','Masa','Uraian','Menurut SPT/WP','Menurut petugas','Selisih yang diuji','Pokok hasil pengujian (Rp)','Rujukan']];
  for(const [groupIndex,group] of index.groups.entries()){
    const status=indexStatus(group,reviewed);
    const groupSheet=groupSheets[groupIndex],meta=notes[group.key]||{};
    list.push([sheetLink(groupSheet,group.ref),group.title,group.tax,status.state,status.tested,group.lines.length,status.changed,meta.revision||0]);
    review.push([sheetLink(groupSheet,group.ref),group.title,status.tested,status.changed,meta.preparer,meta.reviewer,meta.reviewNote,meta.decision,meta.revision||0]);
    for(const [i,l] of group.lines.entries()){
      const row=i+7;
      const canonical=canonicalCells.get(l.id);
      if(canonical&&canonical.sheet!==groupSheet){
        const officer=reviewed.get(l.id)?.menurutPetugas??null,delta=l.amount===null||officer===null?null:officer-l.amount;
        [l.amount,officer,delta].forEach((value,k)=>{groupSheet.rows[i+6][k+3]=numericReference(canonical.sheet,canonical.row,k+4,value);});
        continue;
      }
      source.push([group.ref,group.tax,l.period,l.version,l.topic,l.amount,l.source,l.partial]);
      if(l.withoutReturn)source.at(-1).push(l.explanation,l.prefill);
      if(!l.withoutReturn&&!Object.hasOwn(l,'refundCode'))groupSheet.rows[row-1][3]=numericReference(sourceSheet,source.length,6,l.amount);
      const r=reviewed.get(l.id);
      if(r&&!Object.hasOwn(l,'refundCode'))main.push([group.tax,sheetLink(groupSheet,group.ref,row),l.period,l.topic,
        numericReference(groupSheet,row,4,l.amount),numericReference(groupSheet,row,5,r.menurutPetugas),
        differenceCell(main.length+1,5,6,l.amount===null?null:r.menurutPetugas-l.amount),r.principal,r.document]);
      if(r&&l.amount!==null&&l.amount!==r.menurutPetugas)findings.push([sheetLink(groupSheet,group.ref,row),l.period,l.topic,
        numericReference(groupSheet,row,4,l.amount),numericReference(groupSheet,row,5,r.menurutPetugas),
        differenceCell(findings.length+1,4,5,r.menurutPetugas-l.amount),r.document,l.source]);
    }
  }
  const sim=simulationTables(simulation);
  if(index.warnings.length)source.push([],['Keterangan cakupan sumber'],...index.warnings.map(s=>[s]));
  if(sim.summary.length)main.push([],['Simulasi ketetapan per jenis pajak'],...worksheet(sim.summary));
  const formal=filingAndPaymentRows(pkg,year);
  const audit=workAuditRows(work);
  const benchmark=benchmarkSheet(pkg,year,work.benchmark);
  const direct=findingsFor(pkg,year,work.rows||[]).filter(f=>f.status==='berbukti'&&
    !['Terjelaskan','Tidak relevan'].includes(work.dispositions?.[findingKey(f)]));
  return [{name:'ID',rows:[['Isian','Nilai'],['Nama WP',wp.nama],['NPWP',wp.npwp],['Tahun',year],['Nomor penugasan',assignment.nomor],
    ['Jenis penugasan',assignment.jenis],['Tanggal penugasan',assignment.tanggal],['Peran',assignment.peran||officer.peran],['Penarik',officer.nama],
    ['Periode paket',pkg.manifest.periode],['Pemeriksaan paket',pkg.report.manifestHash],['Pilihan tarif bunga sesi',rateSourceLabel()]]},
    {name:'Daftar Indeks',rows:list},{name:'Temuan Sementara',rows:findings},{name:'INDUK',rows:main},
    {name:'Permintaan Dokumen',rows:documentRows(documents)},sourceSheet,{name:'Kepatuhan Formal',rows:formal},
    {name:'Review Sheet',rows:review},{name:'Jejak Audit',rows:audit.length?worksheet(audit):[['Belum ada perubahan tercatat.']]},
    {name:'Temuan Langsung',rows:findingRows(direct)},...(benchmark?[benchmark]:[]),...businessSheets(pkg,year,work),
    ...groupSheets];
}
