"""Tests for verify_publication.py against a LOCAL fake HTTP server (no network, no AWS).
Run: cd ops/release && python -m unittest -v test_verify_publication"""
import base64
import contextlib
import io
import os
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

import _fakeapk as fk
import publish_apk as pa
import verify_publication as vp

USER, PW = "tester", "s3cret-pw-for-tests"
ENVF = {"APP_ID": fk.APP_ID, "SIGNER_SHA256": fk.SIGNER}


class Site:
    """Mutable fake of the protected /apk/ site."""
    def __init__(self):
        self.require_auth = True
        self.routes = {}
        self.public = {"/index.html"}  # the web app itself is public


def make_server(site):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            want = "Basic " + base64.b64encode(f"{USER}:{PW}".encode()).decode()
            if site.require_auth and self.path not in site.public and self.headers.get("Authorization") != want:
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="x"')
                self.end_headers()
                return
            r = site.routes.get(self.path)
            if r is None:
                r = site.routes.get("*")  # SPA-style HTML fallback, like CloudFront custom error pages
            if r is None:
                self.send_response(404)
                self.end_headers()
                return
            if isinstance(r, tuple) and r[0] == "redirect":
                self.send_response(302)
                self.send_header("Location", r[1])
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(r)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def page(key, name="1.0.13", code="21", kind="test", sha=""):
    return (f'<html><article class="build" data-key="{key}" data-kind="{kind}" data-version-name="{name}" '
            f'data-version-code="{code}" data-sha256="{sha}"></article></html>').encode()


class VerifyTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        p = fk.patched()
        p.start()
        self.addCleanup(p.stop)
        self.apk = fk.make_apk(os.path.join(self.d, "a.apk"))
        self.wm = fk.web_manifest(os.path.join(self.d, "w.sha256"))
        with open(self.apk, "rb") as f:
            self.bytes = f.read()
        self.sha = pa.sha256_file(self.apk)
        self.key = pa.permanent_key("1.0.13", 21, fk.COMMIT, self.sha)
        self.site = Site()
        self.srv = make_server(self.site)
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.base = f"http://127.0.0.1:{self.srv.server_port}/apk/"
        self.site.routes = {"/apk/": page(self.key, sha=self.sha), "/" + self.key: self.bytes,
                            "/apk/shramsafal-latest.apk": b"PK\x03\x04older-approved-release"}

    def run_verify(self, **over):
        a = dict(key=self.key, apk_path=self.apk, web_manifest=self.wm, version_name="1.0.13", version_code=21,
                 kind="test", latest_mode="not-this", expected_env=ENVF, log=lambda *_: None)
        a.update(over)
        return vp.verify(self.base, (USER, PW), **a)

    # ---- passing fixture
    def test_good_publication_passes(self):
        self.assertEqual(self.run_verify(), "publication verified")

    def test_release_promotion_latest_this_passes(self):
        self.site.routes["/apk/shramsafal-latest.apk"] = self.bytes
        self.site.routes["/apk/"] = page(self.key, kind="release", sha=self.sha)
        self.run_verify(kind="release", latest_mode="this")

    # ---- failing fixtures (the gate fires)
    def test_unprotected_site_fails(self):
        self.site.require_auth = False
        with self.assertRaisesRegex(vp.Fail, "access protection missing"):
            self.run_verify()

    def test_missing_catalog_entry_fails(self):
        self.site.routes["/apk/"] = b"<html>nothing</html>"
        with self.assertRaisesRegex(vp.Fail, "does not list"):
            self.run_verify()

    def test_catalog_with_wrong_version_or_kind_fails(self):
        self.site.routes["/apk/"] = page(self.key, code="20", sha=self.sha)
        with self.assertRaisesRegex(vp.Fail, "version-code"):
            self.run_verify()
        self.site.routes["/apk/"] = page(self.key, kind="release", sha=self.sha)
        with self.assertRaisesRegex(vp.Fail, "kind"):
            self.run_verify()

    def test_html_fallback_instead_of_apk_fails(self):
        self.site.routes["/" + self.key] = b"<!doctype html><html>SPA shell</html>"
        with self.assertRaisesRegex(vp.Fail, "HTML"):
            self.run_verify()

    def test_different_bytes_fail_sha(self):
        self.site.routes["/" + self.key] = b"PK\x03\x04" + b"x" * 50
        with self.assertRaisesRegex(vp.Fail, "sha256 differs"):
            self.run_verify()

    def test_wrong_signer_in_downloaded_apk_fails(self):
        bad = fk.make_apk(os.path.join(self.d, "b.apk"), signer="0" * 64)
        self.apk = bad
        with open(bad, "rb") as f:
            self.site.routes["/" + self.key] = f.read()
        self.site.routes["/apk/"] = page(self.key, sha=pa.sha256_file(bad))
        with self.assertRaisesRegex(vp.Fail, "release verification"):
            self.run_verify()

    def test_embedded_bundle_not_matching_released_bundle_fails(self):
        other = fk.web_manifest(os.path.join(self.d, "o.sha256"), {"index.html": b"<html>different</html>"})
        with self.assertRaisesRegex(vp.Fail, "release verification"):
            self.run_verify(web_manifest=other)

    def test_test_publication_that_moved_latest_fails(self):
        self.site.routes["/apk/shramsafal-latest.apk"] = self.bytes
        with self.assertRaisesRegex(vp.Fail, "not an approved-release"):
            self.run_verify(latest_mode="not-this")

    def test_release_with_latest_not_updated_fails(self):
        self.site.routes["/apk/"] = page(self.key, kind="release", sha=self.sha)
        with self.assertRaisesRegex(vp.Fail, "latest does not serve"):
            self.run_verify(kind="release", latest_mode="this")

    def test_redirect_is_refused_not_followed(self):
        self.site.routes["/" + self.key] = ("redirect", "http://127.0.0.1:1/elsewhere")
        with self.assertRaisesRegex(vp.Fail, "permanent download answered 302"):
            self.run_verify()

    def test_live_web_index_mismatch_fails(self):
        self.site.routes["/index.html"] = b"<html>stale web</html>"
        with self.assertRaisesRegex(vp.Fail, "live web app"):
            self.run_verify(web_base_url=f"http://127.0.0.1:{self.srv.server_port}")
        self.site.routes["/index.html"] = fk.WEB["index.html"]
        self.run_verify(web_base_url=f"http://127.0.0.1:{self.srv.server_port}")

    # ---- CLI: credentials only from env, never echoed
    def cli(self, env):
        argv = ["x", "--key", self.key, "--apk", self.apk, "--web-manifest", self.wm, "--version-name", "1.0.13",
                "--version-code", "21", "--kind", "test", "--latest", "not-this"]
        for k in ("APK_CATALOG_USER", "APK_CATALOG_PASSWORD"):
            os.environ.pop(k, None)
        os.environ.update(env)
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in env])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = vp.main(argv)
        return rc, buf.getvalue()

    def test_cli_requires_env_credentials(self):
        rc, _ = self.cli({"APK_CATALOG_BASE_URL": self.base})
        self.assertEqual(rc, 2)

    def test_cli_pass_and_fail_never_print_password(self):
        env = {"APK_CATALOG_BASE_URL": self.base, "APK_CATALOG_USER": USER, "APK_CATALOG_PASSWORD": PW}
        rc, out = self.cli(env)
        self.assertEqual(rc, 0)
        self.assertNotIn(PW, out)
        self.site.routes["/apk/"] = b"nothing"
        rc, out = self.cli(env)
        self.assertEqual(rc, 1)
        self.assertNotIn(PW, out)
        env["APK_CATALOG_PASSWORD"] = "wrong"
        rc, out = self.cli(env)
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()
