// Capture formats retain the original response envelope. No network access is needed.
const filePattern = /^spt\/([^/]+)\/(\d{4}(?:-\d{2})?)\/p(\d+)_([^/]+)\/([^/]+)\.json$/i;
const collator = new Intl.Collator('id', {numeric: true, sensitivity: 'base'});
export const compare = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));
export const count = value => new Intl.NumberFormat('id-ID', {maximumFractionDigits: 3}).format(value);
export const typeNames = {PPN: 'PPN', 'PPN-PEMUNGUT': 'PPN non-PKP / Pemungut', BADAN: 'PPh Badan', OP: 'PPh Orang Pribadi', PPH2126: 'PPh 21/26', UNIFIKASI: 'PPh Unifikasi'};
const own = (o, k) => Object.hasOwn(o, k);
function decoded(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function payloads(entry) {
  return (entry?.pages || []).filter(p => p?.IsSuccessful !== false).map(page => {
    const body = page && own(page, 'Payload') ? page.Payload : page;
    if (body && own(body, 'FormData')) return decoded(body.FormData);
    if (body && own(body, 'CurrentFormData')) return decoded(body.CurrentFormData);
    return body;
  });
}
export function rowsOf(entry) {
  return payloads(entry).flatMap(body => {
    if (body === null || body === undefined) return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.Data)) return body.Data;
    if (Array.isArray(body.Taxpayers)) return body.Taxpayers;
    if (Array.isArray(body.rows)) return body.rows;
    return [body];
  }).map(row => row && typeof row === 'object' && !Array.isArray(row) ? row : {Nilai: row});
}
export function label(path) {
  return String(path).split('/').at(-1).replace(/\.json$/i, '').replace(/[-_]+/g, ' ').replace(/^./, s => s.toUpperCase());
}
export function flatten(value, prefix = '', result = new Map()) {
  if (value !== null && typeof value === 'object' && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? prefix + '.' + key : key, result);
  } else result.set(prefix, value);
  return result;
}
export function serialize(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
export function selectRows(rows, query, order) {
  const q = query.trim().toLocaleLowerCase('id');
  const filtered = q ? rows.filter(row => Object.values(row).some(v => serialize(v).toLocaleLowerCase('id').includes(q))) : rows.slice();
  if (order?.key) filtered.sort((a, b) => {
    const x = a[order.key], y = b[order.key];
    return order.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : compare(serialize(x), serialize(y)));
  });
  return filtered;
}
export function worksheet(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return [keys, ...rows.map(r => keys.map(k => typeof r[k] === 'object' && r[k] !== null ? serialize(r[k]) : r[k] ?? null))];
}
export function sptDay(value) {
  if (typeof value !== 'string') return '';
  const day = value.slice(0, 10);
  // Legacy Coretax records can contain placeholder years such as 0001 and 1900.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '1990-01-01') return '';
  const utc = new Date(day + 'T00:00:00Z');
  return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === day ? day : '';
}
export function submittedDay(row) {
  return sptDay(row?.ReturnDate) || sptDay(row?.ReceiptDate) || sptDay(row?.EnteredDate) || sptDay(row?.DateOfSubmit);
}
export function receiptNumber(row) {
  for (const value of [row?.DocumentReceiptNumber, row?.BpsNo]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
  }
  return '';
}
function afterWeekend(day) {
  if (!day) return '';
  const utc = new Date(day + 'T00:00:00Z');
  const weekday = utc.getUTCDay();
  if (weekday !== 0 && weekday !== 6) return day;
  utc.setUTCDate(utc.getUTCDate() + (weekday === 6 ? 2 : 1));
  return utc.toISOString().slice(0, 10);
}
export function indexPackage(pkg) {
  const forms = new Map();
  const byId = new Map();
  for (const entry of pkg.entries.filter(e => /^spt\/daftar(?:[-/].*)?\.json$/i.test(e.path))) {
    for (const row of rowsOf(entry)) {
      if (row.RecordId) byId.set(row.RecordId, {row, path:entry.path});
    }
  }
  for (const entry of pkg.entries) {
    const match = filePattern.exec(entry.path);
    if (!match) continue;
    const [,type,period,version,id,part] = match;
    const key = entry.path.slice(0, entry.path.lastIndexOf('/'));
    if (!forms.has(key)) forms.set(key, {key, type, period, year: period.slice(0,4), version: Number(version), id, parts: new Map(), meta: byId.get(id)?.row || {}});
    forms.get(key).parts.set(part, entry);
  }
  const list = [...forms.values()].sort((a,b) => compare(b.period,a.period) || compare(a.type,b.type) || b.version-a.version);
  const latest = new Map();
  for (const f of list) {
    const key = f.type + '/' + f.period;
    if (!latest.has(key)) latest.set(key, f);
    f.latest = latest.get(key) === f;
    f.amended = f.version > 0;
    const part = f.parts.get('induk') || f.parts.values().next().value;
    const context = part.cap?.konteks?.spt;
    const fromList = submittedDay(f.meta);
    f.reportDate = fromList || sptDay(context?.tanggal);
    f.reportSource = fromList ? byId.get(f.id).path : part.path;
    f.dueDate = sptDay(f.meta.ExpectedReturnDate) || sptDay(context?.batas);
    f.late = !f.amended && f.reportDate && f.dueDate ? f.reportDate > f.dueDate : null;
    // The filing list adjusts weekends; the source deadline and its comparison remain available for review.
    f.filingDueDate = afterWeekend(f.dueDate);
    f.filingLate = !f.amended && f.reportDate && f.filingDueDate ? f.reportDate > f.filingDueDate : null;
  }
  const years = new Set(list.map(x => x.year));
  for (const e of pkg.entries) {
    const match = e.path.match(/(?:^|\/)(20\d\d)(?:[-/]|\.json$)/);
    if (match) years.add(match[1]);
  }
  const periodRange = pkg.manifest.opsi?.periode;
  const first = Number(periodRange?.from?.y), last = Number(periodRange?.to?.y);
  if (Number.isInteger(first) && Number.isInteger(last) && first >= 1900 && last <= 2100 && first <= last) {
    for (let year = first; year <= last; year++) years.add(String(year));
  }
  return {...pkg, forms: list, years: [...years].sort().reverse()};
}
export function sourceAmount(form, path) {
  let value = payloads(form.parts.get('induk'))[0];
  for (const k of path.split('.')) value = value?.[k];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export const periodFields = {
  PPN: {'Penyerahan': 'TotalDeliveryOfGoodsAndServices.SellingPrice', 'PPN keluaran': 'OutputTaxMustBeSelfCollected.VAT', 'PPN masukan': 'InputTaxCanBeCalculated.VAT', 'KB/(LB)': 'VATUnderOrOverPaid.VAT'},
  PPH2126: {'Bruto': 'Form1A.GrossIncome', 'PPh 21 dipotong': 'A21IncomeTaxWithheld', 'PPh 26 dipotong': 'A26IncomeTaxWithheld'},
  UNIFIKASI: {'Dipungut/dipotong': 'TotalWithholding','Disetor': 'TotalIncomeTaxPaid'},
  BADAN: {'Laba sebelum pajak': 'MainFormData.NetIncomeBeforeTax', 'Penghasilan kena pajak': 'MainFormData.TaxableIncome', 'PPh terutang': 'MainFormData.IncomeTaxInAYear'},
  OP: {'Penghasilan neto': 'AnnualNetIncome', 'PPh terutang': 'IncomeTaxPayable','Harta akhir tahun': 'AssetEndTaxYear','KB/(LB)': 'UnderOrOverPaymentTax'}
};
export function periodFacts(pkg, year) {
  return pkg.forms.filter(f => f.latest && (!year || f.year === year)).map(f => {
    const row = {Jenis: typeNames[f.type] || f.type, Periode: f.period, Versi: f.version};
    for (const [column,path] of Object.entries(periodFields[f.type] || {})) row[column] = sourceAmount(f,path);
    return row;
  });
}
export function issues(pkg, year) {
  const out = [];
  for (const f of pkg.forms.filter(f => !year || f.year === year)) {
    if (f.late) out.push({Butir:'Pelaporan melewati tanggal pada sumber', Periode:f.period, Jenis:typeNames[f.type] || f.type, Fakta:f.reportDate + ' / batas ' + f.dueDate, Sumber:f.reportSource});
    if (f.amended) out.push({Butir:'Pembetulan SPT', Periode:f.period, Jenis:typeNames[f.type] || f.type, Fakta:'Pembetulan ' + f.version, Sumber:f.key});
  }
  for (const e of pkg.entries.filter(e => e.cap?.lengkap === false)) out.push({Butir:'Berkas ditandai belum lengkap', Periode:'', Jenis:'Mutu data', Fakta:e.cap.label || e.path, Sumber:e.path});
  return out;
}
export function differences(a,b) {
  const left = flatten(a), right = flatten(b);
  const keys = [...new Set([...left.keys(), ...right.keys()])];
  return keys.filter(k => !left.has(k) || !right.has(k) || serialize(left.get(k)) !== serialize(right.get(k)) || typeof left.get(k) !== typeof right.get(k)).map(k => ({
    Isian:k, Sebelumnya:left.has(k) ? left.get(k) : '(tidak tersedia)', Sekarang:right.has(k) ? right.get(k) : '(tidak tersedia)'
  }));
}
