"""Build a reproducible Chrome extension ZIP and its static distribution site."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
manifest = json.loads((EXTENSION / "manifest.json").read_text())
version = manifest["version"]
site = ROOT / "dist" / "site"
site.mkdir(parents=True, exist_ok=True)
for path in (ROOT / "site").iterdir():
    if path.is_file() and not path.name.startswith("."):
        destination = site / path.name
        if path.name == "index.html":
            destination.write_text(path.read_text(encoding="utf-8").replace("{{EXTENSION_VERSION}}", version), encoding="utf-8")
        else:
            shutil.copy2(path, destination)
downloads = site / "download"
downloads.mkdir(exist_ok=True)
archive = downloads / f"scraping-coretax-v2-{version}.zip"
allowed = {".html", ".js", ".mjs", ".css", ".json", ".png", ".woff2", ".txt"}
required = {"manifest.json", "background.js", "app.html", "analisis/index.html", *manifest["icons"].values()}
with zipfile.ZipFile(archive, "w") as out:
    for file in sorted(EXTENSION.rglob("*")):
        if not file.is_file() or file.name.startswith("."):
            continue
        if file.is_symlink() or file.suffix not in allowed:
            raise ValueError(f"Unexpected release asset: {file}")
        member = zipfile.ZipInfo(file.relative_to(EXTENSION).as_posix())
        member.compress_type = zipfile.ZIP_DEFLATED
        member.external_attr = 0o100644 << 16
        out.writestr(member, file.read_bytes())
    missing = required.difference(out.namelist())
    if missing:
        raise ValueError(f"Missing release assets: {sorted(missing)}")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(downloads / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n")
print(f"{archive.relative_to(ROOT)}  {digest}")
