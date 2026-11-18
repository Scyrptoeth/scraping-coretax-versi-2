import { asBytes, decodeText, readZip, safePath, utf8, writeZip } from "./zip.js";
import {sourceCoverage} from './source-coverage.js';

const encryptedVersion = bytes => String.fromCharCode(...bytes.subarray(0, 5));
const currentIterations = 600000;
function failure(code, message) { return Object.assign(new Error(message), { code }); }

export async function sha256(source) {
  const digest = await crypto.subtle.digest("SHA-256", await asBytes(source));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function derive(password, salt, iterations) {
  if (!password) throw failure("PASSWORD_REQUIRED", "Masukkan kata sandi paket.");
  const secret = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, secret,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(source, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, currentIterations);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await asBytes(source));
  const buffer = new Uint8Array(37 + encrypted.byteLength);
  buffer.set(utf8.encode("CAPX2"));
  new DataView(buffer.buffer).setUint32(5, currentIterations);
  buffer.set(salt, 9);
  buffer.set(iv, 25);
  buffer.set(new Uint8Array(encrypted), 37);
  return buffer;
}

export async function decryptBytes(source, password) {
  const bytes = await asBytes(source);
  const version = encryptedVersion(bytes);
  const start = version === "CAPX1" ? 5 : 9;
  if (!["CAPX1", "CAPX2"].includes(version) || bytes.length < start + 44)
    throw failure("INVALID_ENVELOPE", "Header paket terenkripsi tidak lengkap atau tidak dikenal.");
  const iterations = start === 5 ? 310000 : new DataView(bytes.buffer, bytes.byteOffset).getUint32(5);
  if (iterations < 100000 || iterations > 10000000) throw failure("INVALID_ENVELOPE", "Parameter enkripsi berada di luar format paket.");
  const key = await derive(password, bytes.subarray(start, start + 16), iterations);
  try {
    const result = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(start + 16, start + 28) }, key, bytes.subarray(start + 28)
    );
    return new Uint8Array(result);
  } catch {
    throw failure("DECRYPT_FAILED", "Paket gagal dibuka. Periksa kata sandi dan keutuhan berkas.");
  }
}

function checkDataPath(path) {
  if (!safePath(path) || !path.toLowerCase().endsWith(".json")) throw new Error("Nama berkas data di dalam paket tidak sah.");
}

function singleLine(value) { return String(value ?? "").replace(/[\r\n]+/g, " "); }
function minutesFor(manifest, digest,entries) {
  const lines = [
    "Berita acara penarikan data Coretax", "",
    ["Aplikasi", manifest.aplikasi], ["Waktu paket dibuat", manifest.dibuat],
    ["Wajib Pajak", [manifest.wp.npwp, manifest.wp.nama].filter(Boolean).join(" · ")],
    ["Peran penarik", manifest.penugasan.peran || manifest.penarik.peran],
    ["Dasar penugasan", manifest.penugasan.jenis],
    ["Nomor dasar", manifest.penugasan.nomor || "-"], ["Tanggal dasar", manifest.penugasan.tanggal],
    ["Ditarik oleh", manifest.penarik.nama || "-"], ["Periode", manifest.periode],
    ["Jumlah berkas", manifest.ringkas.file], ["Berkas tidak lengkap", manifest.ringkas.tidakLengkap],
    ["Pengambilan gagal", manifest.ringkas.gagal], ["Hash daftar file", manifest.hashDaftar],
    ["Hash MANIFEST.json", digest]
  ];
  if(Array.isArray(manifest.opsi?.sumber)){
    lines.push('','Cakupan sumber yang dipilih');
    for(const row of sourceCoverage(manifest,entries).filter(r=>r['Pilihan penarik']==='Dipilih')){
      lines.push([row.Sumber,row.Hasil+' ('+row['Berkas terbaca']+' berkas).']);
    }
  }
  return lines.map(line => Array.isArray(line) ? singleLine(line[0]) + ": " + singleLine(line[1]) : line).join("\r\n") + "\r\n";
}

