import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocx } from "../extension/archive/document.js";
import { decodeText, readZip } from "../extension/archive/zip.js";

test("DOCX exports a Word document with escaped paragraphs and a real editable table", async () => {
  const file = await createDocx({ title: "Konsep", paragraphs: ["Nama <Contoh> & Mitra\nBaris dua"],
    tables: [{ title: "Perincian", rows: [["ID", "Nilai"], ["00001", 0]] }] });
  const members = await readZip(file);
  assert.equal(members.size, 3);
  assert.ok([...members.values()].every(file => file.crcOk));
  const main = decodeText(members.get("word/document.xml").data);
  assert.match(main, /Nama &lt;Contoh&gt; &amp; Mitra/);
  assert.match(main, /<w:br\/>/);
  assert.match(main, /<w:tbl>/);
  assert.match(main, /00001/);
});
