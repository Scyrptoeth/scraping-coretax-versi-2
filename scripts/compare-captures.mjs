import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {normalizeId,sources} from '../extension/app-data.js';
import {inPeriod,matchedSptDocument,matchSptVersions,periodOf,planSptDetails,rangeIsValid,sptListContext} from '../extension/app-spt-plan.js';
import {readPackage} from '../extension/archive/package.js';
import {rowsOf} from '../extension/analisis/model.js';
import {sourceAmount} from '../extension/analisis/withholding-forms.js';

function rowKey(row){
  return JSON.stringify(row,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}

function readableRows(entry){
  if(!entry.pages.length||entry.pages.some(p=>p==null||p.IsSuccessful===false||p.Errors?.length||p.Payload===null))return null;
  return rowsOf(entry);
}

function rowCounts(rows){
  const counts=new Map();
  for(const row of rows){
    const key=rowKey(row);
    counts.set(key,(counts.get(key)||0)+1);
  }
  return counts;
}

function matchedRows(first,second){
  const available=rowCounts(second);
  let matched=0;
  for(const [key,count] of rowCounts(first))matched+=Math.min(count,available.get(key)??0);
  return matched;
}

function comparisonCounts(reference,candidate,first,second){
  const matched=matchedRows(first,second);
  return {acuan:reference.length,pembanding:candidate.length,cocok:matched,
    berbedaAcuan:first.length-matched,berbedaPembanding:second.length-matched,
    belumDapatDipasangkanAcuan:reference.length-first.length,belumDapatDipasangkanPembanding:candidate.length-second.length};
}

function comparableReturns(rows){
  const records=[];
  for(const row of rows){
    const {type,period,revision,typeConflict}=sptListContext(row);
    if(!type||!period||revision===null||typeConflict)continue;
    const receipts=[row.BpsNo,row['Nomor Bukti Penerimaan']].map(value=>String(value??'').trim())
      .filter(value=>value&&!/^[-–—]+$/.test(value));
    if(new Set(receipts).size>1)continue;
    records.push([type,period.label,revision,receipts[0]??'']);
  }
  return records;
}

function compareReturnLists(reference,candidate){
  return comparisonCounts(reference,candidate,comparableReturns(reference),comparableReturns(candidate));
}

function comparableDocuments(rows){
  const field=value=>{
    const text=String(value??'').trim();
    return /^[-–—]+$/.test(text)?'':text;
  };
  return rows.flatMap(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))return [];
    // The number visible in the Coretax document list is the letter number.
    const number=field(row.LetterNumber??row['NOMOR DOKUMEN']);
    const title=field(row.DocumentTitle??row['JUDUL DOKUMEN']);
    if(!number||!title)return [];
    return [[number,title,field(row.CaseNumber??row['NOMOR KASUS'])]];
  });
}

function displayedAmount(value){
  if(typeof value==='number')return sourceAmount(value);
  const text=String(value??'').trim();
  if(!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text))return null;
  return sourceAmount(text.replaceAll('.','').replace(',','.'));
}

function ledgerTransaction(row){
  if(!row||typeof row!=='object')return null;
  const number=String(row.TransactionNumber??row['Nomor Transaksi']??'').trim();
  const amount=Object.hasOwn(row,'Amount')?sourceAmount(row.Amount):displayedAmount(row.Jumlah);
  return number&&!/^[-–—]+$/.test(number)&&amount!==null?[number,amount]:null;
}

function ledgerRows(rows,withReference){
  return rows.flatMap(row=>{
    const transaction=ledgerTransaction(row);
    if(!transaction)return [];
    const reference=String(row.ReferenceNumber??row.Referensi??'').trim();
    if(withReference&&(!reference||/^[-–—]+$/.test(reference)))return [];
    return [withReference?[...transaction,reference]:transaction];
  });
}

function compareDisplayedReferences(reference,candidate){
  const key=row=>{const transaction=ledgerTransaction(row);return transaction?rowKey(transaction):null;};
  const ref=Map.groupBy(reference,key),own=Map.groupBy(candidate,key);
  const result={cocokNomorRujukan:0,cocokKolomReferensi:0,berbeda:0,belumDapatDibandingkan:0};
  for(const [id,rows] of own){
    const other=ref.get(id);
    const referenceShown=rows[0]?.Referensi;
    if(!id||rows.length!==1||other?.length!==1||typeof referenceShown!=='string'||!referenceShown.trim()||
       /^[-–—]+$/.test(referenceShown.trim())){
      result.belumDapatDibandingkan+=rows.length;continue;
    }
    const displayed=referenceShown.trim(),raw=other[0];
    if(String(raw.ReferenceNumber??'').trim()===displayed)result.cocokNomorRujukan++;
    else if(typeof raw.Reference==='string'&&raw.Reference.trim()===displayed)result.cocokKolomReferensi++;
    else if(raw.ReferenceNumber||raw.Reference)result.berbeda++;
    else result.belumDapatDibandingkan++;
  }
  return result;
}

