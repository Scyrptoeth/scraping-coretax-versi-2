import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { createPackage, readPackage, sha256 } from "../extension/archive/package.js";
import { readZip, writeZip, decodeText, utf8 } from "../extension/archive/zip.js";
import { createCsv, createXlsx, numericReference, sheetLink } from "../extension/archive/table.js";

const meta = {
  wp: { npwp: "0000000000000001", nama: "Contoh uji" },
  penugasan: { nomor: "UJI-01" }, penarik: { nama: "Petugas Uji" }, periode: "Januari 2026"
};
const entry = {
  path: "visible-tables/contoh.json", cap: { label: "Tabel contoh", baris: 1, lengkap: true },
  pages: [{ Payload: { Data: [{ id: "0001", jumlah: 25 }] } }]
};

test("export and reopen CAP package, preserving evidence and text identifiers", async () => {
  const file = await createPackage({ meta, entries: [entry] });
  const data = await readPackage(file);
  assert.deepEqual(data.entries[0].pages, entry.pages);
  assert.equal(data.entries[0].path, entry.path);
  assert.deepEqual(data.manifest.wp, meta.wp);
  assert.equal(data.report.valid, true);
  assert.equal(data.report.minutesHasChecksum, true);
  assert.equal(data.manifest.ringkas.tidakLengkap, 0);
  assert.equal(data.entries[0].cap.shaRespons[0], await sha256(JSON.stringify(entry.pages[0])));
  assert.match(data.minutes, /UJI-01/);
});

test("changed JSON, missing file, and unlisted file produce separate integrity findings", async () => {
  const raw = await readZip(await createPackage({
    meta, entries: [entry, { ...entry, path: "visible-tables/hilang.json" }]
  }));
  raw.get("data/" + entry.path).data = utf8.encode('{"cap":{},"pages":[]}');
  raw.delete("data/visible-tables/hilang.json");
  raw.set("extra.txt", { data: utf8.encode("kontrol uji") });
  const edited = await writeZip([...raw].map(([name, { data }]) => ({ name, data })));
  const { report } = await readPackage(edited);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(i => i.startsWith("SHA-256 berbeda")));
  assert.ok(report.issues.some(i => i.startsWith("Berkas hilang")));
  assert.ok(report.issues.some(i => i.startsWith("Berkas tambahan")));
});

test("CAPX2 checks the password and preserves the package", async () => {
  const file = await createPackage({ meta, entries: [entry], password: "uji lokal" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert.equal(decodeText(bytes.slice(0, 5)), "CAPX2");
  assert.equal(new DataView(bytes.buffer).getUint32(5), 600000);
  await assert.rejects(readPackage(file), { code: "PASSWORD_REQUIRED" });
  await assert.rejects(readPackage(file, { password: "keliru" }), { code: "DECRYPT_FAILED" });
  const { entries, report } = await readPackage(file, { password: "uji lokal" });
  assert.equal(report.encrypted, true);
  assert.equal(report.valid, true);
  assert.deepEqual(entries[0].pages, entry.pages);
});

test("read independently assembled legacy CAPX1 package", async () => {
  const plaintext = await createPackage({ meta, entries: [entry] });
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
  const iv = Uint8Array.from({ length: 12 }, (_, i) => i);
  const seed = await crypto.subtle.importKey("raw", utf8.encode("sintetis"), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    seed, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await plaintext.arrayBuffer());
  const { report } = await readPackage(new Blob(["CAPX1", salt, iv, cipher]), { password: "sintetis" });
  assert.equal(report.valid, true);
  assert.equal(report.encrypted, true);
});

test("worksheet and CSV exports preserve Unicode, text identifiers and numeric type", async () => {
  const rows = [["NPWP", "Teks & data", "Jumlah"], ["000001", '=A1+"uji"', -25]];
  const csv = await createCsv(rows).text();
  assert.match(csv, /"000001","'=A1\+""uji""","-25"/);
  const zip = await readZip(await createXlsx({ sheets: [{ name: "Uji / 1", rows }, { name: "Uji / 1", rows: [] }] }));
  assert.ok([...zip.values()].every(file => file.crcOk));
  const first = decodeText(zip.get("xl/worksheets/sheet1.xml").data);
  assert.match(first, /000001/);
  assert.match(first, /Teks &amp; data/);
  assert.match(first, /<c r="C2"><v>-25<\/v><\/c>/);
  assert.ok(!first.includes("<f>"));
  assert.match(decodeText(zip.get("xl/workbook.xml").data), /\(2\)/);
});

test("multisheet navigation and numeric references resolve the actual sanitized sheet names", async () => {
  const source={name:"Lembar O'Brien / sumber",rows:[['Nilai'],[0]]};
  const duplicate={name:source.name,rows:[['Nilai'],[14]]};
  const index={name:'Daftar Isi',rows:[[sheetLink(duplicate,'Buka sumber kedua',2),numericReference(duplicate,2,1,14)]]};
  const fourth={name:'Lainnya',rows:[]};
  const book=await readZip(await createXlsx({sheets:[source,duplicate,index,fourth]}));
  const part=n=>decodeText(book.get('xl/worksheets/sheet'+n+'.xml').data);
  assert.match(decodeText(book.get('xl/workbook.xml').data),/<sheets><sheet name="Daftar Isi" sheetId="5"/);
  assert.match(part(3),/location="'Lembar O''Brien   sumber \(2\)'!A2"/);
  assert.match(part(3),/IF\(ISNUMBER\('Lembar O''Brien   sumber \(2\)'!A2\)/);
  assert.match(part(3),/<v>14<\/v>/);
  assert.match(part(3),/location="'Daftar Isi'!A1"/);
  assert.match(part(5),/location="'Daftar Isi \(2\)'!A1"/);
  assert.equal((part(5).match(/<hyperlink /g)||[]).length,4);
  assert.ok(!index.rows[0].includes('Kembali ke daftar isi'));
  await assert.rejects(createXlsx({sheets:[index]}),/Lembar tujuan/);
});

test("all available local reference fixtures load with valid integrity", async context => {
  const folder = new URL("../01-VERITAX_v1.32.0/", import.meta.url);
  let names;
  try { names = await readdir(folder); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return context.skip("Keempat paket referensi hanya disimpan di workspace lokal.");
  }
  const examples = names.filter(name => name.startsWith("CONTOH-") && name.endsWith(".zip")).sort();
  assert.equal(examples.length, 4);
  const counts = [];
  for (const name of examples) {
    const { entries, manifest, report } = await readPackage(await readFile(new URL(name, folder)));
    assert.deepEqual(report.issues, []);
    assert.equal(report.valid, true);
    assert.equal(report.checked, manifest.files.length);
    assert.equal(entries.length, manifest.ringkas.file);
    counts.push(entries.length);
  }
  assert.deepEqual(counts.sort((a, b) => a - b), [155, 172, 672, 1004]);
});
