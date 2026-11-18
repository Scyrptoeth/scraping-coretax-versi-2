import { writeZip } from "./zip.js";

const wordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const contentNs = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const documentRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

function escapeXml(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function paragraph(text, { bold = false, size = 22, after = 110, keep = false } = {}) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  const run = lines.map(line => '<w:t xml:space="preserve">' + escapeXml(line) + '</w:t>').join("<w:br/>");
  return '<w:p><w:pPr>' + (keep ? "<w:keepNext/>" : "") + '<w:spacing w:after="' + after + '"/></w:pPr>' +
    '<w:r><w:rPr>' + (bold ? "<w:b/>" : "") + '<w:sz w:val="' + size + '"/></w:rPr>' + run + '</w:r></w:p>';
}

function tableFor(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Tabel dokumen perlu daftar baris.");
  if (!rows.length) return "";
  const columns = rows.reduce((max, row) => {
    if (!Array.isArray(row)) throw new TypeError("Baris tabel dokumen harus berupa daftar sel.");
    return Math.max(max, row.length);
  }, 1);
  const width = Math.floor(9026 / columns);
  const grid = "<w:gridCol w:w=\"" + width + "\"/>";
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(edge =>
    '<w:' + edge + ' w:val="single" w:sz="4" w:color="B9C3CA"/>').join("");
  const content = rows.map((row, index) => {
    const cells = Array.from({ length: columns }, (_, col) => {
      const fill = index === 0 ? '<w:shd w:val="clear" w:fill="E5ECEF"/>' : "";
      return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + fill + "</w:tcPr>" +
        paragraph(row[col], { bold: index === 0, after: 45, size: 20 }) + "</w:tc>";
    }).join("");
    return "<w:tr>" + (index === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : "") + cells + "</w:tr>";
  }).join("");
  return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + borders + '</w:tblBorders></w:tblPr>' +
    "<w:tblGrid>" + grid.repeat(columns) + "</w:tblGrid>" + content + "</w:tbl>";
}

export async function createDocx({ title, paragraphs = [], tables = [] }) {
  const body = [];
  if (title) body.push(paragraph(title, { bold: true, size: 32, after: 220, keep: true }));
  for (const text of paragraphs) body.push(paragraph(text));
  for (const table of tables) {
    if (table.title) body.push(paragraph(table.title, { bold: true, size: 24, after: 100, keep: true }));
    body.push(tableFor(table.rows), paragraph("", { after: 30 }));
  }
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>');
  const members = [
    { name: "[Content_Types].xml", data: '<Types xmlns="' + contentNs + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", data: '<Relationships xmlns="' + relationshipNs + '"><Relationship Id="doc" Type="' + documentRel + '" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", data: '<w:document xmlns:w="' + wordNs + '"><w:body>' + body.join("") + '</w:body></w:document>' }
  ];
  return writeZip(members, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
