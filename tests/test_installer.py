"""Exercise the real first-party installer against deterministic local download doubles."""
import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts/install.sh"
APP_ID = "io.github.babakyaghoobii.nil-config-catcher"


def fake_curl(path):
    path.write_text('''#!/usr/bin/env python3
import os,shutil,sys
from pathlib import Path
args=sys.argv[1:]
url=args[-1]
prefix="https://github.com/babakyaghoobii/Nil-configs-catcher/releases/"
assert url.startswith(prefix), "Unexpected destination"
if "--head" in args:
    print(prefix+"tag/v1.0.0",end="")
else:
    assert url.startswith(prefix+"download/v1.0.0/"), "Unexpected tag"
    target=args[args.index("--output")+1]
    source=Path(os.environ["NIL_FIXTURE_ASSETS"])/url.rsplit("/",1)[1]
    shutil.copyfile(source,target)
''')
    path.chmod(0o755)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.bin = self.root / "bin"
        self.assets.mkdir()
        self.bin.mkdir()
        self.prefix = self.root / "profile with spaces"
        fake_curl(self.bin / "curl")
        (self.bin / "uname").write_text('#!/usr/bin/env bash\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n')
        (self.bin / "uname").chmod(0o755)
        self.env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "NIL_FIXTURE_ASSETS": str(self.assets)}
        (self.assets / "NIL-Config-Catcher-linux-x64.AppImage").write_bytes(b"\x7fELF" + b"synthetic test fixture; never executed")
        (self.assets / "nil-icon.png").write_bytes(b"synthetic icon fixture")
        self.manifest()

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self):
        (self.assets / "SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in self.assets.iterdir() if p.name != "SHA256SUMS"))

    def install(self, *args, success=True):
        result = subprocess.run(["bash", str(SCRIPT), "--prefix", str(self.prefix), *args], env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def test_installs_real_files_launcher_and_desktop_entry_with_space_paths(self):
        self.install("--version", "v1.0.0")
        app = self.prefix / "lib/nil-config-catcher/NIL-Config-Catcher.AppImage"
        self.assertEqual(app.read_bytes(), (self.assets / "NIL-Config-Catcher-linux-x64.AppImage").read_bytes())
        self.assertTrue(os.access(app, os.X_OK))
        launcher = self.prefix / "bin/nil-config-catcher"
        self.assertTrue(os.access(launcher, os.X_OK))
        entry = (self.prefix / f"share/applications/{APP_ID}.desktop").read_text()
        self.assertIn('Exec="', entry)
        self.assertIn("Terminal=false", entry)
        self.assertIn("Name=NIL Config Catcher", entry)
        self.assertIn("babakyaghoobii", entry)

    def test_rejects_tampering_before_any_installation(self):
        (self.assets / "NIL-Config-Catcher-linux-x64.AppImage").write_bytes(b"\x7fELFtampered")
        result = self.install("--version", "v1.0.0", success=False)
        self.assertIn("SHA-256 mismatch", result.stderr)
        self.assertFalse(self.prefix.exists())

    def test_missing_and_duplicate_checksums_are_rejected(self):
        manifest = self.assets / "SHA256SUMS"
        original = manifest.read_text()
        manifest.write_text("")
        self.install("--version", "v1.0.0", success=False)
        manifest.write_text(original + original)
        self.install("--version", "v1.0.0", success=False)
        self.assertFalse(self.prefix.exists())

    def test_rejects_url_and_shell_injection_in_release_tag(self):
        for value in ["../../main", "https://evil.test", "v1.0.0;touch injected", "v1/../../secret"]:
            with self.subTest(value=value):
                self.install("--version", value, success=False)
        self.assertFalse(self.prefix.exists())

    def test_uninstall_keeps_unrelated_files_and_requires_managed_identity(self):
        self.install("--version", "v1.0.0")
        other = self.prefix / "keep.txt"
        other.write_text("personal file")
        self.install("--uninstall")
        self.assertTrue(other.exists())
        self.assertFalse((self.prefix / "bin/nil-config-catcher").exists())
        target = self.prefix / "lib/nil-config-catcher"
        target.mkdir()
        (target / "keep.txt").write_text("not ours")
        self.install("--uninstall", success=False)
        self.assertTrue((target / "keep.txt").exists())

    def test_upgrade_and_pinned_latest_resolution(self):
        self.install()
        self.install("--version", "v1.0.0")
        self.assertTrue((self.prefix / f"share/applications/{APP_ID}.desktop").is_file())

    def test_rejects_non_elf_payload_even_with_matching_checksum(self):
        (self.assets / "NIL-Config-Catcher-linux-x64.AppImage").write_text("not a native program")
        self.manifest()
        self.install("--version", "v1.0.0", success=False)
        self.assertFalse(self.prefix.exists())


if __name__ == "__main__":
    unittest.main()
