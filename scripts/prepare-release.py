"""Gate public releases on the supplied creator logo and generate SHA-256 manifests."""
import hashlib
import json
import os
import re
import shutil
import sys
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tag = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", tag):
    raise SystemExit("Use a versioned release tag, such as v1.0.0")
versions = [json.loads((root / "package.json").read_text())["version"],
            json.loads((root / "src-tauri/tauri.conf.json").read_text())["version"],
            tomllib.loads((root / "src-tauri/Cargo.toml").read_text())["package"]["version"]]
if any(version != tag[1:] for version in versions):
    raise SystemExit("The tag and all package versions must match")
if not any((root / f"public/branding/creator-logo.{extension}").is_file() for extension in ["png", "svg"]):
    raise SystemExit("Public release blocked: the creator's actual logo has not been supplied yet. Draft builds remain available as Actions artifacts.")
if "--check-only" in sys.argv:
    print("Release version and creator logo are present")
    raise SystemExit(0)
out = root / "release-files"
required = {f"NIL-Config-Catcher-macos-{arch}.zip" for arch in ["arm64", "x64"]}
required.update(f"NIL-Config-Catcher-linux-{arch}.{extension}" for arch in ["arm64", "x64"] for extension in ["AppImage", "deb"])
missing = sorted(name for name in required if not (out / name).is_file())
if missing:
    raise SystemExit("Missing native assets: " + ", ".join(missing))
shutil.copy2(root / "scripts/install.sh", out / "install.sh")
shutil.copy2(root / "src-tauri/icons/icon.png", out / "nil-icon.png")
with (out / "SHA256SUMS").open("w") as manifest:
    for name in sorted(required | {"install.sh", "nil-icon.png"}):
        manifest.write(f"{hashlib.sha256((out / name).read_bytes()).hexdigest()}  {name}\n")
print(f"Release {tag}: all {len(required)} native packages, installer and icon verified")
