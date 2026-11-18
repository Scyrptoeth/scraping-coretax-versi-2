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
  const base = String(value || "Data").replace(/[\\/?:*\[\]]/g, " ").trim().replace(/^'+/g, "").slice(0,31).replace(/'+$/g,"").trim() || "Data";
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
const linkedCell = Symbol("workbook cell reference");

function addressOf(row, column) {
  if (!Number.isInteger(row) || row < 1 || row > 1048576 ||
      !Number.isInteger(column) || column < 1 || column > 16384) {
    throw new RangeError("Alamat sel di luar batas Excel.");
  }
  return columnName(column - 1) + row;
}

export function sheetLink(target, text, row = 1, column = 1) {
  return { [linkedCell]: "link", target, address: addressOf(row, column), text };
}

export function numericReference(target, row, column, cached) {
  return { [linkedCell]: "number", target, address: addressOf(row, column), cached: Number.isFinite(cached) ? cached : null };
}

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

function worksheet(rows, names, back, contents) {
  if (!Array.isArray(rows) || rows.length > 1048576) throw new Error("Jumlah baris melebihi batas lembar Excel.");
  const hyperlinks = [];
  const input = back && !rows.length ? [[]] : rows;
  const data = input.map((source, index) => {
    let row = source;
    if (back && !index && Array.isArray(row)) {
      row = row.slice();
      row[back.column] = sheetLink(back.target, "Kembali ke " + back.target.name);
    }
    if (!Array.isArray(row) || row.length > 16384) throw new Error("Kolom tidak sesuai batas Excel.");
    const cells = row.map((value, col) => {
      if (value == null) return "";
      const address = columnName(col) + (index + 1);
      let formula = value[trustedFormula], style = "";
      if (value[linkedCell]) {
        const target = names.get(value.target);
        if (!target) throw Error("Lembar tujuan tidak disertakan dalam workbook.");
        const location = "'" + target.replaceAll("'", "''") + "'!" + value.address;
        if (value[linkedCell] === "number") formula = 'IF(ISNUMBER(' + location + '),' + location + ',"")';
        else {
          hyperlinks.push('<hyperlink ref="' + address + '" location="' + xml(location) + '"/>');
          style = ' s="1"';value = value.text;
        }
      }
      if (formula) {
        const empty = value.cached === null;
        return '<c r="' + address + '"' + (empty ? ' t="str"' : '') + '><f>' +
          xml(formula) + '</f><v>' + (empty ? '' : value.cached) + '</v></c>';
      }
      if (typeof value === "number" && Number.isFinite(value)) return '<c r="' + address + '"><v>' + value + '</v></c>';
      if (typeof value === "boolean") return '<c r="' + address + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
      const text = cellText(value);
      if (text.length > 32767) throw new Error("Isi sel " + address + " melebihi 32.767 karakter.");
      return '<c r="' + address + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xml(text) + '</t></is></c>';
    }).join("");
    return '<row r="' + (index + 1) + '">' + cells + '</row>';
  }).join("");
  const columns = contents ? '<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="52" customWidth="1"/></cols>' : '';
  const links = hyperlinks.length ? '<hyperlinks>' + hyperlinks.join("") + '</hyperlinks>' : '';
  return '<worksheet xmlns="' + sheetNs + '">' + columns + '<sheetData>' + data + '</sheetData>' + links + '</worksheet>';
}

export async function createXlsx({ sheets, contentsName = "Daftar Isi" }) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error("Pilih minimal satu lembar untuk ekspor Excel.");
  const used = new Set(), names = new Map(), tabs = [], links = [], types = [], members = [], printAreas = [];
  const contents = sheets.length >= 4 ? {name:contentsName,rows:[["No.","Lembar"]]} : null;
  const all = sheets.map(sheet=>({...sheet}));
  if (contents) names.set(contents,sheetName(contents.name,used));
  for (const [i,sheet] of all.entries()) {
    const name = sheetName(sheet.name,used); names.set(sheet,name);
    if (!names.has(sheets[i])) names.set(sheets[i],name);
    if (contents) contents.rows.push([i+1,sheetLink(sheet,name)]);
  }
  if (contents) all.push(contents);
  for (const [index, sheet] of all.entries()) {
    const id = index + 1, file = "worksheets/sheet" + id + ".xml";
    const name = names.get(sheet);
    const tab = '<sheet name="' + xml(name) + '" sheetId="' + id + '" r:id="rId' + id + '"/>';
    if (sheet === contents) tabs.unshift(tab); else tabs.push(tab);
    links.push('<Relationship Id="rId' + id + '" Type="' + relNs + '/worksheet" Target="' + file + '"/>');
    types.push('<Override PartName="/xl/' + file + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    let back = null;
    if (contents && sheet !== contents && Array.isArray(sheet.rows)) {
      const width = sheet.rows.reduce((n,row)=>Math.max(n,Array.isArray(row)?row.length:0),1);
      if (width < 16384) {
        back = {column:Math.min(width + 1,16383),target:contents};
        const last = '$' + columnName(width-1) + '$' + Math.max(1,sheet.rows.length);
        const range = "'" + name.replaceAll("'","''") + "'!$A$1:" + last;
        printAreas.push('<definedName name="_xlnm.Print_Area" localSheetId="' + (index+1) + '">' + xml(range) + '</definedName>');
      }
    }
    members.push({ name: "xl/" + file, data: worksheet(sheet.rows,names,back,sheet===contents) });
  }
  links.push('<Relationship Id="styles" Type="' + relNs + '/styles" Target="styles.xml"/>');
  types.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
  const styles = '<styleSheet xmlns="'+sheetNs+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563A1"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const relationships = body => '<Relationships xmlns="' + packageNs + '/relationships">' + body + '</Relationships>';
  members.push(
    { name: "[Content_Types].xml", data: '<Types xmlns="' + packageNs + '/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + types.join("") + '</Types>' },
    { name: "_rels/.rels", data: relationships('<Relationship Id="rId1" Type="' + relNs + '/officeDocument" Target="xl/workbook.xml"/>') },
    { name: "xl/styles.xml", data:styles },
    { name: "xl/workbook.xml", data: '<workbook xmlns="' + sheetNs + '" xmlns:r="' + relNs + '"><sheets>' + tabs.join("") + '</sheets>' + (printAreas.length?'<definedNames>'+printAreas.join('')+'</definedNames>':'') + '<calcPr fullCalcOnLoad="1"/></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: relationships(links.join("")) }
  );
  return writeZip(members, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
