import {rowsOf,typeNames,worksheet} from './model.js';
import {normalizeId} from '../app-data.js';

const sections={
  PPH2126:{l1a:'L-I A','l1b-a1':'L-I B · A1','l1b-a2':'L-I B · A2','l2-a1':'L-II · A1','l2-a2':'L-II · A2','l3-bp21':'L-III · BP21','l3-bp26':'L-III · BP26'},
  UNIFIKASI:{lamp1:'Lampiran 1','d1-bpu':'D1 · BPU','d1-bpnr':'D1 · BPNR','d2-cy':'D2 · CY','d2-sp':'D2 · setor sendiri'}
};
const employeeFields={IncomeTaxWithheld:'Dipotong',IncomeTaxBorneByGovernment:'Ditanggung pemerintah',CarryForward:'Kompensasi',
  PaymentWithSP2D:'Pembayaran dengan SP2D',IncomeTaxUnderpaidOverpaid:'Kurang atau lebih bayar',IncomeTaxPaidOnAmended:'PPh dibayar pada SPT yang dibetulkan',
  IncomeTaxUnderpaidOverpaidDueToAmendment:'Kurang atau lebih bayar karena pembetulan'};
const unifiedFields={TotalSelfPayment:'Setor sendiri',TotalWithholding:'Jumlah dipotong',TotalIncomeTaxByGovernment:'PPh ditanggung pemerintah',
  TotalIncomeTaxPaid:'Jumlah PPh disetor',TotalIncomeTaxPaidPreviousReturn:'PPh disetor pada SPT sebelumnya',TotalIncomeTaxAmendment:'PPh karena pembetulan',
  TotalIncomeTaxToBePaidBPUBPNR:'PPh harus disetor (BPPU/BPNR)'};
const formGroups={Form1A:'L-I A',Form1B:'L-I B',Form2:'L-II',Form3:'L-III'};
const groupLines={GrossIncomeAndIncomeTaxWithheld:'Dipotong',GrossIncomeAndIncomeTaxBorneByGovernment:'Ditanggung pemerintah',
  TotalGrossIncomeAndIncomeTaxBorneByGovernmentAndIncomeTaxWithheld:'Jumlah pada formulir',
  Article21GrossIncomeAndIncomeTaxWithheld:'Pasal 21 · dipotong',Article21GrossIncomeAndIncomeTaxBorneByGovernment:'Pasal 21 · ditanggung pemerintah',
  Article26GrossIncomeAndIncomeTaxWithheld:'Pasal 26 · dipotong',Article26GrossIncomeAndIncomeTaxBorneByGovernment:'Pasal 26 · ditanggung pemerintah'};
export function sourceAmount(v){
  if(typeof v==='string'&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))v=Number(v);
  return typeof v==='number'&&Number.isFinite(v)?v:null;
}
const money=sourceAmount;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const location=(entry,field)=>entry.path+' · '+field;
const own=(v,k)=>Object.hasOwn(v,k);
export const isWithholdingForm=f=>own(sections,f.type);

