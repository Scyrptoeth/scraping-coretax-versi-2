"""Refresh DJP metadata for regulations cited by the capture and analysis guides."""
import json
import re
import subprocess
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

base = "https://www.pajak.go.id/id/peraturan/"
rules = {
    "pemeriksaan-pajak": ("15 TAHUN 2025", "Prosedur pemeriksaan pajak, termasuk pelaksanaan pemeriksaan dan pembahasan hasilnya."),
    "penyesuaian-pengaturan-di-bidang-pajak-penghasilan": ("55 TAHUN 2022", "Pengaturan PPh, termasuk pengenaan PPh atas penghasilan usaha dengan peredaran bruto tertentu."),
    "perubahan-atas-peraturan-pemerintah-nomor-55-tahun-2022-tentang-penyesuaian-pengaturan-0": ("20 TAHUN 2026", "Perubahan ketentuan PP 55 Tahun 2022 mengenai pengaturan di bidang PPh."),
    "ketentuan-perpajakan-dalam-rangka-pelaksanaan-sistem-inti-administrasi-perpajakan": ("81 TAHUN 2024", "Administrasi perpajakan dalam pelaksanaan sistem inti, antara lain pendaftaran, pembayaran dan pelaporan."),
    "penerapan-prinsip-kewajaran-dan-kelaziman-usaha-dalam-transaksi-yang-dipengaruhi-hubungan": ("172 TAHUN 2023", "Penerapan prinsip kewajaran dan kelaziman usaha serta dokumentasi penentuan harga transfer."),
    "petunjuk-pelaksanaan-pemotongan-pajak-atas-penghasilan-sehubungan-dengan-pekerjaan-jasa-1": ("168 TAHUN 2023", "Pelaksanaan pemotongan pajak atas penghasilan orang pribadi dari pekerjaan, jasa atau kegiatan."),
    "ketentuan-pelaporan-pajak-penghasilan-pajak-pertambahan-nilai-pajak-penjualan-atas-0": ("PER-11/PJ/2025", "Pelaporan PPh, PPN, PPnBM dan Bea Meterai melalui sistem inti administrasi perpajakan."),
    "perubahan-atas-peraturan-direktur-jenderal-pajak-nomor-11pj2025-tentang-ketentuan": ("PER-12/PJ/2026", "Perubahan ketentuan pelaporan dalam PER-11/PJ/2025, termasuk pembetulan dan dokumen pemotongan atau pemungutan."),
    "penunjukan-pihak-lain-sebagai-pemungut-pajak-penghasilan-serta-tata-cara-pemungutan": ("37 TAHUN 2025", "Penunjukan pihak lain serta tata cara pemungutan dan pelaporan PPh atas penghasilan pedagang dalam negeri melalui sistem elektronik."),
    "klasifikasi-lapangan-usaha-wajib-pajak-2": ("PER-12/PJ/2022", "Penentuan klasifikasi kegiatan utama WP dan klasifikasi khusus bagi orang pribadi."),
}
amendments = [("PER-11/PJ/2025", "PER-12/PJ/2026"), ("55 TAHUN 2022", "20 TAHUN 2026")]

records = {}
for slug, (expected, summary) in rules.items():
    url = base + slug
    html = subprocess.check_output(["curl", "-fsSL", "--max-time", "25", url])
    soup = BeautifulSoup(html, "html.parser")

    def field(name):
        tag = soup.select_one(".field--name-field-" + name)
        if tag is None:
            return ""
        item = tag.select_one(".field__item") or tag
        return " ".join(item.stripped_strings)

    doc_number = field("nomor-dokumen")
    if re.sub(r"\s+", "", doc_number.upper()) != re.sub(r"\s+", "", expected.upper()):
        raise ValueError(f"Document number mismatch on {url}: {doc_number!r}")
    when = soup.select_one(".field--name-field-tanggal-peraturan time")
    if not when:
        raise ValueError(f"Document date unavailable on {url}")
    day = date.fromisoformat(when["datetime"][:10]).isoformat()
    status = field("status-peraturan") or "Tidak tercantum pada sumber"
    terms = soup.select(".field--name-field-kategori-peraturan .field__item")
    topics = list(dict.fromkeys(" ".join(tag.stripped_strings) for tag in terms))
    title = " ".join(soup.title.get_text(" ", strip=True).split("|")[0].split())
    records[expected] = {"cells": [doc_number, title, field("jenis-dokumen"), day, status, url],
                         "summary": summary, "topics": topics, "related": []}
for old, new in amendments:
    before, after = records[old], records[new]
    for item, other, label in [(before, after, "Diubah oleh"), (after, before, "Mengubah")]:
        number, _, kind, _, _, url = other["cells"]
        item["related"].append({"label": f"{label} {kind} {number}", "url": url})

destination = Path(__file__).resolve().parents[1] / "extension" / "regulation-details.js"
destination.write_text("// Public DJP metadata and editorial topic summaries. See docs/KATALOG.md.\n"
                       + "export const regulationDetails = " + json.dumps(list(records.values()), ensure_ascii=False, indent=1) + ";\n")
print(f"{len(records)} verified documents")
