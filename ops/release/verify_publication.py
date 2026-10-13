#!/usr/bin/env python3
"""End-to-end check of a PUBLISHED build, from the outside, the way the founder sees it.

Credentials come ONLY from the environment (never arguments, never printed):
    APK_CATALOG_USER, APK_CATALOG_PASSWORD
    APK_CATALOG_BASE_URL   (default https://app.shramsafal.in/apk/)

    verify_publication.py --key apk/shramsafal-1.0.13-21-abc1234-0123456789ab.apk
        --apk LOCAL.apk --web-manifest web-dist.sha256
        --version-name 1.0.13 --version-code 21
        --kind test|release --latest this|not-this|skip
        [--expected-env ops/release/expected-release.env] [--web-base-url https://app.shramsafal.in]

Checks (any failure exits 1; PASS prints no secret):
  1. protection: the catalog and the APK answer 401/403 WITHOUT credentials;
  2. authenticated catalog lists the entry (key, versionName, versionCode, kind, sha256);
  3. permanent download is a genuine APK (zip magic, not an HTML fallback), its sha256
     equals the published one, and release_verify.verify_apk passes on the DOWNLOADED
     bytes: embedded web bundle == the released bundle manifest, package id, version,
     signer certificate == expected-release.env;
  4. latest download: --latest this -> same bytes; not-this -> must NOT be these
     bytes (a test publication must leave latest alone); skip -> not checked;
  5. optionally the live web app's index.html equals the bundle manifest's index.html.
Redirects are refused: credentials are never forwarded anywhere.
"""
import argparse
import base64
import gc
import hashlib
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request

import release_verify as rv


class Fail(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def fetch(url, creds=None, timeout=60):
    """-> (status, headers, body). Never raises on HTTP status; raises Fail on transport errors."""
    req = urllib.request.Request(url)
    if creds:
        tok = base64.b64encode(f"{creds[0]}:{creds[1]}".encode()).decode()
        req.add_header("Authorization", "Basic " + tok)
    try:
        with _opener.open(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.headers, e.read()
        finally:
            e.close()
    except (urllib.error.URLError, OSError) as e:
        raise Fail(f"cannot reach {url}: {getattr(e, 'reason', e)}")


def read_env_file(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k] = v
    return out


def check_genuine_apk(body, label):
    if body[:4] != b"PK\x03\x04":
        kind = "HTML (a fallback/error page)" if body.lstrip()[:1] == b"<" else "not a zip"
        raise Fail(f"{label} is {kind}, not an APK")


def entry_attrs(html, key):
    m = re.search(r'<article[^>]*data-key="%s"([^>]*)>' % re.escape(key), html)
    if not m:
        return None
    return dict(re.findall(r'data-([a-z0-9-]+)="([^"]*)"', m.group(0)))


def verify(base_url, creds, *, key, apk_path, web_manifest, version_name, version_code, kind,
           latest_mode, expected_env, web_base_url=None, log=print):
    base = base_url.rstrip("/") + "/"
    host_root = re.match(r"https?://[^/]+", base).group(0)
    with open(apk_path, "rb") as f:
        want_sha = hashlib.sha256(f.read()).hexdigest()
    perm_url = host_root + "/" + key
    latest_url = host_root + "/apk/shramsafal-latest.apk"

    # 1. protection
    for u in (base, perm_url):
        st, _h, _b = fetch(u)
        if st not in (401, 403):
            raise Fail(f"{u} answered {st} without credentials; expected 401/403 (access protection missing)")
    log("protection ok: catalog and APK refuse anonymous requests")

    # 2. catalog entry
    st, _h, body = fetch(base, creds)
    if st != 200:
        raise Fail(f"authenticated catalog answered {st}")
    attrs = entry_attrs(body.decode("utf-8", "replace"), key)
    if attrs is None:
        raise Fail(f"catalog does not list {key}")
    for name, got, want in (("version-name", attrs.get("version-name"), version_name),
                            ("version-code", attrs.get("version-code"), str(version_code)),
                            ("kind", attrs.get("kind"), kind), ("sha256", attrs.get("sha256"), want_sha)):
        if got != want:
            raise Fail(f"catalog entry {name} is {got!r}, expected {want!r}")
    log("catalog ok: entry lists the intended build")

    # 3. permanent download
    st, hdr, pbody = fetch(perm_url, creds, timeout=300)
    if st != 200:
        raise Fail(f"permanent download answered {st}")
    check_genuine_apk(pbody, "permanent download")
    if hashlib.sha256(pbody).hexdigest() != want_sha:
        raise Fail("permanent download sha256 differs from the published APK")
    with tempfile.NamedTemporaryFile(suffix=".apk", delete=False) as t:
        t.write(pbody)
    try:
        try:
            rv.verify_apk(t.name, web_manifest, expected_env["APP_ID"], version_name, version_code,
                          expected_env["SIGNER_SHA256"])
        except rv.Fail as e:
            raise Fail(f"downloaded APK failed release verification: {e}")
    finally:
        gc.collect()  # release_verify leaves its ZipFile to the GC; Windows cannot delete an open file
        try:
            os.remove(t.name)
        except OSError:
            pass
    log("permanent download ok: genuine APK, sha256, bundle, version, signer verified on the downloaded bytes")

    # 4. latest
    if latest_mode != "skip":
        st, _h, lbody = fetch(latest_url, creds, timeout=300)
        if st != 200:
            raise Fail(f"latest download answered {st}")
        check_genuine_apk(lbody, "latest download")
        same = hashlib.sha256(lbody).hexdigest() == want_sha
        if latest_mode == "this" and not same:
            raise Fail("latest does not serve this build")
        if latest_mode == "not-this" and same:
            raise Fail("latest serves this build, but this was not an approved-release promotion")
        log(f"latest ok ({latest_mode})")

    # 5. live web app
    if web_base_url:
        want_index = rv.read_manifest(web_manifest).get("index.html")
        st, _h, ib = fetch(web_base_url.rstrip("/") + "/index.html")
        if st != 200 or hashlib.sha256(ib).hexdigest() != want_index:
            raise Fail("live web app index.html does not match the released bundle manifest")
        log("web app ok: live index.html equals the released bundle")
    return "publication verified"


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--apk", required=True)
    ap.add_argument("--web-manifest", required=True)
    ap.add_argument("--version-name", required=True)
    ap.add_argument("--version-code", required=True, type=int)
    ap.add_argument("--kind", choices=("test", "release"), required=True)
    ap.add_argument("--latest", choices=("this", "not-this", "skip"), required=True)
    ap.add_argument("--web-base-url")
    ap.add_argument("--expected-env", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "expected-release.env"))
    a = ap.parse_args(argv[1:])
    user, pw = os.environ.get("APK_CATALOG_USER"), os.environ.get("APK_CATALOG_PASSWORD")
    if not user or not pw:
        print("FAIL: APK_CATALOG_USER / APK_CATALOG_PASSWORD are not set in the environment")
        return 2
    base = os.environ.get("APK_CATALOG_BASE_URL", "https://app.shramsafal.in/apk/")
    try:
        msg = verify(base, (user, pw), key=a.key, apk_path=a.apk, web_manifest=a.web_manifest,
                     version_name=a.version_name, version_code=a.version_code, kind=a.kind,
                     latest_mode=a.latest, expected_env=read_env_file(a.expected_env), web_base_url=a.web_base_url)
    except (Fail, rv.Fail) as e:
        print(f"FAIL: {str(e).replace(pw, '***')}")
        return 1
    print(f"PASS: {msg}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