function compareLedgerTotals(reference,candidate){
  const fields=[['Debit','Debit'],['Credit','Kredit'],['DebitLeft','Debit Tersisa'],['CreditLeft','Kredit Tersisa'],['Balance','Saldo']];
  const amount=(row,native,displayed)=>Object.hasOwn(row,'Balance')?sourceAmount(row[native]):displayedAmount(row[displayed]);
  return ['Total','Filtered'].flatMap(group=>{
    const left=reference.filter(r=>r?.Key===group),right=candidate.filter(r=>r?.Key===group);
    if(!left.length&&!right.length)return [];
    if(left.length!==1||right.length!==1)
      return [{kelompok:group,barisAcuan:left.length,barisPembanding:right.length,angkaDapatDibandingkan:0,angkaCocok:0}];
    let comparable=0,matched=0;
    for(const [native,displayed] of fields){
      const a=amount(left[0],native,displayed),b=amount(right[0],native,displayed);
      if(a===null||b===null)continue;
      comparable++;
      if(a===b)matched++;
    }
    return [{kelompok:group,angkaDapatDibandingkan:comparable,angkaCocok:matched}];
  });
}

function compareSelection(first,second){
  if(!Array.isArray(first)||!Array.isArray(second))return 'Tidak dapat dipastikan';
  return isDeepStrictEqual(new Set(first),new Set(second))?'Sama':'Berbeda';
}

function sharedPeriod(first,second){
  const month=value=>value.y*12+value.m;
  const from=month(first.from)>month(second.from)?first.from:second.from;
  const to=month(first.to)<month(second.to)?first.to:second.to;
  return rangeIsValid({from,to})?{from,to}:null;
}

function rowsInPeriod(rows,range){
  return rows.filter(row=>{
    const {type,period}=sptListContext(row);
    const annual=isAnnualReturn(type);
    return period&&inPeriod(period,annual,range);
  });
}

const isAnnualReturn=type=>type==='ICT_RCITR'||type==='ICT_PITR';
const sptSlot=doc=>rowKey([doc.type,doc.period,doc.revision]);

function indexedSptParts(pkg,wp,period){
  const indexes=pkg.entries.filter(e=>e.cap.sumber==='sptdaftar'&&e.path==='spt/daftar.json');
  const linked=pkg.entries.filter(e=>e.cap.sumber==='sptisi'&&e.cap.konteks?.spt?.dariTautanDaftar);
  const {documents}=planSptDetails({wp,period,items:[...indexes,...linked],strictReceipts:true});
  const versions=new Map(documents.map(doc=>[sptSlot(doc),doc]));
  const formNumbers=new Map();
  for(const row of indexes.flatMap(e=>readableRows(e)??[])){
    if(typeof row?.RecordId!=='string'||typeof row.ReturnSheetNumber!=='string')continue;
    if(!formNumbers.has(row.RecordId))formNumbers.set(row.RecordId,new Set());
    formNumbers.get(row.RecordId).add(row.ReturnSheetNumber);
  }
  const parts=[],unscoped=[];
  for(const entry of pkg.entries.filter(e=>e.cap.sumber==='sptisi')){
    const context=entry.cap.konteks,spt=context?.spt;
    const annual=isAnnualReturn(spt?.jenis),observed=periodOf(spt?.masa,annual);
    if(!observed){unscoped.push(entry);continue;}
    if(!inPeriod(observed,annual,period))continue;
    if(entry.cap.cuplikanSpt?.utama&&entry.cap.cuplikanSpt.utama!==entry.path)continue;
    const formNumber=formNumbers.get(spt.recordId);
    // An SPT form number in a native package is different from its receipt number.
    const identified=formNumber?.size===1&&formNumber.has(spt.nomor)
      ?{...entry,cap:{...entry.cap,konteks:{...context,spt:{...spt,nomor:''}}}}
      :entry;
    parts.push({entry,doc:matchedSptDocument(identified,wp,versions),part:context.bagian});
  }
  return {parts,unscoped:unscoped.length,versions};
}

