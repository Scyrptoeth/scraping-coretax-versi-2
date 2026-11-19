import {checkIdentity, forms, normalizeId, readCaptureId, sources as knownSources} from './app-data.js';
import {isSptList, isWithholdingKind, listRowType} from './app-package-entries.js';
import {inPeriod, periodOf, rangeIsValid} from './app-spt-plan.js';

const formIds = forms.map(([id]) => id);
const annualForms = new Set(['ICT_RCITR','ICT_PITR']);
const keyOf = value => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const monthLabel = (year, month) => year + '-' + String(month).padStart(2,'0');

function readRange(input) {
  let range = input;
  if (typeof input === 'string') {
    const match = /^(\d{4})-(\d{2}) s\.d\. (\d{4})-(\d{2})$/.exec(input);
    if (match) range = {from:{y:Number(match[1]),m:Number(match[2])},to:{y:Number(match[3]),m:Number(match[4])}};
  }
  if (!rangeIsValid(range)) throw Error('Periksa bulan dan tahun awal serta akhir penarikan.');
  return range;
}

export function planHomeCapture({wp,period,sources,types = formIds}) {
  const owner = readCaptureId(String(wp ?? ''));
  if (!owner) throw Error('Masukkan satu NPWP untuk tarikan ini.');
  if (!Array.isArray(sources) || !sources.length || sources.some(id => !Object.hasOwn(knownSources,id))) {
    throw Error('Pilih sumber data yang akan ditarik.');
  }
  if (!Array.isArray(types) || types.some(id => !formIds.includes(id)) ||
      !types.length && sources.some(id => isSptList(id) || id === 'sptisi')) {
    throw Error('Pilih jenis SPT yang akan ditarik.');
  }
  const range = readRange(period), months = [], years = [];
  for (let year = range.from.y; year <= range.to.y; year++) {
    years.push(year);
    const first = year === range.from.y ? range.from.m : 1;
    const last = year === range.to.y ? range.to.m : 12;
    for (let month = first; month <= last; month++) months.push(monthLabel(year,month));
  }
  return {wp:owner,period:range,years,months,sources:[...new Set(sources)],types:[...new Set(types)]};
}

const recipientKeys = new Set(['employeetin','incomerecipienttin','recipienttin','npwppenerima','npwppenerimapenghasilan']);
const taxPeriodKeys = new Set(['masapajak','periodepajak','taxperiod','taxperiodcode','periodcode']);
const taxYearKeys = new Set(['tahunpajak','tahunmasapajak','taxyear','fiscalyear']);
const wrongOwner = message => Object.assign(Error(message),{code:'IDENTITY'});

function verifyRowOwner(row, source, wp) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Ada baris yang belum dapat dibaca pada sumber.');
  // A related person's NPWP and the withholding party's NPWP identify a counterparty.
  const ownerFields = {};
  for (const [key,value] of Object.entries(row)) {
    if (value === '' || value == null) continue;
    const label = keyOf(key);
    if ((source === 'pihak' || source === 'bplawan') && label === 'npwp') continue;
    if (label === 'taxpayertin' || source === 'info' && ['tin','uniqueidentificationnumber'].includes(label) ||
        source === 'bplawan' && recipientKeys.has(label)) {
      if (normalizeId(value) !== wp) throw wrongOwner('NPWP pada baris sumber berbeda dari WP yang dipilih.');
    } else {
      ownerFields[key] = value;
    }
  }
  try { checkIdentity([ownerFields],wp); }
  catch (error) { throw wrongOwner(error.message); }
  if (source === 'info' && row.GeneralInformation) {
    const general = row.GeneralInformation;
    for (const value of [general.UniqueIdentificationNumber,general.TaxpayerTIN,general.TIN]) {
      if (value != null && value !== '' && normalizeId(value) !== wp) throw wrongOwner('NPWP pada profil sumber berbeda dari WP yang dipilih.');
    }
  }
}

export function verifyHomeRowOwners(rows,{source,wp}) {
  const owner = normalizeId(wp);
  if (!owner) throw Error('Masukkan satu NPWP untuk tarikan ini.');
  if (!Array.isArray(rows)) throw Error('Daftar baris pada sumber belum dapat dibaca.');
  for (const row of rows) verifyRowOwner(row,source,owner);
}