function matchesVersion(form,entry,wp){
  const ctx=entry.cap?.konteks||{},spt=ctx.spt||{},taxType=form.type==='PPH2126'?'ICT_WITR':'ICT_WTR';
  const [year,month]=String(form.period).split('-');
  const owner=wp?.npwp?normalizeId(String(wp.npwp)):null;
  const owners=[ctx.npwp,spt.npwp].filter(v=>v!=null&&v!=='');
  return (!owner||owners.every(v=>normalizeId(String(v))===owner))&&(!spt.recordId||spt.recordId===form.id)&&
    (spt.pemb==null||Number(spt.pemb)===form.version)&&(!spt.jenis||spt.jenis===taxType)&&
    (!spt.tahun||String(spt.tahun)===year)&&(!spt.masa||[form.period,month+month+year].includes(String(spt.masa)));
}
function parentData(form,notes,wp){
  const entry=form.parts.get('induk'),rows=rowsOf(entry);
  if(!entry||rows.length!==1||!object(rows[0])){notes.push('Induk belum tersedia sebagai satu formulir.');return null;}
  if(!matchesVersion(form,entry,wp)||entry.pages?.some(p=>p?.IsSuccessful===false)){
    notes.push('Induk gagal dibaca atau identitas pembetulan berbeda dari versi terpilih.');return null;
  }
  if(entry.cap?.lengkap===false)notes.push('Induk ditandai belum lengkap. Periksa sumber saat menilai angka.');
  return {entry,data:rows[0]};
}
function employeeFieldsFor(data,entry){
  const values=[],groups=[];
  for(const article of [21,26])for(const [tail,label] of Object.entries(employeeFields)){
    const key='A'+article+tail;
    if(own(data,key))values.push({Uraian:'PPh '+article+' · '+label,Nilai:money(data[key]),Isian:key,Sumber:entry.path});
  }
  for(const [key,group] of Object.entries(formGroups)){
    const block=data[key];
    if(!object(block))continue;
    for(const [name,label] of Object.entries(groupLines)){
      const pair=block[name];if(!object(pair))continue;
      groups.push({Lampiran:group,Uraian:label,Bruto:money(pair.GrossIncome),PPh:money(pair.IncomeTax),
        Isian:key+'.'+name,Sumber:entry.path});
    }
    for(const [gross,tax] of [['GrossIncome','IncomeTax'],['TotalGrossIncome','TotalIncomeTax']]){
      if(!own(block,gross)&&!own(block,tax))continue;
      groups.push({Lampiran:group,Uraian:gross.startsWith('Total')?'Jumlah pada formulir':'Isian pada formulir',
        Bruto:money(block[gross]),PPh:money(block[tax]),Isian:[gross,tax].filter(k=>own(block,k)).map(k=>key+'.'+k).join(' / '),Sumber:entry.path});
    }
  }
  return {values,groups};
}
function unified(data,entry,notes){
  const values=[],articles=[];
  function amount(item,key){
    if(key!=='TotalIncomeTaxByGovernment')return [money(item[key]),key];
    const aliases=['TotalIncomeTaxByGovernment','TotalIncomeTaxByGoverment'].filter(k=>own(item,k));
    if(aliases.length===2&&money(item[aliases[0]])!==money(item[aliases[1]])){
      notes.push('Dua isian PPh ditanggung pemerintah berbeda di sumber.');return [null,aliases.join(' / ')];
    }
    const actual=aliases[0]||key;return [money(item[actual]),actual];
  }
  for(const [key,label] of Object.entries(unifiedFields)){
    const [v,actual]=amount(data,key);
    if(own(data,actual)||actual.includes(' / '))values.push({Uraian:label,Nilai:v,Isian:actual,Sumber:entry.path});
  }
  function visit(nodes,path,parent=''){
    if(!Array.isArray(nodes))return;
    nodes.forEach((node,i)=>{
      const item=node?.data??node?.Data??node;if(!object(item))return;
      const at=path+'['+i+']',wrapped=node.data?'.data':node.Data?'.Data':'';
      const name=typeof item.Name==='string'?item.Name:'',isArticle=/^tax article$/i.test(String(item.Type));
      const row={No:item.No??null,Jenis:item.Type??null,Pasal:isArticle?name:parent||null,Uraian:name||null};
      for(const [key,label] of Object.entries(unifiedFields)){
        const [v,actual]=amount(item,key);
        if(own(item,actual)||actual.includes(' / '))row[label]=v;
      }
      row.Isian=at+wrapped;row.Sumber=entry.path;articles.push(row);
      const children=Array.isArray(node.children)?'children':'Children';
      visit(node[children],at+'.'+children,isArticle?name:parent);
    });
  }
  visit(data.IncomeTaxes,'IncomeTaxes');return {values,articles};
}
const excludedStatus=/^(CANCELLED|CANCELED|AMENDED|DRAFT|DELETED|REJECTED)$/i;
const acceptedStatus=/^(NORMAL|AMENDMENT|APPROVED|REPORTED|SUBMITTED|REPLACEMENT|PEMBETULAN)$/i;
function attachments(form,wp){
  return Object.entries(sections[form.type]).map(([part,label])=>{
    const entry=form.parts.get(part),pages=entry?.pages||[];
    const tabular=pages.filter(p=>p?.IsSuccessful!==false&&
      (Array.isArray(p?.Payload?.Data)||Array.isArray(p?.Payload)||Array.isArray(p?.Data)));
    const failed=pages.some(p=>p?.IsSuccessful===false);
    const raw=rowsOf({pages:tabular});
    const status=r=>String(r.WithholdingSlipsStatus??r.Status??'').trim();
    const rows=raw.filter(r=>r.IsCancelled!==true&&r.IsDraft!==true&&!excludedStatus.test(status(r)));
    const unknown=rows.some(r=>status(r)&&!acceptedStatus.test(status(r)));
    const reported=[entry?.cap?.total,...(entry?.pages||[]).map(p=>p?.Payload?.TotalRecords)].filter(v=>v!=null);
    const numbers=new Set();
    let duplicate=false;
    for(const r of rows){
      const id=r.WithholdingSlipsNumber??r.WithholdingSlipNumber;
      if(!id)continue;
      if(numbers.has(id))duplicate=true;
      numbers.add(id);
    }
    const conflict=entry&&!matchesVersion(form,entry,wp);
    const complete=entry?.cap?.lengkap===true&&tabular.length>0&&tabular.length===pages.length&&
      (entry.cap.baris==null||entry.cap.baris===raw.length)&&(entry.cap.halaman==null||entry.cap.halaman===entry.pages.length)&&
      reported.length>0&&reported.every(n=>Number.isInteger(n)&&n===raw.length)&&!duplicate&&!conflict&&!unknown;
    const sum=field=>complete&&rows.length&&rows.every(r=>money(r[field])!==null)?rows.reduce((n,r)=>n+money(r[field]),0):null;
    return {Bagian:label,Kode:part,Status:!entry?'Belum ada':conflict?'Identitas versi berbeda':duplicate?'Nomor bukti berulang':unknown?'Status bukti belum dikenali':
      failed?(tabular.length?'Sebagian halaman gagal':'Gagal'):complete?(raw.length?'Lengkap':'Kosong terverifikasi'):'Cakupan belum terverifikasi',
      'Baris sumber':tabular.length?raw.length:null,'Baris dalam rekap':complete?rows.length:null,
      Bruto:sum('GrossIncome'),DPP:sum('TaxBase'),PPh:sum('IncomeTax'),Sumber:entry?.path??null};
  });
}
export function withholdingForm(form,wp){
  if(!isWithholdingForm(form))return null;
  const notes=[],parent=parentData(form,notes,wp);
  const result={values:[],groups:[],articles:[],attachments:attachments(form,wp),notes};
  if(parent)Object.assign(result,form.type==='PPH2126'?employeeFieldsFor(parent.data,parent.entry):unified(parent.data,parent.entry,notes));
  return result;
}
function gross1A(data,entry,notes){
  const block=data.Form1A||{},key='TotalGrossIncomeAndIncomeTaxBorneByGovernmentAndIncomeTaxWithheld';
  const options=[[money(block[key]?.GrossIncome),'Form1A.'+key+'.GrossIncome'],[money(block.TotalGrossIncome),'Form1A.TotalGrossIncome'],
    [money(block.GrossIncome),'Form1A.GrossIncome']].filter(([v])=>v!==null);
  if(!options.length)return [null,null];
  if(options.some(([v])=>v!==options[0][0])){notes.push('Nilai bruto L-I A berbeda pada beberapa isian induk.');return [null,null];}
  return [options[0][0],location(entry,options[0][1])];
}
export function withholdingPeriods(forms,year,wp){
  const periods=new Map(),rows=[],notes=[];
  for(const f of forms){
    if(!isWithholdingForm(f)||(year&&f.year!==String(year)))continue;
    const key=f.type+'/'+f.period,versions=periods.get(key);
    if(!versions||f.version>versions[0].version)periods.set(key,[f]);
    else if(f.version===versions[0].version)versions.push(f);
  }
  for(const versions of periods.values()){
    const form=versions[0],prefix=typeNames[form.type]+' '+form.period+' P'+form.version;
    if(versions.length!==1){notes.push(prefix+' memiliki beberapa rekaman. Periksa versi terakhir.');continue;}
    const warnings=[],parent=parentData(form,warnings,wp),data=parent?.data||{};
    const [gross,source]=parent&&form.type==='PPH2126'?gross1A(data,parent.entry,warnings):[null,null];
    rows.push({Masa:form.period,Jenis:typeNames[form.type],Versi:form.version?'Pembetulan '+form.version:'Normal','Bruto L-I A':gross,
      'PPh 21':money(data.A21IncomeTaxWithheld),'PPh 26':money(data.A26IncomeTaxWithheld),'PPh 21 DTP':money(data.A21IncomeTaxBorneByGovernment),
      'Potong/pungut Unifikasi':money(data.TotalWithholding),'Setor Unifikasi':money(data.TotalIncomeTaxPaid),
      'Sumber bruto L-I A':source,'Sumber induk':parent?.entry.path??null});
    notes.push(...warnings.map(w=>prefix+' · '+w));
  }
  return {rows,notes};
}
export function withholdingSections(model){
  return [['Ringkasan induk',model.values],['Bruto dan PPh menurut lampiran pada induk',model.groups],
    ['PPh per pasal dan rincian objek',model.articles],['Bukti pada lampiran versi ini',model.attachments]].filter(([,rows])=>rows.length);
}
export function withholdingSheetRows(model){
  return [...withholdingSections(model).flatMap(([name,items])=>[[name],...worksheet(items),[]]),...model.notes.map(n=>['Catatan',n])];
}
