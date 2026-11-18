import { writeZip } from "./zip.js";

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function createCsv(rows) {
  const lines = rows.map(row => row.map(value => {
    let text = cellText(value);
    if (typeof value !== "number" && /^[\s\u0000-\u001F]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(","));
  return new Blob(["\ufeff", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
}

function xml(value) {
  return cellText(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function columnName(column) {
  let result = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function sheetName(value, used) {
  const base = (String(value || "Data").replace(/[\\/?:*\[\]]/g, " ").replace(/^'+|'+$/g, "").trim() || "Data").slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = " (" + n + ")";
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}
const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageNs = "http://schemas.openxmlformats.org/package/2006";
const trustedFormula = Symbol("workbook formula");

// JSON cells and source strings stay literal. Only this builder can supply an expression.
export function differenceCell(row, leftColumn, rightColumn, cached) {
  if (!Number.isInteger(row) || row < 1 || row > 1048576 ||
      ![leftColumn, rightColumn].every(n => Number.isInteger(n) && n >= 1 && n <= 16384)) {
    throw new RangeError("Alamat sel untuk rumus selisih tidak sah.");
  }
  const left = columnName(leftColumn-1) + row, right = columnName(rightColumn-1) + row;
  return { [trustedFormula]: `IF(COUNT(${left},${right})=2,${right}-${left},"")`,
    cached: Number.isFinite(cached) ? cached : null };
}

function worksheet(rows) {
  if (!Array.isArray(rows) || rows.length > 1048576) throw new Error("Jumlah baris melebihi batas lembar Excel.");
  const data = rows.map((row, index) => {
    if (!Array.isArray(row) || row.length > 16384) throw new Error("Kolom tidak sesuai batas Excel.");
    const cells = row.map((value, col) => {
      if (value == null) return "";
      const address = columnName(col) + (index + 1);
      if (value[trustedFormula]) {
        const empty = value.cached === null;
        return '<c r="' + address + '"' + (empty ? ' t="str"' : '') + '><f>' +
          xml(value[trustedFormula]) + '</f><v>' + (empty ? '' : value.cached) + '</v></c>';
      }
      if (typeof value === "number" && Number.isFinite(value)) return '<c r="' + address + '"><v>' + value + '</v></c>';
      if (typeof value === "boolean") return '<c r="' + address + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
      const text = cellText(value);
      if (text.length > 32767) throw new Error("Isi sel " + address + " melebihi 32.767 karakter.");
      return '<c r="' + address + '" t="inlineStr"><is><t xml:space="preserve">' + xml(text) + '</t></is></c>';
    }).join("");
    return '<row r="' + (index + 1) + '">' + cells + '</row>';
  }).join("");
  return '<worksheet xmlns="' + sheetNs + '"><sheetData>' + data + '</sheetData></worksheet>';
}

export async function createXlsx({ sheets }) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error("Pilih minimal satu lembar untuk ekspor Excel.");
  const used = new Set(), tabs = [], links = [], types = [], members = [];
  for (const [index, sheet] of sheets.entries()) {
    const id = index + 1, file = "worksheets/sheet" + id + ".xml";
    const name = sheetName(sheet.name, used);
    tabs.push('<sheet name="' + xml(name) + '" sheetId="' + id + '" r:id="rId' + id + '"/>');
    links.push('<Relationship Id="rId' + id + '" Type="' + relNs + '/worksheet" Target="' + file + '"/>');
    types.push('<Override PartName="/xl/' + file + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    members.push({ name: "xl/" + file, data: worksheet(sheet.rows) });
  }
  const relationships = body => '<Relationships xmlns="' + packageNs + '/relationships">' + body + '</Relationships>';
  members.push(
    { name: "[Content_Types].xml", data: '<Types xmlns="' + packageNs + '/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + types.join("") + '</Types>' },
    { name: "_rels/.rels", data: relationships('<Relationship Id="rId1" Type="' + relNs + '/officeDocument" Target="xl/workbook.xml"/>') },
    { name: "xl/workbook.xml", data: '<workbook xmlns="' + sheetNs + '" xmlns:r="' + relNs + '"><sheets>' + tabs.join("") + '</sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: relationships(links.join("")) }
  );
  return writeZip(members, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
