"""Extract public classification codes and titles from the two official BPS PDFs."""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]


def lines_2020(pdf):
    with fitz.open(pdf) as doc:
        for page in doc:
            rows = {}
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    if line["dir"][0] < .99:
                        continue
                    for span in line["spans"]:
                        left, top = span["bbox"][:2]
                        if (48 < top < 665 and (span["font"].startswith("SegoeUI") or span["font"] == "Verdana")
                                and span["text"].strip()):
                            y = next((y for y in rows if abs(y - top) < 1.5), round(top))
                            rows.setdefault(y, []).append((left, span["text"]))
            for y in sorted(rows):
                yield " ".join(text.strip() for _, text in sorted(rows[y]))


def extract(year, lines):
    entries = {}
    started = False
    previous = None
    for raw in lines:
        line = " ".join(raw.split())
        if re.fullmatch(r"A PERTANIAN, KEHUTANAN(,)? DAN PERIKANAN", line):
            started = True
        if not started or not line or re.fullmatch(r"- \d+ -", line):
            continue
        header = re.fullmatch(r"([A-V]|\d{2,5}) ([A-Z].+)", line)
        if header and header[2].isupper():
            key, title = header.groups()
            if key in entries:
                raise ValueError(f"Duplicate code: {year} {key} {line}")
            entries[key] = title
            previous = key
        elif previous and line.isupper() and line[0].isalpha() and not line.startswith("KATEGORI "):
            entries[previous] += " " + line
        else:
            previous = None
    return entries


def main():
    old, new = map(Path, sys.argv[1:])
    lines = subprocess.check_output(["pdftotext", "-layout", str(new), "-"], text=True)
    records = {"2020": extract("2020", lines_2020(old)), "2025": extract("2025", lines.splitlines())}
    expected = {"2020": [21, 88, 245, 567, 1789], "2025": [22, 87, 257, 519, 1559]}
    for year, rows in records.items():
        counts = Counter(map(len, rows))
        print(year, sorted(counts.items()))
        if [counts[n] for n in range(1, 6)] != expected[year]:
            raise ValueError(f"Check against BPS counts for {year}")
    output = ROOT / "extension" / "catalog-data.js"
    output.write_text("// Codes and titles from BPS. See docs/KATALOG.md.\nexport const kbli = "
                      + json.dumps(records, ensure_ascii=False, indent=1) + ";\n")


if __name__ == "__main__":
    main()
