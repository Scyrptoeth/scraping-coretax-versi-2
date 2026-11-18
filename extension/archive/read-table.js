import { decodeText, readZip, safePath } from "./zip.js";

const relationshipNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const elements = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
function resolvePart(parent, target) {
  if (!target || target.includes("\\") || /^[a-z]+:/i.test(target)) throw new Error("Tujuan relasi lembar kerja tidak didukung.");
  const resolved = new URL(target, new URL(parent, "https://workbook.invalid/"));
  const path = decodeURIComponent(resolved.pathname.slice(1));
  if (resolved.hostname !== "workbook.invalid" || !safePath(path)) throw new Error("Lokasi bagian workbook tidak didukung.");
  return path;
}
function cellIndex(address) {
  const match = /^([A-Z]+)[1-9]\d*$/.exec(address || "");
  if (!match) throw new Error("Alamat sel Excel tidak sah.");
  return [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

// Reading cached values only allows local control sheets to be edited in Excel.
export async function readXlsx(file) {
  const members = await readZip(file);
  function readXml(name) {
    const part = members.get(name);
    if (!part || !part.crcOk) throw new Error("Bagian workbook hilang atau rusak: " + name);
    const xml = new DOMParser().parseFromString(decodeText(part.data), "application/xml");
    if (xml.doctype || elements(xml, "parsererror").length) throw new Error("Isi XML workbook tidak dapat dibaca.");
    return xml;
  }
  const relsFor = path => elements(readXml(path), "Relationship").filter(r => r.getAttribute("TargetMode") !== "External");
  const officeRel = relsFor("_rels/.rels").find(r => r.getAttribute("Type")?.endsWith("/officeDocument"));
  if (!officeRel) throw new Error("File Excel tidak memiliki workbook.");
  const workbook = resolvePart("", officeRel.getAttribute("Target"));
  const pathParts = workbook.split("/");
  const base = pathParts.pop();
  const relPath = [...pathParts, "_rels", base + ".rels"].join("/");
  const rels = relsFor(relPath);
  const sharedRel = rels.find(r => r.getAttribute("Type")?.endsWith("/sharedStrings"));
  const strings = sharedRel ? elements(readXml(resolvePart(workbook, sharedRel.getAttribute("Target"))), "si")
    .map(si => elements(si, "t").map(t => t.textContent).join("")) : [];
  const sheets = [];
  for (const sheet of elements(readXml(workbook), "sheet")) {
    const id = sheet.getAttributeNS(relationshipNs, "id") || sheet.getAttribute("r:id");
    const rel = rels.find(r => r.getAttribute("Id") === id && r.getAttribute("Type")?.endsWith("/worksheet"));
    if (!rel) continue;
    const xml = readXml(resolvePart(workbook, rel.getAttribute("Target")));
    const rows = [];
    for (const row of elements(xml, "row")) {
      const cells = [];
      for (const cell of elements(row, "c")) {
        const col = cellIndex(cell.getAttribute("r"));
        if (col > 16383) throw new Error("Alamat kolom Excel di luar batas.");
        const type = cell.getAttribute("t"), v = elements(cell, "v")[0]?.textContent ?? "";
        let value = v;
        if (type === "inlineStr") value = elements(cell, "t").map(t => t.textContent).join("");
        else if (type === "s") value = strings[Number(v)] ?? "";
        else if (type === "b") value = v === "1";
        else if ((!type || type === "n") && v !== "" && Number.isFinite(Number(v))) value = Number(v);
        cells[col] = value;
      }
      rows.push(cells);
    }
    sheets.push({ name: sheet.getAttribute("name"), rows });
  }
  if (!sheets.length) throw new Error("Workbook tidak memiliki lembar yang dapat dibaca.");
  return sheets;
}
