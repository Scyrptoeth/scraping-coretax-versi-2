import {checkIdentity, forms, normalizeId, rowsOf} from './app-data.js';
import {appendPackageEntry, isSptList, listRowType} from './app-package-entries.js';
import {stageSptSource,queuedSptEvidence,filteredSptSource} from './app-spt-snapshots.js';

const months = 'januari februari maret april mei juni juli agustus september oktober november desember'.split(' ');
const annualTypes = new Set(['ICT_RCITR', 'ICT_PITR']);
const keyOf = (...values) => JSON.stringify(values);
const labelKey = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
const textValue = value => ['number','string'].includes(typeof value) ? String(value).trim() : '';
const referenceValue = value => !value || /^(?:[-–—]+|n\/?a|null|tidak ada)$/i.test(value) ? '' : value;

function columns(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [labelKey(key), textValue(value)]));
}
function revisionOf(value) {
  if (/^normal$/i.test(value)) return 0;
  const match = /^(?:(?:amendment|pembetulan)(?:\s+ke)?[\s-]*)?(\d{1,3})$/i.exec(value);
  return match ? Number(match[1]) : null;
}
export function periodOf(value, annual) {
  const input = String(value || '').trim().toLowerCase();
  let year, first, last;
  let match = /^(\d{2})(\d{2})((?:19|20)\d{2})$/.exec(input);
  if (match) [, first, last, year] = match;
  else if ((match = /^((?:19|20)\d{2})(?:-(\d{2}))?$/.exec(input))) {
    [,year,first] = match;
    last = first;
  } else {
    match = /^([a-z]+|\d{1,2})(?:\s*[-–]\s*([a-z]+|\d{1,2}))?[\s/-]+((?:19|20)\d{2})$/.exec(input);
    if (!match) return null;
    const month = word => /^\d+$/.test(word) ? Number(word) : months.indexOf(word) + 1;
    first = month(match[1]); last = month(match[2] || match[1]); year = match[3];
  }
  if (first === undefined && annual) { first = 1; last = 12; }
  first = Number(first); last = Number(last);
  if (!(first >= 1 && first <= 12 && last >= 1 && last <= 12) || (!annual && first > last)) return null;
  const two = month => String(month).padStart(2,'0');
  const label = annual && first === 1 && last === 12 ? year :
    first === last ? year + '-' + two(first) : year + '-' + two(first) + '/' + two(last);
  return {label, year:Number(year), first, last};
}
export function inPeriod(value, annual, range) {
  if (annual) return value.year >= range.from.y && value.year <= range.to.y;
  const monthIndex = (y,m) => y * 12 + m;
  return monthIndex(value.year, value.last) >= monthIndex(range.from.y, range.from.m) &&
    monthIndex(value.year, value.first) <= monthIndex(range.to.y, range.to.m);
}
export function rangeIsValid(range) {
  const valid = p => Number.isInteger(p?.y) && p.y >= 1900 && p.y < 2100 &&
    Number.isInteger(p.m) && p.m >= 1 && p.m <= 12;
  return valid(range?.from) && valid(range?.to) &&
    range.from.y * 12 + range.from.m <= range.to.y * 12 + range.to.m;
}
function ownsRow(row, owner) {
  try { checkIdentity([row],owner); return true; }
  catch { return false; }
}
function combineReceiptFields(a,b){
  if(Object.keys(a).some(k=>b[k] && a[k]!==b[k]))return null;
  const fields={...a,...b};
  if(new Set(Object.values(fields)).size>1 && (!fields.document || !fields.bps ||
      fields.label && fields.label!==fields.document && fields.label!==fields.bps))return null;
  return fields;
}
export function matchSptVersions(a,b){
  if(!a || !b || a.key!==b.key || a.recordId && b.recordId && a.recordId!==b.recordId)return null;
  const fieldsOf=d=>d.receiptFields || (d.receipt?{label:d.receipt}:{});
  const fields=combineReceiptFields(fieldsOf(a),fieldsOf(b));
  if(!fields)return null;
  const sameRecord=Boolean(a.recordId && a.recordId===b.recordId && a.recordVerified!==false && b.recordVerified!==false);
  if(!sameRecord && (new Set(Object.values(fields)).size>1 || !a.receipt || a.receipt!==b.receipt))return null;
  return {...a,receiptFields:fields,recordVerified:sameRecord};
}
export function sptListContext(row, c = columns(row)) {
  const type = listRowType(row);
  const typeKeys = ['returnsheettypecode','taxreturntypecode','jenisspt','jenissuratpemberitahuanpajak'];
  const declaredTypes = new Set(typeKeys.filter(k => c[k]).map(k => listRowType({[k]:c[k]}) || c[k]));
  const form = type || c.returnsheettypecode || c.taxreturntypecode || c.jenisspt || c.jenissuratpemberitahuanpajak || '';
  const date = c.taxperiodcode || c.masapajak || c.periodepajak || c.taxperiod || c.tahunpajak || c.taxyear;
  const period = periodOf(date,annualTypes.has(type));
  const models = [c.returnsheetmodel,c.modelspt,c.jenismodelspt,c.pembetulanke,c.pembetulan,c.amendmentnumber].filter(Boolean);
  const revisions = new Set(models.map(revisionOf));
  return {type,form,date,period,amendment:models[0],revision:revisions.size === 1 ? revisionOf(models[0]) : null,
    typeConflict:declaredTypes.size > 1,revisionConflict:revisions.size > 1};
}
function readIndex(row, owner, strictReceipts) {
  const c = columns(row);
  const {type,form,date,period,amendment,revision,typeConflict,revisionConflict} = sptListContext(row,c);
  const records = new Set([c.recordid,c.taxreturnrecordid,c.idrekamspt,c.idspt].map(referenceValue).filter(Boolean));
  const record = [...records][0] || '';
  const receiptFields={};let refsConflict=false;
  for(const [column,values] of [['document',[c.documentreceiptnumber,c.nomorpenerimaandokumen]],['bps',[c.bpsno,c.nomorbps]],
    ['label',[c.nomorbuktitandaterima,c.nomorbuktipenerimaan,c.nomortandaterima,c.nomorbpe]]]){
    const distinct=[...new Set(values.map(referenceValue).filter(Boolean))];
    if(distinct.length)receiptFields[column]=distinct[0];
    if(distinct.length>1)refsConflict=true;
  }
  if(!combineReceiptFields({},receiptFields) || !record && new Set(Object.values(receiptFields)).size>1)refsConflict=true;
  const receipt=receiptFields.document || receiptFields.bps || receiptFields.label || '';
  const fingerprint = record || receipt ? keyOf(owner,form,period?.label || date,revision ?? amendment,record,receiptFields) : null;
  return {type, period, revision, record, receipt, receiptFields, fingerprint,
    conflict:typeConflict || records.size>1 || strictReceipts && refsConflict || revisionConflict};
}
function partEvidence(item, wp, failed, reusable=false) {
  if (item.source === 'sptisi') {
    if (!item.page || rowsOf(item.page).some(row => !ownsRow(row,wp))) return null;
    const groups = new Map();
    appendPackageEntry(groups,item,wp);
    item = [...groups.values()][0];
  }
  const ctx = item.cap?.konteks, spt = ctx?.spt;
  if (!spt || !(spt.recordId || referenceValue(textValue(spt.nomor))) ||
      normalizeId(ctx.npwp) !== wp || (spt.npwp && normalizeId(spt.npwp) !== wp)) return null;
  const period = periodOf(spt.masa, annualTypes.has(spt.jenis));
  const revision = revisionOf(spt.pemb ?? spt.model);
  const part = textValue(ctx.bagian).toLowerCase();
  if (!period || revision === null || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(part)) return null;
  const pages = Array.isArray(item.pages) ? item.pages : [];
  const error = failed || pages.some(p => p?.IsSuccessful === false || p?.Errors?.length);
  const ready = !error && (item.cap.lengkap === true || reusable) && !filteredSptSource(item.cap.payload) && pages.length > 0 &&
    pages.every(p => p && typeof p === 'object' && p.Payload != null);
  return {slot:keyOf(spt.jenis,period.label,revision),record:textValue(spt.recordId),receipt:referenceValue(textValue(spt.nomor)),part,
    status:error ? 'retry' : ready ? 'ready' : 'pending'};
}
function sameDocument(doc,part){
  const fields=doc.receiptFields;
  if(fields?.document && fields.bps && fields.document!==fields.bps)
    return Boolean(doc.recordId && doc.recordId===part.record && (!part.receipt || Object.values(fields).includes(part.receipt)));
  return !(doc.receipt && part.receipt && doc.receipt!==part.receipt) &&
    (doc.recordId && part.record?doc.recordId===part.record:doc.receipt && doc.receipt===part.receipt);
}
export function matchedSptDocument(item,wp,versions){
  if(!item?.cap?.konteks)return null;
  const part=partEvidence(item,wp,false),doc=part && versions.get(part.slot);
  return doc && sameDocument(doc,part)?doc:null;
}

