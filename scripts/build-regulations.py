"""Build offline metadata from public DJP catalog pages, without taxpayer data."""
import json
from pathlib import Path
from urllib.parse import urlencode, urljoin
import subprocess

from bs4 import BeautifulSoup

root = Path(__file__).resolve().parents[1]
base = "https://www.pajak.go.id/id/peraturan"
rows = {}
topics = ["harmonisasi peraturan perpajakan", "klasifikasi lapangan usaha wajib pajak",
          "tata cara pelaksanaan hak dan pemenuhan kewajiban perpajakan",
          "sistem inti administrasi perpajakan", "pemeriksaan pajak", "pengawasan wajib pajak",
          "pajak penghasilan", "pajak pertambahan nilai", "sanksi administratif", "bukti pemotongan"]
queries = [{"title": topic} for topic in topics]
queries.extend({"field_jenis_dokumen_target_id": category, "page": page}
               for category in ["13902", "13899", "13877", "13881", "13894", "13926"]
               for page in range(3))
for params in queries:
    address = base + "?" + urlencode(params)
    content = subprocess.check_output(["curl", "-fsSL", "--max-time", "25", address])
    soup = BeautifulSoup(content, "html.parser")
    for row in soup.select(".peraturan-content"):
        anchor = row.select_one(".views-field-field-nomor-dokumen a")
        if not anchor:
            continue
        link = urljoin(base, anchor["href"])
        if not link.startswith("https://www.pajak.go.id/id/peraturan/"):
            continue
        def value(selector):
            field = row.select_one(selector)
            return " ".join(field.stripped_strings) if field else ""
        rows[link] = [anchor.get_text(strip=True), value(".views-field-title"),
                      value(".views-field-field-jenis-dokumen"), value("time"),
                      value(".views-field-field-status-peraturan"), link]
if not rows:
    raise ValueError("The DJP index returned no catalog records")
records = sorted(rows.values(), key=lambda row: row[3], reverse=True)
(root / "extension/regulation-data.js").write_text(
    "// Metadata from the public DJP index, see docs/KATALOG.md.\nexport const regulations = "
    + json.dumps(records, ensure_ascii=False, indent=1) + ";\n")
print(f"{len(records)} records")
