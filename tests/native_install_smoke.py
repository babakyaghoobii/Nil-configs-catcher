"""Install/uninstall the actual CI-built native asset, not a shortcut or mock binary."""
import argparse
import hashlib
import os
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from test_installer import APP_ID, SCRIPT, fake_curl

parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["macos", "linux"], required=True)
parser.add_argument("--arch", choices=["arm64", "x64"], required=True)
args = parser.parse_args()
repo = SCRIPT.parent.parent
with tempfile.TemporaryDirectory(prefix="nil-native-install-") as temporary:
    root = Path(temporary)
    assets, tools = root / "assets", root / "tools"
    assets.mkdir()
    tools.mkdir()
    fake_curl(tools / "curl")
    extension = "zip" if args.platform == "macos" else "AppImage"
    name = f"NIL-Config-Catcher-{args.platform}-{args.arch}.{extension}"
    shutil.copy2(repo / "release-files" / name, assets / name)
    shutil.copy2(repo / "src-tauri/icons/icon.png", assets / "nil-icon.png")
    (assets / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in assets.iterdir()))
    # Match the built target's asset selection; no architecture emulation is claimed.
    cpu = "arm64" if args.arch == "arm64" else "x86_64"
    system = "Darwin" if args.platform == "macos" else "Linux"
    (tools / "uname").write_text(f'#!/usr/bin/env bash\nif [ "$1" = -s ]; then echo {system}; else echo {cpu}; fi\n')
    (tools / "uname").chmod(0o755)
    env = {**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"], "NIL_FIXTURE_ASSETS": str(assets)}
    flag = "--app-dir" if args.platform == "macos" else "--prefix"
    destination = root / ("Applications" if args.platform == "macos" else "local")
    command = ["bash", str(SCRIPT), "--version", "v1.0.0", flag, str(destination)]
    subprocess.run(command, env=env, check=True)
    if args.platform == "macos":
        app = destination / "NIL Config Catcher.app"
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        assert info["CFBundleIdentifier"] == APP_ID
        assert (app / "Contents/MacOS" / info["CFBundleExecutable"]).is_file()
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    else:
        entry = destination / f"share/applications/{APP_ID}.desktop"
        subprocess.run(["desktop-file-validate", str(entry)], check=True)
        assert os.access(destination / "bin/nil-config-catcher", os.X_OK)
        launched = subprocess.run(["timeout", "20s", "dbus-run-session", "--", "xvfb-run", "-a", str(destination / "bin/nil-config-catcher")], env={**env, "PATH": os.environ["PATH"]}, capture_output=True, text=True)
        if launched.returncode != 124:
            raise SystemExit("Native Linux app did not remain running for the GUI smoke test:\n" + launched.stdout + launched.stderr)
        print("Actual Linux GUI stayed running under Xvfb for 20 seconds without FUSE")
    subprocess.run(command + ["--uninstall"], env=env, check=True)
    print(f"Verified actual {args.platform}/{args.arch} package installation and removal")
