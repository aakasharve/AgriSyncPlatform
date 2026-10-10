"""Negative-control tests for release_verify.py. Run: python -m unittest ops/release/test_release_verify.py

The APK tests need a real APK to read a compiled manifest and signing block from.
They run when RELEASE_TEST_APK points at one (the previously published APK works:
it is 1.0.12/20, signer 3b3f860b...); otherwise they are skipped, never faked.
"""
import hashlib
import json
import os
import shutil
import tempfile
import unittest
import zipfile

import release_verify as rv

SHA = "a" * 40
SIGNER = "3b3f860b6faa4d132497b8d799a615c78c55cb7a18323a972d3d9e5d250aa33d"


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def make_dist(root, files):
    for rel, data in files.items():
        write(os.path.join(root, rel), data)
    lines = [f"{hashlib.sha256(d).hexdigest()}  ./{rel}" for rel, d in sorted(files.items())]
    mf = os.path.join(root, "..", "manifest.sha256")
    with open(mf, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    return os.path.normpath(mf)


class RunTests(unittest.TestCase):
    def run_json(self, **over):
        d = {"workflowName": "release-build", "conclusion": "success", "headSha": SHA}
        d.update(over)
        p = tempfile.mktemp(suffix=".json")
        with open(p, "w") as f:
            json.dump(d, f)
        self.addCleanup(os.remove, p)
        return p

    def test_good_run_passes(self):
        rv.verify_run(self.run_json(), "release-build", SHA)

    def test_wrong_sha_rejected(self):
        with self.assertRaises(rv.Fail):
            rv.verify_run(self.run_json(headSha="b" * 40), "release-build", SHA)

    def test_failed_run_rejected(self):
        for c in ("failure", "cancelled", None):
            with self.assertRaises(rv.Fail):
                rv.verify_run(self.run_json(conclusion=c), "release-build", SHA)

    def test_wrong_workflow_rejected(self):
        with self.assertRaises(rv.Fail):
            rv.verify_run(self.run_json(workflowName="web-release"), "release-build", SHA)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dist = os.path.join(self.tmp, "dist")
        self.manifest = make_dist(self.dist, {
            "index.html": b"<html>x</html>", "assets/index-ab12cd34.js": b"console.log(1)",
            "sw.js": b"//sw"})

    def test_intact_bundle_passes(self):
        self.assertIn("bundle ok", rv.verify_bundle(self.dist, self.manifest))

    def test_corrupted_file_rejected(self):
        write(os.path.join(self.dist, "assets/index-ab12cd34.js"), b"console.log(2)")
        with self.assertRaisesRegex(rv.Fail, "hash mismatch"):
            rv.verify_bundle(self.dist, self.manifest)

    def test_extra_file_rejected(self):
        write(os.path.join(self.dist, "evil.js"), b"x")
        with self.assertRaisesRegex(rv.Fail, "not in manifest"):
            rv.verify_bundle(self.dist, self.manifest)

    def test_missing_file_rejected(self):
        os.remove(os.path.join(self.dist, "sw.js"))
        with self.assertRaisesRegex(rv.Fail, "missing"):
            rv.verify_bundle(self.dist, self.manifest)

    def test_binary_mode_manifest_accepted(self):
        # Windows sha256sum writes "hash *./path"
        with open(self.manifest, encoding="utf-8") as fh:
            text = fh.read().replace("  ./", " *./")
        with open(self.manifest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        self.assertIn("bundle ok", rv.verify_bundle(self.dist, self.manifest))

    def test_malformed_manifest_rejected(self):
        with open(self.manifest, "w") as f:
            f.write("not a manifest\n")
        with self.assertRaises(rv.Fail):
            rv.verify_bundle(self.dist, self.manifest)


class ReleaseManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.apk = os.path.join(self.tmp, "a.apk"); write(self.apk, b"apk-bytes")
        self.web = os.path.join(self.tmp, "w.sha256"); write(self.web, b"web-manifest")
        self.js = os.path.join(self.tmp, "release-manifest.json")
        self.write_json()

    def write_json(self, **over):
        d = {"git_sha": SHA, "apk_sha256": hashlib.sha256(b"apk-bytes").hexdigest(),
             "web_manifest_sha256": hashlib.sha256(b"web-manifest").hexdigest()}
        d.update(over)
        with open(self.js, "w") as f:
            json.dump(d, f)

    def test_matching_passes(self):
        rv.verify_release_manifest(self.js, self.apk, self.web, SHA)

    def test_wrong_sha_rejected(self):
        with self.assertRaises(rv.Fail):
            rv.verify_release_manifest(self.js, self.apk, self.web, "c" * 40)

    def test_swapped_apk_rejected(self):
        write(self.apk, b"a different apk")
        with self.assertRaisesRegex(rv.Fail, "APK sha256"):
            rv.verify_release_manifest(self.js, self.apk, self.web, SHA)

    def test_swapped_web_manifest_rejected(self):
        write(self.web, b"another manifest")
        with self.assertRaisesRegex(rv.Fail, "web manifest"):
            rv.verify_release_manifest(self.js, self.apk, self.web, SHA)


REAL = os.environ.get("RELEASE_TEST_APK")


@unittest.skipUnless(REAL and os.path.exists(REAL), "set RELEASE_TEST_APK to a real APK")
class ApkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        z = zipfile.ZipFile(REAL)
        files = {n[len("assets/public/"):]: z.read(n) for n in z.namelist()
                 if n.startswith("assets/public/") and not n.endswith("/")
                 and n[len("assets/public/"):] not in rv.ALLOWED_EXTRA_PUBLIC}
        self.manifest = make_dist(os.path.join(self.tmp, "dist"), files)
        self.kw = dict(app_id="com.agrisync.shramsafal", version_name="1.0.12",
                       version_code="20", signer_sha256=SIGNER)

    def check(self, apk=None, **over):
        kw = dict(self.kw); kw.update(over)
        return rv.verify_apk(apk or REAL, self.manifest, **kw)

    def test_matching_apk_passes(self):
        self.assertIn("apk ok", self.check())

    def test_wrong_version_rejected(self):
        with self.assertRaisesRegex(rv.Fail, "versionName"):
            self.check(version_name="1.0.13")
        with self.assertRaisesRegex(rv.Fail, "versionCode"):
            self.check(version_code="21")

    def test_wrong_application_id_rejected(self):
        with self.assertRaisesRegex(rv.Fail, "application id"):
            self.check(app_id="com.example.other")

    def test_signer_discontinuity_rejected(self):
        with self.assertRaisesRegex(rv.Fail, "continuity"):
            self.check(signer_sha256="de6277b1cd84ff0239e9f27cc4b04ac787beb4b5b91a0c728f1bba9412a26bf7")

    def test_apk_with_different_bundle_rejected(self):
        # manifest built from the real APK, but one recorded hash is wrong -> APK asset differs
        with open(self.manifest, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        lines[0] = ("0" * 64) + lines[0][64:]
        with open(self.manifest, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")
        with self.assertRaisesRegex(rv.Fail, "differs"):
            self.check()

    def test_bundle_file_absent_from_apk_rejected(self):
        with open(self.manifest, "a", encoding="utf-8", newline="\n") as f:
            f.write(("1" * 64) + "  ./not-in-apk.js\n")
        with self.assertRaisesRegex(rv.Fail, "absent"):
            self.check()

    def test_corrupted_apk_rejected(self):
        bad = os.path.join(self.tmp, "bad.apk")
        with open(REAL, "rb") as fh:
            data = bytearray(fh.read())
        data[len(data) // 3] ^= 0xFF   # flip a byte inside compressed content
        with open(bad, "wb") as fh:
            fh.write(data)
        with self.assertRaises(rv.Fail):
            self.check(apk=bad)

    def test_unsigned_apk_rejected(self):
        unsigned = os.path.join(self.tmp, "unsigned.apk")
        with zipfile.ZipFile(REAL) as zi, zipfile.ZipFile(unsigned, "w") as zo:
            for n in zi.namelist():
                zo.writestr(n, zi.read(n))
        with self.assertRaisesRegex(rv.Fail, "signing block"):
            self.check(apk=unsigned)


if __name__ == "__main__":
    unittest.main()
