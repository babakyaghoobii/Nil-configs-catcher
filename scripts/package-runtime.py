"""Deterministic, auditable web + service transfer bundle for the hosted adapter."""
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
files = {}
for path in sorted((root / "dist-hosted").rglob("*")):
    if path.is_file():
        files["site/" + path.relative_to(root / "dist-hosted").as_posix()] = path.read_bytes()
for path in sorted((root / "service").glob("*.ts")):
    files["service/" + path.name] = path.read_bytes()
for path in sorted((root / "service/migrations").glob("*.sql")):
    files["migrations/" + path.name] = path.read_bytes()
if "site/index.html" not in files or "service/api.ts" not in files:
    raise SystemExit("Build the hosted site before packaging")
manifest = {"sourceRepository": "babakyaghoobii/Nil-configs-catcher", "sourceCommit": revision,
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
files["provenance.json"] = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
target = root / "deploy"
target.mkdir(exist_ok=True)
with (target / "nil-runtime.tar.gz").open("wb") as output:
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for name, data in sorted(files.items()):
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(data), 0o644, 0
                archive.addfile(info, io.BytesIO(data))
digest = hashlib.sha256((target / "nil-runtime.tar.gz").read_bytes()).hexdigest()
(target / "SHA256SUMS").write_text(digest + "  nil-runtime.tar.gz\n")
(target / "provenance.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
print(json.dumps({"sourceCommit": revision, "sha256": digest, "files": len(files)}))
