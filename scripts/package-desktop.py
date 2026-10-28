"""Package verified native binaries without embedding credentials or executing configs."""
import argparse
import plistlib
import shutil
import struct
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--platform", choices=["macos", "linux"], required=True)
parser.add_argument("--arch", choices=["arm64", "x64"], required=True)
parser.add_argument("--target", choices=["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"], required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
bundle = root / "src-tauri" / "target" / args.target / "release" / "bundle"
output = root / "release-files"
output.mkdir(exist_ok=True)
name = f"NIL-Config-Catcher-{args.platform}-{args.arch}"

if args.platform == "macos":
    app = bundle / "macos" / "NIL Config Catcher.app"
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == "io.github.babakyaghoobii.nil-config-catcher"
    binary = app / "Contents/MacOS" / info["CFBundleExecutable"]
    with binary.open("rb") as stream:
        magic, cpu = struct.unpack("<II", stream.read(8))
    assert magic == 0xFEEDFACF and cpu == (0x0100000C if args.arch == "arm64" else 0x01000007), "Unexpected Mach-O architecture"
    icon = info["CFBundleIconFile"]
    assert (app / "Contents/Resources" / (icon if icon.endswith(".icns") else icon + ".icns")).is_file()
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(output / (name + ".zip"))], check=True)
else:
    images = list((bundle / "appimage").glob("*.AppImage"))
    debs = list((bundle / "deb").glob("*.deb"))
    assert len(images) == len(debs) == 1, "Expected one AppImage and one Debian package"
    with images[0].open("rb") as stream:
        header = stream.read(20)
        assert header[:4] == b"\x7fELF", "Expected a native ELF AppImage"
        assert struct.unpack("<H", header[18:20])[0] == (183 if args.arch == "arm64" else 62), "Unexpected ELF architecture"
    shutil.copy2(images[0], output / (name + ".AppImage"))
    shutil.copy2(debs[0], output / (name + ".deb"))
    subprocess.run(["dpkg-deb", "--field", str(debs[0]), "Package", "Version", "Architecture"], check=True)
print(f"Packaged {name}")
