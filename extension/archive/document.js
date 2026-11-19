import { writeZip } from "./zip.js";

const wordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const contentNs = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const documentRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const hyperlinkRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

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

export async function createDocx({ title, paragraphs = [], tables = [], companionWorkbook }) {
  const body = [],workbookLinks=[];
  if (title) body.push(paragraph(title, { bold: true, size: 32, after: 220, keep: true }));
  for (const text of paragraphs) body.push(paragraph(text));
  for (const table of tables) {
    if (table.title) body.push(paragraph(table.title, { bold: true, size: 24, after: 100, keep: true }));
    if(companionWorkbook&&table.workbookTarget){
      const targetSheet=/^KKA_L(1|2B|2C|3A|3B|4A|4B|5|6|7|8|9|10|11|12|13)_[0-9_]+$/.exec(table.workbookTarget);
      if(!/^[^/\\:#?]+\.xlsx$/i.test(companionWorkbook)||!targetSheet)
        throw Error('Nama berkas atau tujuan tautan KKA tidak dikenali.');
      const id='workbook'+(workbookLinks.length+1);
      const target=encodeURIComponent(companionWorkbook)+'#'+table.workbookTarget;
      const caption=targetSheet[1]==='9'?'Buka rincian temuan indikatif di Excel KKA · L-9':
        'Buka lampiran di Excel KKA · L-'+targetSheet[1].toLowerCase();
      workbookLinks.push('<Relationship Id="'+id+'" Type="'+hyperlinkRel+'" Target="'+target+'" TargetMode="External"/>');
      body.push('<w:p><w:hyperlink r:id="'+id+'"><w:r><w:rPr><w:color w:val="0563A1"/><w:u w:val="single"/></w:rPr><w:t>'+caption+'</w:t></w:r></w:hyperlink></w:p>');
    }
    body.push(tableFor(table.rows), paragraph("", { after: 30 }));
  }
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>');
  const members = [
    { name: "[Content_Types].xml", data: '<Types xmlns="' + contentNs + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", data: '<Relationships xmlns="' + relationshipNs + '"><Relationship Id="doc" Type="' + documentRel + '" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", data: '<w:document xmlns:w="' + wordNs + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + body.join("") + '</w:body></w:document>' }
  ];
  if(workbookLinks.length)members.push({name:"word/_rels/document.xml.rels",data:'<Relationships xmlns="'+relationshipNs+'">'+workbookLinks.join('')+'</Relationships>'});
  return writeZip(members, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
