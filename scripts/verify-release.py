"""Compare GitHub's uploaded-asset digests before publishing the draft release."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

tag = sys.argv[1]
if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", tag):
    raise SystemExit("Invalid release tag")
response = subprocess.run(["gh", "api", f"repos/babakyaghoobii/Nil-configs-catcher/releases/tags/{tag}"], check=True, capture_output=True, text=True)
release = json.loads(response.stdout)
if not release["draft"]:
    raise SystemExit("Refusing to overwrite an already published release")
assets = {item["name"]: item for item in release["assets"]}
root = Path(__file__).resolve().parent.parent / "release-files"
for path in root.iterdir():
    if path.is_file():
        expected = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        if assets.get(path.name, {}).get("digest") != expected:
            raise SystemExit(f"Uploaded digest mismatch or missing digest: {path.name}")
print("GitHub confirmed all uploaded SHA-256 digests")
