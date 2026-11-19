import {rowsOf} from './model.js';
import {withholdingSnapshot} from './withholding-forms.js';

const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const labels=new Map([['21','PPh Pasal 21'],['4(2)','PPh Pasal 4 ayat (2)'],['15','PPh Pasal 15'],
  ['22','PPh Pasal 22'],['23','PPh Pasal 23'],['26','PPh Pasal 26'],['UNI','PPh Unifikasi']]);
const taxFields=['TotalWithholding','TotalSelfPayment','TotalIncomeTaxByGovernment'];

function sum(values){
  const numbers=values.filter(Number.isFinite);
  return numbers.length?numbers.reduce((total,value)=>total+value,0):null;
}

function articleCode(text){
  const name=String(text || '').trim();
  if(/^(?:Article|Pasal)\s+4\s*(?:Section|Ayat|\()\s*\(?2\)?\s*$/i.test(name))return '4(2)';
  return /^(?:Article|Pasal)\s+(15|21|22|23|26)$/i.exec(name)?.[1];
}

function currentReturns(forms,year,warnings){
  const groups=new Map();
  for(const f of forms){
    if(!['PPH2126','UNIFIKASI'].includes(f.type)||f.year!==String(year)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.period))continue;
    const key=f.type+'/'+f.period,prev=groups.get(key);
    if(!prev||f.version>prev[0].version)groups.set(key,[f]);
    else if(f.version===prev[0].version)prev.push(f);
  }
  const selected=[];
  for(const matches of groups.values()){
    const f=matches[0];
    if(matches.length!==1)warnings.push('Ada beberapa SPT '+f.type+' dengan nomor pembetulan tertinggi yang sama pada '+f.period+'. Nilainya belum dapat dipilih.');
    else if(f.laterListed)warnings.push('Versi lebih baru pada '+f.period+' tercatat di daftar pelaporan. Angkanya belum tersedia.');
    else selected.push(f);
  }
  return selected;
}

function articleLines(form,warnings,wp){
  const entry=form.parts.get('induk');
  const snapshot=withholdingSnapshot(form,wp);
  if(snapshot.length){
    const amounts=['A21IncomeTaxWithheld','A26IncomeTaxWithheld'].map(key=>snapshot.find(item=>item.key===key));
    const tax=amounts.every(item=>Number.isFinite(item?.value))?amounts[0].value+amounts[1].value:null;
    return [{code:'21',base:null,tax,active:true,baseSource:'',
      taxSource:tax===null?'':entry.path+' · '+amounts.map(item=>item.label+' · '+item.source).join(' / '),
      snapshot:true}];
  }
  const forms=rowsOf(entry);
  if(!entry||forms.length!==1){
    warnings.push('Induk '+form.type+' '+form.period+' belum tersedia sebagai satu formulir.');
    return [];
  }
  const data=forms[0];
  if(form.type==='PPH2126'){
    const gross=['Form1A','Form1B','Form3'].map(group=>data[group]?.GrossIncome);
    return [{code:'21',base:sum(gross),tax:sum([data.A21IncomeTaxWithheld,data.A26IncomeTaxWithheld]),
      active:true,baseSource:entry.path+' · Form1A/Form1B/Form3.GrossIncome',taxSource:entry.path+' · A21IncomeTaxWithheld + A26IncomeTaxWithheld'}];
  }
  const summaries=Array.isArray(data.IncomeTaxes)?data.IncomeTaxes:[];
  if(!summaries.length){
    if(!Number.isFinite(data.TotalIncomeTaxPaid))return [];
    return [{code:'UNI',base:null,tax:data.TotalIncomeTaxPaid,active:true,baseSource:'',taxSource:entry.path+' · TotalIncomeTaxPaid (jumlah disetor)'}];
  }
  const annex=form.parts.get('d1-bpu');
  const partial=annex?.cap?.lengkap===false || annex?.pages?.some(page=>page.IsSuccessful===false);
  if(partial)warnings.push('Lampiran D1-BPU '+form.period+' belum lengkap. Jumlah objek per pasal belum tersedia.');
  const bases=new Map();
  for(const raw of rowsOf(annex)){
    const slip=raw.data??raw.Data??raw,code=articleCode(slip.TaxArticle);
    if(!code)continue;
    if(!bases.has(code))bases.set(code,[]);
    bases.get(code).push(slip.TaxBase);
  }
  const lines=[];
  for(const [i,node] of summaries.entries()){
    const item=node?.data??node?.Data??node,code=articleCode(item?.Name);
    if(!code)continue;
    const slips=bases.get(code) || [];
    const base=partial||slips.some(v=>!Number.isFinite(v))?null:sum(slips),tax=sum(taxFields.map(field=>item[field]));
    lines.push({code,base,tax,active:slips.length>0||(tax!==null&&tax!==0),
      baseSource:annex?annex.path+' · TaxArticle / TaxBase':'',
      taxSource:entry.path+' · IncomeTaxes['+i+'] '+item.Name+' · '+taxFields.join(' + ')});
  }
  return lines;
}

export function monthlyWithholding(forms,year,wp){
  const warnings=[],active=new Set(),values=new Map(),sources=[];
  for(const form of currentReturns(forms,year,warnings)){
    const month=Number(form.period.slice(-2));
    for(const line of articleLines(form,warnings,wp)){
      const key=month+'/'+line.code;
      if(line.active)active.add(line.code);
      if(values.has(key)){
        values.set(key,null);
        warnings.push('Lebih dari satu ringkasan untuk '+labels.get(line.code)+' pada '+form.period+'. Nilainya belum dapat dipilih.');
      }else values.set(key,line);
      sources.push({Masa:form.period,Pasal:labels.get(line.code),Versi:form.version,'Sumber objek':line.baseSource || null,
        'Sumber pajak':line.taxSource,...(line.snapshot?{'Cakupan sumber':'Cuplikan induk'}:{})});
    }
  }
  const articles=[...labels].filter(([code])=>active.has(code)),columns=['Masa'];
  for(const [,label] of articles)columns.push(label+' · objek',label+' · PPh');
  const rows=months.map((Masa,i)=>{
    const row={Masa};
    for(const [code,label] of articles){
      const key=(i+1)+'/'+code,line=values.get(key);
      row[label+' · objek']=values.has(key)?line?.base??null:'';
      row[label+' · PPh']=values.has(key)?line?.tax??null:'';
    }
    return row;
  });
  const total={Masa:'Jumlah nilai tersedia'},unreportedColumns=[];
  for(const key of columns.slice(1)){
    const observed=sum(rows.map(row=>row[key]));
    if(observed===null)unreportedColumns.push(key);
    total[key]=observed;
  }
  const shown=new Set(articles.map(([,label])=>label));
  const evidence=sources.filter(source=>shown.has(source.Pasal)).sort((a,b)=>a.Masa.localeCompare(b.Masa));
  return {columns,rows,total,unreportedColumns,sources:evidence,warnings};
}
