import {normalizeId} from '../app-data.js';
import {rowsOf,sptDay,submittedDay,typeNames} from './model.js';
import {listedReturns,revisionProblem,sourceProblem,usesOtherCurrency} from './return-source.js';
import {monthIsComplete} from './temporary-findings-installments.js';
import {directBusinessDay,directLaw,directRelief,paymentDeadline,paymentInterest} from './direct-finding-calendar.js';
import {monthlyAccounts as accounts} from './direct-finding-transfers.js';

const kinds={PPN:'VAT_VATR',PPH2126:'ICT_WITR',UNIFIKASI:'ICT_WTR'};
const size=value=>Number.isSafeInteger(value)&&value>=0;
const declaredColumns=['Jenis pajak','Masa','Peristiwa','Tanggal sumber','Jatuh tempo','Dasar penghitungan (Rp)',
  'Bulan','Tarif per bulan (%)','Estimasi sanksi (Rp)','Sudah tercatat (Rp)','Sisa pokok tercatat (Rp)','Sumber','Keterangan'];
function completeSource(pkg,e,owner){
  if(!e||!owner||normalizeId(e.cap?.konteks?.npwp)!==owner||e.cap.lengkap!==true||!e.pages?.length||
    e.pages.some(p=>!p||p.IsSuccessful===false||p.Errors?.length)||Number(e.cap.payload?.First)>0||e.cap.payload?.Filters?.length||
    e.cap.halamanSumber?.some(s=>s?.pencocokan?.morePagesAvailable)||usesOtherCurrency(e.cap,e.cap.konteks))return false;
  const failures=pkg.manifest.gagal||[];
  if(failures.some(f=>[e.path,'data/'+e.path].includes(typeof f==='string'?f:f?.path)))return false;
  if(e.cap.halaman!=null&&Number(e.cap.halaman)!==e.pages.length)return false;
  const n=rowsOf(e).length;
  return [e.cap.baris,e.cap.total,...e.pages.map(p=>p.Payload?.TotalRecords)].filter(v=>v!=null).every(v=>Number(v)===n);
}
function monthlyLedger(pkg,period,owner){
  const entries=(pkg.entries||[]).filter(e=>e.path==='bukubesar/'+period+'.json');
  if(entries.length!==1)return null;
  const e=entries[0],m=period.slice(5),y=period.slice(0,4),code=m+m+y;
  if(!monthIsComplete(pkg,e,owner,y,m,code)||usesOtherCurrency(e.cap,e.cap.konteks))return null;
  const byId=new Map();
  for(const r of rowsOf(e)){
    if(String(r.PeriodCode)!==code||r.IsCancelled===true)continue;
    if(r.IsCancelled!==false||!r.RecordId||usesOtherCurrency(r)||[r.TaxpayerTIN,r.TaxpayerIdentificationNumber,r.TIN].filter(Boolean).some(v=>normalizeId(v)!==owner))return null;
    const existing=byId.get(r.RecordId);
    if(existing&&JSON.stringify(existing)!==JSON.stringify(r))return null;
    byId.set(r.RecordId,r);
  }
  return {rows:[...byId.values()],path:e.path};
}
function recordedNotice(ledger,form,article,nominal){
  if(!ledger)return {note:'Buku besar bulan ini belum terkonfirmasi. Periksa STP yang sudah dibukukan.',held:true};
  const notices=ledger.rows.filter(r=>r.AccountingTypeCode==='TaxNotice'&&accounts[form.type].includes(String(r.RevenueCode)));
  const lawMarker=article==='filing'?/\b(?:pasal|ps\.?)\s*7\b/i:/\b(?:pasal|ps\.?)\s*9\b/i;
  const matched=notices.filter(r=>lawMarker.test(String(r.RevenueCodeDescription))&&r.Amount===-nominal&&r.ReferenceNumber);
  if(matched.length===1)return {booked:nominal,held:true,note:'STP dengan pasal, masa, jenis pajak dan nominal yang sama sudah tercatat. Cocokkan nomor STP sebelum menindaklanjuti.',ref:matched[0].RecordId};
  const otherArticle=article==='filing'?/\b(?:pasal|ps\.?)\s*9\b/i:/\b(?:pasal|ps\.?)\s*7\b/i;
  if(notices.some(r=>!otherArticle.test(String(r.RevenueCodeDescription))))return {held:true,note:'Ada STP pada jenis pajak dan masa yang sama. Cocokkan dasar dan nominal agar tidak menghitung dua kali.'};
  return {held:false};
}
function submittedEvidence(pkg,form,owner){
  const entry=form.parts?.get('induk');
  if(!entry||sourceProblem(pkg,form,'induk',entry)||normalizeId(entry.cap.konteks?.npwp)!==owner||usesOtherCurrency(form.meta,entry.cap.konteks,
    entry.pages[0]?.Payload,...rowsOf(entry)))return;
  const ctx=entry.cap.konteks?.spt||{},status=form.meta?.ReturnSheetStatusCode||ctx.status;
  if(!/^submitted$/i.test(status)||ctx.status&&!/^submitted$/i.test(ctx.status)||
    (form.meta?.ReturnSheetTypeCode&&form.meta.ReturnSheetTypeCode!==kinds[form.type]))return;
  const p=form.period,code=p.slice(5).repeat(2)+p.slice(0,4);
  if(form.meta?.TaxPeriodCode&&form.meta.TaxPeriodCode!==code)return;
  if(form.reportSource===entry.path)return {day:sptDay(ctx.tanggal),due:sptDay(ctx.batas),path:entry.path};
  const source=pkg.entries.find(e=>e.path===form.reportSource);
  if(!completeSource(pkg,source,owner))return;
  const candidates=rowsOf(source).filter(r=>r.RecordId===form.id);
  if(candidates.length!==1)return;
  const [r]=candidates;
  if(r.ReturnSheetTypeCode!==kinds[form.type]||r.TaxPeriodCode!==code||!/^submitted$/i.test(r.ReturnSheetStatusCode)||
    (r.ReturnSheetModel&&!/^normal$/i.test(r.ReturnSheetModel)))return;
  return {day:submittedDay(r),due:sptDay(r.ExpectedReturnDate),path:source.path+' · '+form.id};
}

