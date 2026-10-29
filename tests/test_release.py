"""Release contract: discover drafts, and reject missing or mismatched uploads."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nil-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "release-files").mkdir()
        (self.root / "bin").mkdir()
        source = Path(__file__).resolve().parent.parent / "scripts/verify-release.py"
        shutil.copyfile(source, self.root / "scripts/verify-release.py")
        payload = b"real checksum fixture, never executed"
        (self.root / "release-files/install.sh").write_bytes(payload)
        self.release = {"tag_name": "v1.0.0", "draft": True, "assets": [
            {"name": "install.sh", "digest": "sha256:" + hashlib.sha256(payload).hexdigest()}]}
        gh = self.root / "bin/gh"
        gh.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
# The tag endpoint cannot see a draft. Match the authenticated list contract.
if sys.argv[1:] != ['api', '--paginate', '--slurp', 'repos/babakyaghoobii/Nil-configs-catcher/releases?per_page=100']:
    raise SystemExit(1)
print(Path(os.environ['NIL_RELEASE_RESPONSE']).read_text())
""")
        gh.chmod(0o755)
        self.env = {**os.environ, "PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"],
                    "NIL_RELEASE_RESPONSE": str(self.root / "response.json")}

    def verify(self):
        # A preceding page contains other releases. The draft is on page two.
        (self.root / "response.json").write_text(json.dumps([
            [{"tag_name": "v0.9.0", "draft": False, "assets": []}], [self.release]]))
        return subprocess.run(["python3", str(self.root / "scripts/verify-release.py"), "v1.0.0"],
                              env=self.env, capture_output=True, text=True)

    def test_finds_draft_on_later_page_and_verifies_bytes(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("confirmed all uploaded SHA-256", result.stdout)

    def test_refuses_already_published_release(self):
        self.release["draft"] = False
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already published", result.stderr)

    def test_rejects_wrong_digest_and_missing_upload(self):
        self.release["assets"][0]["digest"] = "sha256:" + "0" * 64
        self.assertNotEqual(self.verify().returncode, 0)
        self.release["assets"] = []
        self.assertNotEqual(self.verify().returncode, 0)