function scopedPeriod(row, annual, monthFilter) {
  const periods = [], years = [];
  for (const [key,value] of Object.entries(row)) {
    if (value == null || value === '') continue;
    const label = keyOf(key);
    if (taxPeriodKeys.has(label)) periods.push(periodOf(value,annual));
    if (taxYearKeys.has(label)) years.push(String(value).trim());
  }
  if (!periods.length && monthFilter) periods.push(monthFilter);
  if (!periods.length && annual && years.length) periods.push(periodOf(years[0],true));
  const period = periods[0];
  if (!period || periods.some(item => item?.label !== period.label) ||
      years.some(year => year !== String(period.year)) ||
      monthFilter && monthFilter.label !== period.label) return null;
  return period;
}

export function homeLedgerMonth(row) {
  const value = scopedPeriod(row,false,null);
  return value && value.first === value.last ? value.label : '';
}

export function homeLedgerCode(row) {
  const periods = Object.entries(row).filter(([key,value]) => taxPeriodKeys.has(keyOf(key)) && value != null && value !== '');
  if (!periods.length || periods.some(([,value]) => /^(?:19|20)\d{2}$/.test(String(value).trim()))) return '';
  const value = scopedPeriod(row,true,null);
  if (!value) return '';
  return [value.first,value.last].map(m => String(m).padStart(2,'0')).join('') + value.year;
}

export function homeWithholdingGroup(row,observedType) {
  const value = scopedPeriod(row,true,null);
  if (!value) return null;
  const typeKeys = ['withholdingslipstype','withholdingsliptype','jenisbuktipotong','jenisbuktipemotongan'];
  const kinds = new Set(Object.entries(row).filter(([key,field]) => field && typeKeys.includes(keyOf(key)))
    .map(([,field]) => String(field).trim().toUpperCase()));
  if (observedType) kinds.add(String(observedType).trim().toUpperCase());
  const [jenis] = kinds;
  if (kinds.size !== 1 || !isWithholdingKind(jenis)) return null;
  return {tahun:value.year,jenis};
}

// sourceWp and sourceMonth come from the visible taxpayer panel and active month filter.
// They must be observed independently of the selections in the extension form.
export function scopeHomeRows(rows,{source,wp,period,types = formIds,sourceWp,sourceMonth,sourceLedgerCode}) {
  const owner = normalizeId(wp);
  if (!owner || normalizeId(sourceWp) !== owner) throw wrongOwner('NPWP pada halaman sumber belum cocok dengan WP yang dipilih.');
  if (!Object.hasOwn(knownSources,source) || source === 'sptisi' || source === 'tabelumum') {
    throw Error('Sumber ini memerlukan pemeriksaan tersendiri untuk dokumen atau tabelnya.');
  }
  verifyHomeRowOwners(rows,{source,wp:owner});
  const range = readRange(period);
  let monthFilter = sourceMonth ? periodOf(sourceMonth,false) : null;
  if (sourceMonth && (!monthFilter || monthFilter.label !== sourceMonth || monthFilter.first !== monthFilter.last)) {
    throw Error('Bulan pada halaman sumber belum dapat dipastikan.');
  }
  if (sourceLedgerCode) {
    const observed = /^(0[1-9]|1[0-2])(0[1-9]|1[0-2])((?:19|20)\d{2})$/.test(sourceLedgerCode) && periodOf(sourceLedgerCode,true);
    if (!['bb','bbtotal'].includes(source) || !observed || monthFilter && observed.label!==monthFilter.label)
      throw Error('Kode masa pada buku besar berbeda dari pilihan pada sumber.');
    monthFilter=observed;
  }
  const selected = new Set(types), allForms = formIds.every(id => selected.has(id));
  const list = isSptList(source);
  const monthly = ['bb','bbtotal','bplawan'].includes(source);
  const result = {rows:[],sourceRows:rows.length,outsidePeriod:0,unknownPeriod:0,excludedType:0,unknownType:0};
  for (const row of rows) {
    const type = list ? listRowType(row) : '';
    if (list && !type) result.unknownType++;
    if (list && !allForms && !selected.has(type)) {
      if (type) result.excludedType++;
      continue;
    }
    if (monthly || list) {
      const ledgerCode = source === 'bb' || source === 'bbtotal' ? homeLedgerCode(row) || sourceLedgerCode : '';
      const annual = source === 'bplawan' || list && annualForms.has(type) ||
        Boolean(ledgerCode && ledgerCode.slice(0,2) !== ledgerCode.slice(2,4));
      const sourcePeriod = scopedPeriod(row,annual,monthly ? monthFilter : null);
      if (!sourcePeriod) { result.unknownPeriod++; continue; }
      if (!inPeriod(sourcePeriod,annual,range)) { result.outsidePeriod++; continue; }
    }
    result.rows.push(row);
  }
  return result;
}