function genericVatBalanceSource(form,debt,owner){
  if(form.type!=='PPN'||debt.ReferenceType!=='TaxReturn'||debt.AccountingTypeDetailCode!=='N'||!debt.ReferenceNumber)return '';
  const entry=form.parts.get('induk'),bodies=rowsOf(entry),body=bodies[0];
  if(bodies.length!==1||body.VATUnderOrOverPaid?.VAT!==-debt.Amount||
    body.TaxPeriodYear!=null&&Number(body.TaxPeriodYear)!==Number(form.year)||
    body.TaxPeriodMonth!=null&&Number(body.TaxPeriodMonth)!==Number(form.period.slice(5))||
    body.TIN&&normalizeId(body.TIN)!==owner)return '';
  return entry.path+' · VATUnderOrOverPaid.VAT';
}

export function directStp(pkg,year,work={}){
  const rows=[],facts=[],notes=new Set(),ledgerCache=new Map(),unconfirmed=new Map(),lists=new Map(),grouped=new Map(),observations=[];
  const owner=normalizeId(pkg.manifest.wp?.npwp),planned=sptDay(work.simulation?.end),cutoff=sptDay(pkg.manifest.dibuat);
  const table={title:'Pelaporan, setoran, dan STP pada buku besar',columns:declaredColumns,rows};
  function register(f,source,detail,values,kind,id,extra={}){
    const row=[typeNames[f.type],f.period,kind,...values,source,detail];rows.push(row);
    observations.push({newAmount:extra.newAmount,booked:extra.booked,balance:extra.balance});
    if(extra.fact!==false){
      const sourceKey='tl/'+id;
      facts.push({key:sourceKey,sourceKey,kind:typeNames[f.type],period:f.period,detail,source,status:'berbukti',
        amount:null,sanctionAmount:extra.newAmount??null,bookedAmount:extra.booked??null,ledgerBalance:extra.balance??null,
        ...(extra.formKey?{formKey:extra.formKey}:{}),...(extra.ledgerId?{ledgerId:extra.ledgerId}:{})});
    }
  }
  if(!owner||/^0+$/.test(owner)||pkg.report?.valid===false)return {table,facts,notes:['Identitas atau integritas paket belum terkonfirmasi.'],observations};
  for(const f of pkg.forms||[]){
    if(f.year!==String(year)||!Object.hasOwn(accounts,f.type)||!/^(?:19|20)\d\d-(?:0[1-9]|1[0-2])$/.test(f.period))continue;
    const key=f.type+'/'+f.period;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(f);
  }
  for(const [group,versions] of grouped){
    const normal=versions.filter(f=>f.version===0);
    if(normal.length!==1){notes.add(group+' · SPT normal tunggal belum terkonfirmasi.');continue;}
    const f=normal[0],filing=submittedEvidence(pkg,f,owner);
    if(!filing?.day||!filing.due){notes.add(group+' · Status penyampaian, tanggal lapor, atau tanggal batas sumber belum terkonfirmasi.');continue;}
    if(!ledgerCache.has(f.period))ledgerCache.set(f.period,monthlyLedger(pkg,f.period,owner));
    const ledger=ledgerCache.get(f.period),filingDue=directBusinessDay(filing.due);
    if(!filingDue){notes.add(group+' · Kalender hari kerja untuk batas pelaporan belum tersedia.');continue;}
    if(filing.day>filingDue&&(!planned||filing.day<=planned)){
      const relief=directRelief(f.type,f.period,'filing',filing.day);
      const fee=f.type==='PPN'?500000:100000,notice=recordedNotice(ledger,f,'filing',fee);
      const condition=relief?'Masuk periode penghapusan sanksi. Periksa syarat yang berlaku.':notice.note||'Periksa pengecualian Pasal 7 ayat (2), relaksasi dan STP sebelum mengusulkan denda.';
      const source=[filing.path,notice.ref?ledger.path+' · '+notice.ref:'',directLaw.kup,relief].filter(Boolean).join('\n');
      const detail='SPT normal disampaikan pada '+filing.day+' setelah batas '+filingDue+'. '+condition;
      const newAmount=relief||notice.held?null:fee;
      if(relief)notes.add(group+' · '+detail+' '+relief);
      else register(f,source,detail,[filing.day,filingDue,null,null,null,newAmount,notice.booked??null,null],'Tanggal pelaporan SPT','filing/'+group,{formKey:f.key,newAmount,booked:notice.booked});
    }
    if(!ledger){
      if(!unconfirmed.has(f.type))unconfirmed.set(f.type,[]);
      unconfirmed.get(f.type).push(f.period);continue;
    }
    if(!lists.has(f.type))lists.set(f.type,listedReturns(pkg,String(year),kinds[f.type]));
    const listed=lists.get(f.type).get(f.period)||[];
    const amended=versions.length>1||revisionProblem(listed,versions,f);
    const due=paymentDeadline(f.type,f.period);
    if(!due){notes.add(group+' · Batas penyetoran atau kalender masa ini belum didukung.');continue;}
    const entries=ledger.rows.filter(r=>accounts[f.type].includes(String(r.RevenueCode)));
    for(const account of new Set(entries.map(r=>String(r.RevenueCode)))){
      const ledgerGroup=entries.filter(r=>String(r.RevenueCode)===account);
      const liabilities=ledgerGroup.filter(r=>r.AccountingTypeCode==='TaxReturn');
      if(!liabilities.length)continue;
      const [debt]=liabilities;
      if(liabilities.length!==1||!Number.isSafeInteger(debt.Amount)||debt.Amount>=0)continue;
      const genericSource=debt.ReferenceType===kinds[f.type]?'':genericVatBalanceSource(f,debt,owner);
      if(debt.ReferenceType!==kinds[f.type]&&!genericSource)continue;
      if(amended){notes.add(group+' · Ada pembetulan atau daftar versi belum cocok. Periksa alokasi pembayaran ke versi SPT.');continue;}
      const balance=Number.isSafeInteger(debt.AmountLeft)&&debt.AmountLeft<=0?-debt.AmountLeft:null;
      const source=ledger.path+' · '+debt.RecordId;
      if(balance===null||balance> -debt.Amount){notes.add(group+' · Sisa kewajiban belum dapat dicocokkan dengan nilai pembukuan.');continue;}
      if(balance>0&&(!planned||!cutoff||planned>=cutoff)){
        const detail='Buku besar pada tanggal paket masih mencatat sisa kewajiban. Periksa pelunasan, pemindahbukuan dan dasar penagihan. '+(f.type==='PPN'?
          'Pasal 14 ayat (1) huruf a mengatur PPh dalam tahun berjalan.':'PPh pemotongan pada SPT masa ini berbeda dari angsuran PPh Pasal 25.');
        register(f,[source,genericSource].filter(Boolean).join(' · '),detail,[cutoff||null,due,null,null,null,null,null,balance],'Sisa kewajiban tercatat','balance/'+group+'/'+debt.RecordId,
          {ledgerId:debt.RecordId,balance});
      }
      if(genericSource)continue;
      const payments=ledgerGroup.filter(r=>r.AccountingTypeCode==='Payment'&&String(r.PaymentCode)==='100');
      if(!payments.length)continue;
      if(payments.some(r=>!size(r.Amount)||!size(r.AmountLeft)||r.AmountLeft>r.Amount||!sptDay(r.TransactionDate)||!r.ReferenceNumber||r.AccountingTypeDetailCode!=='CASH')||
         new Set(payments.map(r=>r.ReferenceNumber)).size!==payments.length||
         payments.reduce((sum,r)=>sum+r.Amount-r.AmountLeft,0)!== -debt.Amount-balance){
        notes.add(group+' · Setoran kas belum dapat direkonsiliasi terhadap kewajiban, sisa, dan KAP yang sama.');continue;
      }
      for(const pay of payments){
        const day=sptDay(pay.TransactionDate),applied=pay.Amount-pay.AmountLeft;
        if(planned&&day>planned||day<=due||!applied)continue;
        const rawDue=sptDay(pay.DueDate);
        if(rawDue&&directBusinessDay(rawDue)!==due){notes.add(group+' · Tenggat pada setoran berbeda dari kalender umum. Periksa sebelum menghitung bunga.');continue;}
        const interest=paymentInterest(applied,due,day),relief=directRelief(f.type,f.period,'payment',day);
        if(relief){notes.add(group+' · Setoran masuk dalam rentang penghapusan sanksi. '+relief);continue;}
        const notice=recordedNotice(ledger,f,'payment',interest?.amount);
        const amount=notice.held?null:interest?.amount??null;
        const reason=notice.note||(!interest?.source?'Tarif KMK untuk awal keterlambatan belum tersedia.':'Estimasi bunga Pasal 9 ayat (2a). Untuk perbandingan, pecahan rupiah dibulatkan ke bawah per setoran.');
        const detail='Setoran dengan KAP '+account+' dan KJS 100 dilakukan pada '+day+' setelah batas '+due+'. Dasar memakai bagian pembayaran yang sudah terpakai. Cocokkan alokasi terhadap SPT. '+reason;
        const sources=[source,ledger.path+' · '+pay.RecordId,interest?.source].filter(Boolean).join('\n');
        register(f,sources,detail,[day,due,applied,interest?.months??null,interest?.rate??null,amount,notice.booked??null,null],
          'Setoran setelah jatuh tempo','payment/'+group+'/'+pay.RecordId,{newAmount:amount,booked:notice.booked});
      }
    }
  }
  for(const [type,periods] of unconfirmed)notes.add(typeNames[type]+' · Rekonsiliasi setoran kas belum dapat diselesaikan pada '+periods.length+
    ' masa. Periksa kelengkapan dan identitas buku besar pada '+periods.sort().join(', ')+'.');
  return {table,facts,notes:[...notes],observations};
}
