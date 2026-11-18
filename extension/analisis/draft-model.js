import {emptyFinding, findingKey, findingsFor, reviewOptions, selectedFindings} from './findings.js';

export const draftTitles = {
  SP2DK: "Surat Permintaan Penjelasan atas Data dan/atau Keterangan",
  BAP2DK: "Berita Acara Pelaksanaan Permintaan Penjelasan atas Data dan/atau Keterangan",
  BAPK: "Berita Acara Pemberian Keterangan Wajib Pajak",
  PANGGILAN: "Surat Panggilan untuk Memberikan Keterangan"
};
export const allowedDrafts = role => {
  const name = String(role).trim().toLocaleLowerCase("id");
  if (name === "ar" || name.includes("account representative") || name === "pengawasan") return ["SP2DK", "BAP2DK"];
  return name === "pemeriksa" ? ["BAPK"] : [];
};
export const blankFinding = emptyFinding;
export function draftFindings(pkg, year, workRows, dispositions = {}, source = null) {
  const findings = source?.findings || findingsFor(pkg, year, workRows)
    .filter(row => !dispositions[findingKey(row)] || dispositions[findingKey(row)] === reviewOptions[0]);
  return findings.map(row=>({...row,taxpayer:'',discussed:'',agreed:''}));
}
export function newDraft(type, pkg, year, source = null, workRows = [], dispositions = {}) {
  if (!["SP2DK", "BAP2DK", "BAPK"].includes(type)) throw new Error("Jenis dokumen tidak dikenal.");
  if (source && (source.type !== "SP2DK" || type !== "BAP2DK" || source.year !== String(year) ||
    source.npwp !== (pkg.manifest.wp?.npwp || ""))) throw new Error("SP2DK sumber berbeda WP atau tahun.");
  const m = pkg.manifest;
  const findings = type === "BAPK" ? [] : draftFindings(pkg,year,workRows,dispositions,source);
  return { id: crypto.randomUUID(), type, year: String(year), npwp: m.wp?.npwp || "", name: m.wp?.nama || "",
    number: "", date: "", office: source?.office || "", officer: source?.officer || m.penarik?.nama || "",
    assignment: source?.assignment || m.penugasan?.nomor || "", recipient: "", place: "", time: "",
    participant: "", agenda: "", narrative: "", conclusion: "", appointmentNumber: "", appointmentDate: "",
    contact: "", related: source ? { id: source.id, number: source.number, date: source.date } : null,
    scope: source?.scope || "all", questions: [], findings };
}
export function visibleFindings(doc) {
  return selectedFindings(doc.findings,doc.scope);
}
export function suggestQuestions(doc, pkg, workRows = []) {
  const proposals = [{ text: "Bagaimana alur kegiatan usaha pada periode yang diperiksa dan dokumen apa yang mendukung penjelasan tersebut?", source: "Pertanyaan umum" }];
  for (const r of workRows) if (r.topik) proposals.push({
    text: "Apa penjelasan dan dokumen pendukung untuk butir “" + r.topik + "”?", source: r.sumber || "Kertas kerja"
  });
  for (const form of (pkg.forms || []).filter(f => !doc.year || f.year === doc.year)) {
    if (!form.amended) continue;
    proposals.push({ text: "Apa alasan pembetulan SPT " + form.type + " periode " + form.period + " dan dokumen apa yang mendukung perubahannya?", source: form.key });
  }
  const existing = new Set(doc.questions.map(q => q.text));
  let added = 0;
  for (const q of proposals) {
    if (existing.has(q.text)) continue;
    existing.add(q.text);
    doc.questions.push({ id: crypto.randomUUID(), text: q.text, source: q.source, selected: false, answer: "", note: "" });
    added++;
  }
  return added;
}
const findingHeaders = ["Jenis", "Uraian", "Periode", "Status", "Rujukan data", "Nilai penelitian"];
function asNumber(v) {
  if (v === "" || v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}
function findingTable(doc) {
  const extended = doc.type === "BAP2DK";
  const headers = extended ? [...findingHeaders, "Menurut WP", "Sesudah pembahasan", "Disetujui"] : findingHeaders;
  const rows = visibleFindings(doc).map(f => {
    const cells = [f.kind, f.detail, f.period, f.status, f.source, asNumber(f.amount)];
    return extended ? [...cells, asNumber(f.taxpayer), asNumber(f.discussed), asNumber(f.agreed)] : cells;
  });
  return { title: extended ? "Lampiran pembahasan" : "Daftar data yang dimintakan penjelasan", rows: [headers, ...rows] };
}
export function draftOutput(doc, variant = "main") {
  const invitation = doc.type === "BAPK" && variant === "invitation";
  const title = "KONSEP • " + draftTitles[invitation ? "PANGGILAN" : doc.type];
  const paragraphs = [], tables = [];
  const header = [["Isian", "Keterangan"], ["Unit kerja",doc.office],
    ["Nomor", invitation ? doc.appointmentNumber : doc.number], ["Tanggal", invitation ? doc.appointmentDate : doc.date],
    ["Nama WP",doc.name], ["NPWP",doc.npwp], ["Tahun pajak",doc.year], ["Petugas",doc.officer],
    ["Dasar penugasan",doc.assignment], ["Penerima",doc.recipient]];
  if (doc.type === "BAP2DK" && doc.related) header.push(["SP2DK yang dirujuk", [doc.related.number,doc.related.date].filter(Boolean).join(" • ")]);
  if (invitation || doc.type !== "SP2DK") header.push(["Tempat",doc.place], ["Waktu",doc.time], ["Peserta",doc.participant], ["Agenda",doc.agenda]);
  if (doc.contact) header.push(["Narahubung",doc.contact]);
  tables.push({title:"Identitas dan pelaksanaan",rows:header});
  if (invitation) return { title, paragraphs, tables };
  if (doc.narrative) paragraphs.push(doc.narrative);
  if (doc.type === "BAPK") {
    const rows = doc.questions.filter(q => q.selected).map((q,index) => [index+1,q.text,variant === "blank" ? "" : q.answer]);
    tables.push({title:"Pertanyaan dan jawaban",rows:[["No.","Pertanyaan","Jawaban"],...rows]});
  } else tables.push(findingTable(doc));
  if (doc.conclusion) tables.push({title:"Catatan hasil",rows:[["Uraian"],[doc.conclusion]]});
  return { title, paragraphs, tables };
}
export function draftSheets(doc) {
  const output = draftOutput(doc);
  const sheets = output.tables.map(t => ({name:t.title,rows:t.rows}));
  if (doc.type === "BAPK") sheets.push({name:"Kendali pertanyaan",rows:[["ID","Pertanyaan","Jawaban","Catatan internal","Sumber","Dipakai"],
    ...doc.questions.map(q => [q.id,q.text,q.answer,q.note,q.source,q.selected])]});
  return sheets;
}
export function importAnswers(doc, sheets) {
  const table = sheets.find(s => s.name === "Kendali pertanyaan");
  if (!table?.rows?.length) throw new Error("Lembar Kendali pertanyaan tidak ditemukan.");
  const idCol = table.rows[0].indexOf("ID"), answerCol = table.rows[0].indexOf("Jawaban");
  if (idCol < 0 || answerCol < 0) throw new Error("Lembar perlu kolom ID dan Jawaban.");
  const questions = new Map(doc.questions.map(q => [q.id,q])), changes = new Map();
  for (const row of table.rows.slice(1)) {
    const id = row[idCol], answer = row[answerCol];
    if (!questions.has(id) || answer == null || String(answer).trim() === "") continue;
    if (changes.has(id)) throw new Error("ID pertanyaan muncul dua kali di Excel.");
    changes.set(id,String(answer));
  }
  for (const [id, answer] of changes) questions.get(id).answer = answer;
  return changes.size;
}

export function validateDrafts(drafts) {
  const bad = () => { throw new Error("Struktur konsep berita acara dalam berkas kerja tidak dikenali."); };
  const record = item => item !== null && typeof item === "object" && !Array.isArray(item);
  const strings = (item, keys) => record(item) && keys.every(key => typeof item[key] === "string");
  if (!Array.isArray(drafts)) bad();
  const ids = new Set();
  for (const doc of drafts) {
    if (!strings(doc, ["id","type","year","npwp","name","number","date","office","officer","assignment","recipient",
      "place","time","participant","agenda","narrative","conclusion","appointmentNumber","appointmentDate","contact","scope"]) ||
      !doc.id || ids.has(doc.id) || !["SP2DK","BAP2DK","BAPK"].includes(doc.type) ||
      !["all","verified"].includes(doc.scope) || !Array.isArray(doc.findings) || !Array.isArray(doc.questions)) bad();
    ids.add(doc.id);
    if (doc.related != null && !strings(doc.related, ["id","number","date"])) bad();
    for (const f of doc.findings) {
      if (!strings(f, ["kind","detail","period","source","status"]) || !["berbukti","indikatif"].includes(f.status) ||
        ["amount","taxpayer","discussed","agreed"].some(k => typeof f[k] !== "string" && !Number.isFinite(f[k]))) bad();
    }
    const questionIds = new Set();
    for (const q of doc.questions) {
      if (!strings(q, ["id","text","answer","source","note"]) || !q.id || questionIds.has(q.id) || typeof q.selected !== "boolean") bad();
      questionIds.add(q.id);
    }
  }
  return drafts;
}
