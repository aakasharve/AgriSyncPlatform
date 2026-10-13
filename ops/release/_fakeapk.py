"""Test kit: synthetic 'APKs' (zip files) whose compiled manifest/signer are decoded by
patched release_verify readers. Real binary AXML/signing-block parsing is covered by
test_release_verify.py against the real APK; here we test publication logic."""
import hashlib
import zipfile
from unittest import mock

import release_verify as rv

APP_ID = "com.agrisync.shramsafal"
SIGNER = "3b3f860b6faa4d132497b8d799a615c78c55cb7a18323a972d3d9e5d250aa33d"
COMMIT = "12cace63" + "0" * 32
WEB = {"index.html": b"<html>app</html>", "assets/a.js": b"console.log(1)"}


def web_manifest(path, files=WEB):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for rel, data in sorted(files.items()):
            f.write(f"{hashlib.sha256(data).hexdigest()}  ./{rel}\n")
    return path


def make_apk(path, version_name="1.0.13", version_code=21, pkg=APP_ID, signer=SIGNER, files=WEB, salt=b""):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("AndroidManifest.xml", f"{pkg}|{version_name}|{version_code}|{signer}")
        for rel, data in files.items():
            z.writestr("assets/public/" + rel, data)
        z.writestr("classes.dex", b"dex" + salt)
    return path


def patched():
    """Patcher: decode the synthetic manifest/signer instead of binary AXML. Use .start()/.stop() or `with`."""
    def cm(data):
        pkg, vn, vc, _s = data.decode().split("|")
        return {"package": pkg, "versionName": vn, "versionCode": int(vc)}

    def signers(path):
        with zipfile.ZipFile(path) as z:
            return {"v2": [z.read("AndroidManifest.xml").decode().split("|")[3]]}
    return mock.patch.multiple(rv, read_compiled_manifest=cm, signer_cert_sha256s=signers)