function sameListedVersion(first,second){
  if(matchSptVersions(first,second))return true;
  if(first.key!==second?.key||Boolean(first.recordId)===Boolean(second.recordId))return false;
  const [native,visible]=first.recordId?[first,second]:[second,first];
  const fields=visible.receiptFields??{};
  // The official list's visible receipt column corresponds to BpsNo.
  return Object.keys(fields).length===1&&Boolean(fields.label&&fields.label===native.receiptFields?.bps);
}

function comparableWithholding(rows){
  return rows.flatMap(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))return [];
    const number=String(row.WithholdingNumber??row.WithholdingSlipsNumber??row['NOMOR BUKTI POTONG']??'').trim();
    const code=String(row.TaxObjectCode??row['KODE OBJEK PAJAK']??'').trim();
    const gross=Object.hasOwn(row,'GrossIncome')?sourceAmount(row.GrossIncome):displayedAmount(row['PENGHASILAN BRUTO (Rp)']);
    const tax=Object.hasOwn(row,'IncomeTax')?sourceAmount(row.IncomeTax):displayedAmount(row['PAJAK PENGHASILAN (Rp)']);
    return number&&code&&!/^[-–—]+$/.test(number)&&!/^[-–—]+$/.test(code)&&gross!==null&&tax!==null
      ?[[number,code,gross,tax]]:[];
  });
}

function compareSptParts(reference,candidate,wp,period){
  const acuan=indexedSptParts(reference,wp,period),pembanding=indexedSptParts(candidate,wp,period);
  const comparableVersions=[...acuan.versions].filter(([slot,doc])=>sameListedVersion(doc,pembanding.versions.get(slot)));
  const result={versiAcuan:acuan.versions.size,versiPembanding:pembanding.versions.size,versiCocok:comparableVersions.length,
    berkasTanpaMasaAcuan:acuan.unscoped,berkasTanpaMasaPembanding:pembanding.unscoped,bagian:{}};
  const shared=new Set(comparableVersions.map(([slot])=>slot));
  const kindOf=item=>item.part==='induk'?'induk':'lampiran';
  const key=item=>item.doc&&rowKey([sptSlot(item.doc),item.part]);
  for(const kind of ['induk','lampiran']){
    const left=acuan.parts.filter(item=>kindOf(item)===kind),right=pembanding.parts.filter(item=>kindOf(item)===kind);
    const a=Map.groupBy(left,key),b=Map.groupBy(right,key);
    const summary={acuan:left.length,pembanding:right.length,berpasangan:0,barisSama:0,barisBerbeda:0,
      barisBelumDapatDibandingkan:0,tanpaIdentitasAcuan:a.get(null)?.length??0,tanpaIdentitasPembanding:b.get(null)?.length??0};
    for(const [id,l] of a){
      const r=b.get(id);
      if(!id||l.length!==1||r?.length!==1||!shared.has(sptSlot(l[0].doc)))continue;
      summary.berpasangan++;
      const first=readableRows(l[0].entry),second=readableRows(r[0].entry);
      if(!first||!second)summary.barisBelumDapatDibandingkan++;
      else if(isDeepStrictEqual(rowCounts(first),rowCounts(second)))summary.barisSama++;
      else summary.barisBerbeda++;
      if(kind==='lampiran'&&l[0].doc.type==='ICT_WITR'&&first&&second){
        const counts=comparisonCounts(first,second,comparableWithholding(first),comparableWithholding(second));
        const aggregate=summary.pencocokanBuktiPotong??={berkas:0};
        aggregate.berkas++;
        for(const [field,count] of Object.entries(counts))aggregate[field]=(aggregate[field]??0)+count;
      }
    }
    result.bagian[kind]=summary;
  }
  return result;
}

