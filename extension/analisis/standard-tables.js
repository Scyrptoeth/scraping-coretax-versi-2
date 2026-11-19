import {flatten,rowsOf,typeNames} from './model.js';
import {combinedLedger} from './ledger-table.js';
import {fieldLabel,fieldValue,presentRows,sourceLabel} from './display-fields.js';
import {isSptList,periodLabel} from '../app-package-entries.js';
import {sptListContext} from '../app-spt-plan.js';
import {periodTitle,sptFieldLabel,sptFieldValue} from './spt-forms.js';
import {sources} from '../app-data.js';

const order=['BADAN','OP','PPH2126','UNIFIKASI','PPN','PPN-PEMUNGUT'];
const titles={bb:'Transaksi per berkas buku besar',bbtotal:'Total buku besar per periode',bbsaldo:'Saldo buku besar seluruh periode',
  bplawan:'Bukti potong dari lawan transaksi',pbb:'Objek pajak (PBB)',sptdaftar:'Daftar SPT dilaporkan',sptarsip:'Daftar SPT diarsipkan'};
const clean=text=>String(text||'').replace(/\s+/g,' ').trim();
function partInfo(type,part,entry){
  if(part==='induk')return {key:part,name:'Induk per masa dan versi'};
  const group=type==='BADAN'&&/^l9-([123])-\d+$/.exec(part);
  if(group)return {key:'l9-'+group[1],name:['','L9 Tabel 1 · Harta berwujud','L9 Tabel 2 · Bangunan','L9 Tabel 3 · Harta tak berwujud'][group[1]]};
  const label=clean(entry.cap.label).split(' · ').at(-1);
  return {key:part,name:label&&!label.includes('.json')?label.replace(/:\s*/,' · '):'Lampiran '+part.toUpperCase()};
}
function mainAmounts(row){
  const result={};
  for(const [key,value] of flatten(row)){
    if(/(?:^|\.)\d+(?:\.|$)/.test(key)||typeof value!=='number'&&value!==null)continue;
    result[key]=value;
  }
  return result;
}
function withContext(info,row){
  const out={...info};
  for(const [key,value] of Object.entries(row)){
    let title=key;while(Object.hasOwn(out,title))title+=' (sumber)';
    out[title]=value;
  }
  return out;
}
function formRows(group){
  const records=[],context=[];
  for(const {entry,form,part} of group.members){
    const info={'Jenis SPT':typeNames[form.type]||form.type,Masa:periodTitle(form.period),Pembetulan:form.version,'Versi terakhir':form.latest?'Ya':'Tidak',Bagian:partInfo(form.type,part,entry).name};
    for(const row of rowsOf(entry)){
      records.push(part==='induk'?mainAmounts(row):row);context.push(info);
    }
  }
  const presentation=presentRows(records,{label:sptFieldLabel,value:sptFieldValue,filledOnly:true});
  return presentation.map((row,i)=>withContext(context[i],row));
}
function sourceTableRows(members){
  const records=[],context=[];
  for(const {entry} of members){
    const period=/^bukubesar-total\/(\d{4})-(setahun|0[1-9]|1[0-2])\.json$/.exec(entry.path);
    const slip=/^bukti-potong-lawan\/(\d{4})\/([\w-]+)\.json$/i.exec(entry.path);
    for(const row of rowsOf(entry)){
      let info={};
      if(period)info={Periode:period[2]==='setahun'?'Setahun '+period[1]:periodTitle(period[1]+'-'+period[2])};
      if(slip)info={Tahun:slip[1],'Jenis bukti potong':slip[2]};
      if(isSptList(entry.cap.sumber)){
        const {form,period,revision,typeConflict}=sptListContext(row);
        info={'Jenis SPT':form&&!typeConflict?fieldValue('ReturnSheetTypeCode',form):null,
          Masa:periodTitle(period?.label||periodLabel([row]))||null,Pembetulan:revision};
      }
      context.push(info);records.push(row);
    }
  }
  const translated=presentRows(records,{label:k=>k==='ReturnSheetTypeCode'?'Jenis SPT pada sumber':fieldLabel(k),filledOnly:true});
  return translated.map((row,i)=>withContext(context[i],row));
}
function ledgerRows(ledger,showFlags){
  const isFlag=key=>/^(?:(?:Is|Was)Under|IsNonObjection|IsLegallyBound$|Under(?:Installment|Sppss|Distress|Seizure|Debt)|ClosedInstallment|HasNoticeOfInterest$|MaxInterestReached$|ObjectionWasRejected$|ObjectionWithdrawalWasAccepted$|DecisionRejectedArt)/.test(key);
  const flags=new Set();
  for(const row of ledger.rows)for(const [key,value] of Object.entries(row))if(typeof value==='boolean'&&isFlag(key)&&fieldLabel(key)!=='Isian tambahan')flags.add(key);
  const sources=[],summary=[];
  for(const row of ledger.rows){
    const details=row.TaxpayerAccountingDetails,active=[...flags].filter(key=>row[key]===true).map(fieldLabel);
    summary.push({'Jumlah rincian':Array.isArray(details)?details.length:null,'Status hukum/penagihan':active.length?active.join(' • '):null});
    const fields=Object.fromEntries(Object.entries(row).filter(([key,value])=>key!=='TaxpayerAccountingDetails'&&(showFlags||!flags.has(key)||typeof value!=='boolean')));
    fields[ledger.sourceColumn]=row[ledger.sourceColumn].split(', ').map(sourceLabel).join(', ');sources.push(fields);
  }
  return presentRows(sources,{filledOnly:true}).map((r,i)=>withContext(summary[i],r));
}
export function standardTables(pkg){
  const groups=new Map();
  function add(id,family,name,member,length,main=false){
    if(!length)return;
    if(!groups.has(id))groups.set(id,{id,family,name,members:[],count:0,main});
    const group=groups.get(id);group.members.push({...member,start:group.count});group.count+=length;
  }
  for(const form of pkg.forms)for(const [part,entry] of form.parts){
    if(part.endsWith('-total'))continue;
    const info=partInfo(form.type,part,entry);
    add('spt:'+form.type+':'+info.key,form.type,info.name,{form,part,entry},rowsOf(entry).length,part==='induk');
  }
  const forms=[...groups.values()].sort((a,b)=>order.indexOf(a.family)-order.indexOf(b.family)||Number(a.main)-Number(b.main)||a.id.localeCompare(b.id,'id',{numeric:true}));
  for(const g of forms){g.title=(typeNames[g.family]||g.family)+' · '+g.name;g.rows=()=>formRows(g);}
  groups.clear();
  for(const entry of pkg.entries){
    const code=entry.cap.sumber;
    if(!Object.hasOwn(sources,code)||['sptisi','tabelumum','info'].includes(code))continue;
    add('sumber:'+code,'lain',titles[code]||sources[code],{entry},rowsOf(entry).length);
  }
  const others=[...groups.values()];
  for(const g of others){
    g.title=g.name;g.rows=()=>sourceTableRows(g.members);
  }
  const ledger=combinedLedger(pkg.entries,{includeAnnual:true});
  if(ledger){
    const members=pkg.entries.filter(e=>/^bukubesar\/\d{4}-(?:\d{2}|setahun)\.json$/.test(e.path)).map(entry=>({entry}));
    const origins=[];
    const details=ledger.rows.flatMap((r,i)=>Array.isArray(r.TaxpayerAccountingDetails)?r.TaxpayerAccountingDetails.map((item,j)=>{
      origins.push([...ledger.origins[i],'TaxpayerAccountingDetails',j]);return {
      'Referensi induk':r.ReferenceNumber??null,'Jenis transaksi induk':r.AccountingTypeCode??null,'KAP induk':r.RevenueCode??null,...item
    };}):[]);
    if(details.length)others.unshift({id:'buku-rincian',family:'lain',title:'Buku besar · Rincian per transaksi',count:details.length,members,origin:i=>origins[i],rows:()=>presentRows(details,{filledOnly:true})});
    others.unshift({id:'buku-gabungan',family:'lain',title:'Buku besar gabungan',count:ledger.rows.length,
      members,note:ledger.sourceCount+' berkas buku besar. '+ledger.omitted+' salinan identik digabung. '+ledger.conflicting+' nomor rekaman memiliki isi berbeda.',
      hasFlagDetails:true,origin:i=>ledger.origins[i],rows:(showFlags=false)=>ledgerRows(ledger,showFlags)});
  }
  const tables=[...forms,...others];
  for(const table of tables)if(!table.origin)table.origin=index=>{
    const member=table.members.findLast(m=>m.start<=index);
    return [member.entry.path,index-member.start];
  };
  return tables;
}