// Plans from material already present. Every attachment requires a source naming that section.
// Optional failures use the same cap.konteks.spt and cap.konteks.bagian as a capture.
export function planSptDetails({wp,period,types = forms.map(([type]) => type),items = [],failures = [],strictReceipts=false}) {
  const owner = normalizeId(wp);
  if (!owner) throw Error('Rencana detail SPT memerlukan satu NPWP.');
  if (!rangeIsValid(period)) throw Error('Periode rencana detail SPT tidak valid.');
  const selected = new Set(types), seen = new Set(), slots = new Map(), referenceSlots = new Map(), evidence = [], staged=new Map(), blocked=new Set();
  const counts = {periods:0, versions:0, unknown:0, outside:0, excludedType:0, conflicts:0, duplicateRows:0,
    missing:0, readyParts:0, pendingParts:0, retryParts:0, drafts:0, failedIndexPages:0, unmatchedParts:0};
  for (const item of items) {
    const source = item.source ?? item.cap?.sumber;
    if (source !== 'sptisi' && !isSptList(source)) continue;
    const pages = item.pages ?? (item.page ? [item.page] : []);
    if (normalizeId(item.wp ?? item.cap?.konteks?.npwp) !== owner) {
      counts.conflicts++;
      continue;
    }
    if (source === 'sptisi') {
      if(item.page && rowsOf(item.page).every(row=>ownsRow(row,owner)) && stageSptSource(staged,item,owner))continue;
      evidence.push(partEvidence(item,owner,false));
      continue;
    }
    for(const part of item.sptObservedParts || [])evidence.push(partEvidence(part,owner,part.failed));
    for (const page of pages) {
      if (page?.IsSuccessful === false) { counts.failedIndexPages++; continue; }
      for (const row of rowsOf(page)) {
        if (!ownsRow(row,owner)) { counts.conflicts++; continue; }
        if (source === 'sptbelum') { counts.drafts++; continue; }
        const data = readIndex(row,owner,strictReceipts);
        if (data.conflict) {
          if(strictReceipts && data.type && data.period && data.revision!==null)blocked.add(keyOf(data.type,data.period.label,data.revision));
          counts.conflicts++;continue;
        }
        if (data.fingerprint && seen.has(data.fingerprint)) { counts.duplicateRows++; continue; }
        if (data.fingerprint) seen.add(data.fingerprint);
        if (!data.period) { counts.missing++; continue; }
        if (!inPeriod(data.period,annualTypes.has(data.type),period)) { counts.outside++; continue; }
        if (!data.type) { counts.unknown++; continue; }
        if (!selected.has(data.type)) { counts.excludedType++; continue; }
        if (data.revision === null || !(data.record || data.receipt)) { counts.missing++; continue; }
        const slot = keyOf(data.type,data.period.label,data.revision);
        if (!slots.has(slot)) slots.set(slot,{type:data.type,period:data.period.label,revision:data.revision,
          records:new Set(),nativeReceipts:new Set(),receipts:new Set(),receiptFields:{},fieldConflict:false,rows:0});
        const group = slots.get(slot);
        group.rows++;
        const merged=combineReceiptFields(group.receiptFields,data.receiptFields);
        if(merged)group.receiptFields=merged;else group.fieldConflict=true;
        if (data.record) {
          group.records.add(data.record);
          if (data.receipt) group.nativeReceipts.add(data.receipt);
        } else group.receipts.add(data.receipt);
        for (const [kind,ref] of [['record',data.record],['receipt',data.receipt]]) if (ref) {
          const identifier = keyOf(kind,ref,data.revision);
          if (!referenceSlots.has(identifier)) referenceSlots.set(identifier,new Set());
          referenceSlots.get(identifier).add(slot);
        }
      }
    }
  }
  for (const associations of referenceSlots.values()) if (associations.size > 1) {
    for (const slot of associations) blocked.add(slot);
  }
  const documents = [], bySlot = new Map(), periods = new Set();
  for (const [slot,group] of slots) {
    const [recordId] = group.records, [receipt] = group.receipts;
    const conflict = recordId ? group.records.size > 1 || [...group.receipts].some(r => !group.nativeReceipts.has(r)) :
      group.receipts.size > 1;
    if (conflict || strictReceipts && group.fieldConflict || blocked.has(slot)) { counts.conflicts++; continue; }
    // A receipt-only sighting can later acquire a record ID without changing the plan's key.
    const key = keyOf(owner,group.type,group.period,group.revision);
    const doc = {key,type:group.type,period:group.period,revision:group.revision,recordId:recordId || null,
      receipt:receipt || [...group.nativeReceipts].sort()[0] || null,parts:[],
      ...(!group.fieldConflict?{receiptFields:group.receiptFields}:{})};
    const sections = new Map([['induk','pending']]);
    bySlot.set(slot,{doc,sections});
    documents.push(doc);
    periods.add(keyOf(group.type,group.period));
    counts.duplicateRows += group.rows-1;
  }
  const statusRank = {pending:0,retry:1,ready:2};
  for(const samples of staged.values()){
    const {primary,reusable}=queuedSptEvidence(samples);
    evidence.push(partEvidence(primary,owner,false,reusable));
  }
  for (const failed of failures) evidence.push(partEvidence(failed,owner,true));
  for (const part of evidence) {
    const group = part && bySlot.get(part.slot);
    const matches = group && sameDocument(group.doc,part);
    if (!matches) { counts.unmatchedParts++; continue; }
    const old = group.sections.get(part.part);
    if (!old || statusRank[part.status] > statusRank[old]) group.sections.set(part.part, part.status);
  }
  for (const {doc,sections} of bySlot.values()) {
    const names = ['induk',...[...sections.keys()].filter(k => k !== 'induk').sort()];
    for (const name of names) {
      const status = sections.get(name);
      doc.parts.push({name,key:keyOf(doc.key,name),dependsOn:name === 'induk' ? [] : [keyOf(doc.key,'induk')],status});
      counts[status+'Parts']++;
    }
  }
  documents.sort((a,b) => a.type.localeCompare(b.type) || a.period.localeCompare(b.period) || a.revision-b.revision || a.key.localeCompare(b.key));
  counts.periods = periods.size; counts.versions = documents.length;
  return {documents,counts};
}