// Compare source paths and separately match SPT versions with their directory evidence.
export function compareCaptures(reference,candidate){
  if(!reference.report.valid||!candidate.report.valid)throw Error('Integritas kedua paket harus terverifikasi.');
  const wp=normalizeId(reference.manifest.wp?.npwp);
  if(!wp||/^0+$/.test(wp)||wp!==normalizeId(candidate.manifest.wp?.npwp))throw Error('Kedua paket harus mencantumkan NPWP yang sama.');
  const period=p=>p.manifest.opsi?.periode;
  const first=period(reference),second=period(candidate);
  const periodsKnown=rangeIsValid(first)&&rangeIsValid(second);
  const differentPeriods=periodsKnown&&!isDeepStrictEqual(first,second);
  const overlap=differentPeriods?sharedPeriod(first,second):null;
  const referenceSelection=reference.manifest.opsi??{},candidateSelection=candidate.manifest.opsi??{};
  const selection={};
  for(const [key,label] of [['sumber','sumberPilihan'],['jenisSpt','jenisSptPilihan']]){
    if(referenceSelection[key]!==undefined||candidateSelection[key]!==undefined)
      selection[label]=compareSelection(referenceSelection[key],candidateSelection[key]);
  }
  const a=new Map(reference.entries.map(e=>[e.path,e])),b=new Map(candidate.entries.map(e=>[e.path,e]));
  const groups=new Map();
  for(const path of new Set([...a.keys(),...b.keys()])){
    const ref=a.get(path),own=b.get(path),id=(ref||own).cap.sumber;
    const source=Object.hasOwn(sources,id)?sources[id]:id==='cari2'?'Identitas WP dari pencarian':'Sumber lain';
    if(!groups.has(source))groups.set(source,{sumber:source,hanyaAcuan:0,hanyaPembanding:0,berpasangan:0,
      kodeSumberBerbeda:0,responsSama:0,barisSama:0,barisBerbeda:0,barisBelumDapatDibandingkan:0});
    const item=groups.get(source);
    if(!own){item.hanyaAcuan++;continue;}
    if(!ref){item.hanyaPembanding++;continue;}
    item.berpasangan++;
    if(ref.cap.sumber!==own.cap.sumber){item.kodeSumberBerbeda++;item.barisBelumDapatDibandingkan++;continue;}
    if(isDeepStrictEqual(ref.pages,own.pages))item.responsSama++;
    const refRows=readableRows(ref),ownRows=readableRows(own);
    if(!refRows||!ownRows)item.barisBelumDapatDibandingkan++;
    else {
      if(isDeepStrictEqual(rowCounts(refRows),rowCounts(ownRows)))item.barisSama++;
      else item.barisBerbeda++;
      if(id==='sptdaftar'&&path==='spt/daftar.json'){
        item.pencocokanDaftar=compareReturnLists(refRows,ownRows);
        if(overlap)item.pencocokanDaftarPeriodeBersama=compareReturnLists(rowsInPeriod(refRows,overlap),rowsInPeriod(ownRows,overlap));
      }
      if(id==='dokumen'&&path==='profil/dokumen.json'){
        item.pencocokanDokumen=comparisonCounts(refRows,ownRows,comparableDocuments(refRows),comparableDocuments(ownRows));
      }
      const ledgerPeriod=/^bukubesar(?:-total)?\/((?:19|20)\d{2}-(?:0[1-9]|1[0-2]|setahun|\d{8}))\.json$/.exec(path)?.[1];
      if(ledgerPeriod&&id==='bb'){
        (item.pencocokanBukuBesar??=[]).push({masa:ledgerPeriod,
          nomorDanJumlah:comparisonCounts(refRows,ownRows,ledgerRows(refRows,false),ledgerRows(ownRows,false)),
          termasukNomorRujukan:comparisonCounts(refRows,ownRows,ledgerRows(refRows,true),ledgerRows(ownRows,true)),
          referensiTampilan:compareDisplayedReferences(refRows,ownRows)});
      }
      if((ledgerPeriod&&id==='bbtotal')||(path==='bukubesar-saldo.json'&&id==='bbsaldo')){
        (item.pencocokanSaldo??=[]).push({masa:ledgerPeriod??'Seluruh periode',baris:compareLedgerTotals(refRows,ownRows)});
      }
    }
  }
  const common=overlap??(periodsKnown&&!differentPeriods?first:null);
  const details=common&&[...reference.entries,...candidate.entries].some(e=>e.cap.sumber==='sptisi')
    ?{rincianSptPeriodeBersama:compareSptParts(reference,candidate,wp,common)}:{};
  return {berkasAcuan:a.size,berkasPembanding:b.size,periodePilihan:periodsKnown?(differentPeriods?'Berbeda':'Sama'):'Tidak dapat dipastikan',
    ...(differentPeriods?{periodeBersama:overlap}:{}),
    ...selection,...details,perSumber:[...groups.values()].sort((a,b)=>a.sumber.localeCompare(b.sumber,'id'))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const paths=process.argv.slice(2);
    if(paths.length!==2)throw Error('Gunakan node scripts/compare-captures.mjs acuan.zip pembanding.zip');
    const packages=[];
    for(const path of paths){
      try{packages.push(await readPackage(await readFile(path)));}
      catch{throw Error('Berkas tidak dapat dibuka. Pilih dua ZIP CAP-PAKET yang dapat dibaca tanpa kata sandi.');}
    }
    console.log(JSON.stringify(compareCaptures(...packages),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
