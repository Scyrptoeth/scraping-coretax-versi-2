import {homeLedgerCode} from '../app-home-plan.js';
import {ledgerCancellation} from '../ledger-status.js';
import {rowsOf,sptDay} from './model.js';

export const ledgerTypeLabels={
  Payment:'Pembayaran', TaxReturn:'Surat pemberitahuan', OtherTaxReturn:'Kewajiban pajak lain',
  Adjustment:'Penyesuaian', TaxNotice:'Ketetapan pajak', Refund:'Pengembalian'
};
export const ledgerDetailLabels={
  CASH:'Pembayaran tunai', BT:'Pemindahbukuan', DBP:'Pelaporan melalui pembayaran', N:'SPT normal',
  NOTC:'Surat tagihan pajak', A:'SPT pembetulan', NOTD:'Surat pemberitahuan pajak terutang',
  CF:'Kompensasi SPT', OC:'Kompensasi lebih bayar', NOTA:'Surat ketetapan pajak',
  RD:'Pengembalian dicairkan', RDC:'Pengembalian dicairkan/dikompensasikan', RDP:'Pencairan dalam proses'
};

const displayKey=value=>String(value??'').trim().toLocaleLowerCase('id');
const codeMap=labels=>new Map(Object.entries(labels).map(([code,label])=>[displayKey(label),code]));
const typeCodes=codeMap(ledgerTypeLabels), detailCodes=codeMap(ledgerDetailLabels);
const matchText=(value,pattern)=>String(value??'').trim().match(pattern)?.[0];
const cancellationCodes={active:false,cancelled:true};

export function displayedLedgerAmount(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=String(value??'').trim();
  if(!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text))return null;
  const number=Number(text.replaceAll('.','').replace(',','.'));
  return Number.isFinite(number)?number:null;
}

function displayedDate(value) {
  const text=String(value??'').trim();
  const match=/^(\d{2})-(\d{2})-(\d{4})(?:[ T]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?))?$/.exec(text);
  if(!match)return sptDay(text)?text:null;
  const day=sptDay(match[3]+'-'+match[2]+'-'+match[1]);
  return day ? day+(match[4]?'T'+match[4]:'') : null;
}

const displayedFields=[
  ['Jenis Pencatatan','AccountingTypeCode',value=>typeCodes.get(displayKey(value))],
  ['Detail Jenis Pencatatan','AccountingTypeDetailCode',value=>detailCodes.get(displayKey(value))],
  ['Masa Pajak','PeriodCode',(_,row)=>homeLedgerCode(row)],
  ['Tanggal Posting','PostingDate',displayedDate],
  ['Tanggal Transaksi','TransactionDate',displayedDate],
  ['Tanggal Jatuh Tempo Pembayaran','PaymentDueDate',displayedDate],
  ['Jumlah','Amount',displayedLedgerAmount], ['Nilai Sisa','AmountLeft',displayedLedgerAmount],
  ['KAP','RevenueCode',value=>matchText(value,/^\d{6}$/)], ['KJS','PaymentCode',value=>matchText(value,/^\d{3}$/)],
  ['Mata Uang','CurrencyCode',value=>matchText(value,/^[A-Z]{3}$/)],
  ['Dibatalkan','IsCancelled',value=>cancellationCodes[ledgerCancellation({Dibatalkan:value})]]
];

// Project verified display columns for analysis. The entry still holds the original rows.
export function ledgerAnalysisRow(row) {
  if(!Object.hasOwn(row,'Nomor Transaksi')||!Object.hasOwn(row,'Jenis Pencatatan'))return row;
  const normalized={...row};
  for(const [label,key,interpret] of displayedFields){
    if(!Object.hasOwn(row,label)||Object.hasOwn(row,key))continue;
    const value=interpret(row[label],row);
    if(value==null||value==='')continue;
    normalized[key]=value;
    delete normalized[label];
  }
  return normalized;
}

function orderedValue(value){
  if(Array.isArray(value))return value.map(orderedValue);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,orderedValue(value[k])]));
  return value;
}

export function combinedLedger(entries,{includeAnnual=false}={}){
  const ledger=entries.filter(e=>/^bukubesar\/(?:19|20)\d{2}-(?:0[1-9]|1[0-2])\.json$/.test(e.path)||
    includeAnnual&&/^bukubesar\/(?:19|20)\d{2}-setahun\.json$/.test(e.path))
    .sort((a,b)=>a.path.localeCompare(b.path));
  if(!ledger.length)return null;
  const records=[],byId=new Map(),keys=new Set();
  let omitted=0;
  for(const entry of ledger){
    for(const [position,row] of rowsOf(entry).entries()){
      for(const k of Object.keys(row))keys.add(k);
      const id=row.RecordId;
      if(typeof id==='string' && id.trim()){
        const signature=JSON.stringify(orderedValue(row));
        const versions=byId.get(id) || new Map();
        if(versions.has(signature)){
          versions.get(signature).sources.add(entry.path);
          omitted++;continue;
        }
        const item={row,position,sources:new Set([entry.path])};
        versions.set(signature,item);byId.set(id,versions);records.push(item);
      }else records.push({row,position,sources:new Set([entry.path])});
    }
  }
  let sourceColumn='Berkas sumber';
  while(keys.has(sourceColumn))sourceColumn+=' (paket)';
  return {rows:records.map(({row,sources})=>({...row,[sourceColumn]:[...sources].join(', ')})),sourceColumn,
    origins:records.map(({sources,position})=>[[...sources][0],position]),omitted,
    conflicting:[...byId.values()].filter(versions=>versions.size>1).length,sourceCount:ledger.length};
}