export async function createPackage({ meta = {}, entries, password = "" }) {
  if (!Array.isArray(entries)) throw new Error("Data paket harus berupa daftar berkas.");
  const created = meta.dibuat || new Date().toISOString();
  const files = [], members = [], endpoints = new Set(), seen = new Set();
  for (const entry of entries) {
    checkDataPath(entry.path);
    if (seen.has(entry.path)) throw new Error("Terdapat nama berkas data yang sama.");
    seen.add(entry.path);
    if (!Array.isArray(entry.pages)) throw new Error("Data halaman belum tersedia untuk " + entry.path);
    const cap = { v: 1, sumber: "lokal", label: entry.path, waktu: created, baris: null, total: null,
      lengkap: false, catatan: [], konteks: { npwp: meta.wp?.npwp ?? "" }, ...entry.cap, halaman: entry.pages.length };
    if (!Array.isArray(cap.shaRespons)) cap.shaRespons = await Promise.all(entry.pages.map(page => sha256(JSON.stringify(page))));
    if (typeof cap.path === "string" && cap.path) endpoints.add(cap.path);
    const text = JSON.stringify({ cap, pages: entry.pages });
    files.push({ path: entry.path, sha256: await sha256(text), baris: cap.baris, halaman: cap.halaman,
      lengkap: cap.lengkap === true, waktu: cap.waktu, sumber: cap.sumber });
    members.push({ name: "data/" + entry.path, data: text });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const failed = Array.isArray(meta.gagal) ? meta.gagal : [];
  const manifest = {
    format: "CAP-PAKET", versi: 1, aplikasi: "Scraping Coretax Versi 2", dibuat: created,
    wp: meta.wp ?? {}, penugasan: meta.penugasan ?? {}, penarik: meta.penarik ?? {},
    periode: meta.periode ?? "", opsi: meta.opsi ?? {}, eksekusi: meta.eksekusi ?? null,
    ringkas: { file: files.length, tidakLengkap: files.filter(file => !file.lengkap).length, gagal: failed.length },
    gagal: failed, cek: meta.cek ?? [], files, hashDaftar: await sha256(JSON.stringify(files)),
    endpoint: [...endpoints].sort()
  };
  const manifestText = JSON.stringify(manifest, null, 2), digest = await sha256(manifestText);
  const minutes = minutesFor(manifest, digest,entries);
  members.push({ name: "MANIFEST.json", data: manifestText }, { name: "BERITA-ACARA.txt", data: minutes },
    { name: "MANIFEST.sha256", data: digest + "  MANIFEST.json\r\n" + await sha256(minutes) + "  BERITA-ACARA.txt\r\n" });
  const zip = await writeZip(members);
  return password ? new Blob([await encryptBytes(zip, password)], { type: "application/octet-stream" }) : zip;
}

function compareMinutes(minutes, manifest, report) {
  const lines = new Map();
  for (const line of minutes.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) lines.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  for (const [label, value] of [["Hash daftar file", manifest.hashDaftar], ["Hash MANIFEST.json", report.manifestHash],
    ["Nomor dasar", manifest.penugasan?.nomor || "-"]]) {
    if (lines.has(label) && lines.get(label) !== value) report.issues.push("Isi berita acara berbeda pada " + label + ".");
  }
  const operator = lines.get("Ditarik oleh")?.split(" · akun Coretax ")[0].split(" / NIP ")[0];
  if (manifest.penarik?.nama && operator && operator !== manifest.penarik.nama) report.issues.push("Nama penarik dalam berita acara berbeda.");
}

export async function readPackage(source, { password = "" } = {}) {
  let bytes = await asBytes(source);
  const encrypted = ["CAPX1", "CAPX2"].includes(encryptedVersion(bytes));
  if (encrypted) bytes = await decryptBytes(bytes, password);
  const zip = await readZip(bytes);
  const member = zip.get("MANIFEST.json");
  if (!member) throw new Error("MANIFEST.json tidak ditemukan di dalam paket.");
  const manifest = JSON.parse(decodeText(member.data));
  if (manifest?.format !== "CAP-PAKET" || manifest.versi !== 1 || !Array.isArray(manifest.files))
    throw new Error("Manifest bukan format CAP-PAKET versi 1.");
  const issues = [];
  const minutes = zip.has("BERITA-ACARA.txt") ? decodeText(zip.get("BERITA-ACARA.txt").data) : "";
  const report = { valid: false, encrypted, issues, checked: 0, manifestHash: await sha256(member.data) };
  const entries = [];
  for (const [path, record] of zip) if (!record.crcOk) issues.push("CRC-32 berbeda pada " + path);
  const sums = new Map();
  if (zip.has("MANIFEST.sha256")) {
    const lines = decodeText(zip.get("MANIFEST.sha256").data).trim().split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
      if (!match || sums.has(match[2])) issues.push("Format daftar SHA-256 tidak sesuai.");
      else sums.set(match[2], match[1].toLowerCase());
    }
  }
  if (sums.get("MANIFEST.json") !== report.manifestHash) issues.push("Hash MANIFEST.json berbeda atau tidak tersedia.");
  if (!minutes) issues.push("Berita acara tidak ditemukan atau kosong.");
  if (sums.has("BERITA-ACARA.txt") && sums.get("BERITA-ACARA.txt") !== await sha256(minutes)) issues.push("Hash berita acara berbeda.");
  report.minutesHasChecksum = sums.has("BERITA-ACARA.txt");
  compareMinutes(minutes, manifest, report);
  if (await sha256(JSON.stringify(manifest.files)) !== manifest.hashDaftar) issues.push("Hash daftar berkas berbeda.");
  const declared = new Set();
  for (const item of manifest.files) {
    checkDataPath(item?.path);
    if (declared.has(item.path)) { issues.push("Berkas berulang di manifest: " + item.path); continue; }
    declared.add(item.path);
    const file = zip.get("data/" + item.path);
    if (!file) { issues.push("Berkas hilang: " + item.path); continue; }
    const digest = await sha256(file.data);
    report.checked++;
    if (digest !== item.sha256) issues.push("SHA-256 berbeda pada " + item.path);
    try {
      const raw = decodeText(file.data);
      const { cap, pages } = JSON.parse(raw);
      if (!cap || typeof cap !== "object" || !Array.isArray(pages)) throw new Error();
      entries.push({ path: item.path, cap, pages, raw, sha256: digest, crcOk: file.crcOk });
    } catch { issues.push("Isi JSON tidak sesuai pada " + item.path); }
  }
  const roots = new Set(["MANIFEST.json", "BERITA-ACARA.txt", "MANIFEST.sha256"]);
  for (const path of zip.keys()) {
    if (!roots.has(path) && !(path.startsWith("data/") && declared.has(path.slice(5)))) issues.push("Berkas tambahan: " + path);
  }
  report.valid = issues.length === 0;
  return { manifest, entries, report, minutes };
}
