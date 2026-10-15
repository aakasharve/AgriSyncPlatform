#!/usr/bin/env python3
"""Publish a VERIFIED release APK into the private APK library, fail-closed.

Called only by .github/workflows/android-release.yml, after release_verify.py has
verified the artifact. Standard library only. Talks to AWS exclusively through the
`aws` CLI, behind the small AwsStore class, so every decision below is unit-tested
against an in-memory store (test_publish_apk.py) without any cloud access.

Library rules (founder requirements):
  * Every build gets a unique PERMANENT key derived from the VERIFIED APK:
        apk/shramsafal-<versionName>-<versionCode>-<commit7>-<apksha12>.apk
    written with S3 conditional create (If-None-Match: *). Re-publishing identical
    bytes is a no-op; the same key holding DIFFERENT bytes is a hard failure.
    Nothing is ever deleted or overwritten.
  * A metadata record apk/meta/<stem>.json holds version/build/package/signer (read
    from the compiled AndroidManifest of the APK, never from commit messages),
    commit, run id, kind (test|release), publication time.
  * apk/shramsafal-latest.apk (+ apk/meta/latest.json) moves ONLY for
    kind=release with promote_latest=true, and never to a versionCode that is not
    strictly above the current latest (equal only if the very same bytes).
  * The catalog page (apk/index.html) is regenerated from the metadata records and
    the CloudFront cache for the page and the latest pointer is invalidated; a
    failed invalidation fails the run (content is uploaded, rerun is idempotent).
  * dry-run (the default) performs NO AWS call at all.

CLI:  publish_apk.py --apk F --web-manifest F --commit SHA --run-id ID
                     --kind test|release [--promote-latest] [--approval-ref REF]
                     [--report-json F] [--execute]
Env:  EXPECTED env vars from ops/release/expected-release.env (APP_ID, SIGNER_SHA256,
      PREVIOUS_VERSION_CODE), APK_BUCKET (default shramsafal-app-prod),
      APK_CF_DISTRIBUTION (required for --execute). AWS credentials come from the
      standard AWS_* environment set by aws-actions/configure-aws-credentials.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import release_verify as rv

PREFIX = "apk/"
LATEST_KEY = PREFIX + "shramsafal-latest.apk"
LATEST_META_KEY = PREFIX + "meta/latest.json"
INDEX_KEY = PREFIX + "index.html"
APK_TYPE = "application/vnd.android.package-archive"
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache, no-store, must-revalidate"
INVALIDATE_PATHS = ["/apk/", "/apk/index.html", "/apk/shramsafal-latest.apk", "/apk/meta/latest.json"]


class Fail(Exception):
    pass


class Exists(Exception):
    """Conditional create refused: the key already exists."""


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ metadata
def permanent_key(version_name, version_code, commit, apk_sha):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version_name or ""):
        raise Fail(f"versionName {version_name!r} is not N.N.N; refusing to build a key from it")
    if not isinstance(version_code, int) or version_code <= 0:
        raise Fail(f"versionCode {version_code!r} invalid")
    if not re.fullmatch(r"[0-9a-f]{40}", commit or ""):
        raise Fail("commit must be a full 40-hex sha")
    if not re.fullmatch(r"[0-9a-f]{64}", apk_sha):
        raise Fail("apk sha256 invalid")
    return f"{PREFIX}shramsafal-{version_name}-{version_code}-{commit[:7]}-{apk_sha[:12]}.apk"


def meta_key_for(key):
    return PREFIX + "meta/" + key[len(PREFIX):-len(".apk")] + ".json"


def build_meta(apk, web_manifest, *, kind, commit, run_id, now, approval_ref, app_id, signer_sha256):
    """Everything about the build that the catalog shows, from the VERIFIED apk."""
    if kind not in ("test", "release"):
        raise Fail("kind must be test or release")
    if kind == "release" and not (approval_ref or "").strip():
        raise Fail("kind=release needs --approval-ref (who/what approved this build)")
    try:
        z = zipfile.ZipFile(apk)
        cm = rv.read_compiled_manifest(z.read("AndroidManifest.xml"))
    except (zipfile.BadZipFile, KeyError, rv.Fail) as e:
        raise Fail(f"cannot read the APK's compiled manifest: {e}")
    if cm["package"] != app_id:
        raise Fail(f"package {cm['package']!r} != expected {app_id!r}")
    try:
        signers = rv.signer_cert_sha256s(apk)
    except rv.Fail as e:
        raise Fail(f"signer check failed: {e}")
    for scheme, certs in signers.items():
        if certs != [signer_sha256.lower()]:
            raise Fail(f"{scheme} signer is not the expected signer")
    sha = sha256_file(apk)
    web_entries = rv.read_manifest(web_manifest)
    key = permanent_key(cm["versionName"], cm["versionCode"], commit, sha)
    return {
        "schema": 1, "kind": kind, "key": key, "file": key[len(PREFIX):], "sha256": sha,
        "sizeBytes": os.path.getsize(apk), "package": cm["package"],
        "versionName": cm["versionName"], "versionCode": cm["versionCode"],
        "signerSha256": signer_sha256.lower(), "commit": commit, "runId": str(run_id),
        "webManifestSha256": sha256_file(web_manifest),
        "webIndexSha256": web_entries.get("index.html"),
        "publishedAt": now,
        "approvalRef": approval_ref or None, "approvedAt": now if kind == "release" else None,
    }


# --------------------------------------------------------------------- store
class AwsStore:
    """Thin wrapper over the aws CLI. Every unexpected outcome raises Fail."""

    def __init__(self, bucket, distribution, runner=None):
        self.bucket, self.distribution = bucket, distribution
        self._run = runner or self._subprocess

    @staticmethod
    def _subprocess(args):
        p = subprocess.run(["aws", *args], capture_output=True)
        return p.returncode, p.stdout, p.stderr.decode("utf-8", "replace")

    def _ok(self, args, what):
        rc, out, err = self._run(args)
        if rc != 0:
            raise Fail(f"{what} failed: {err.strip()[:300]}")
        return out

    @staticmethod
    def _missing(err):
        return any(t in err for t in ("404", "Not Found", "NoSuchKey"))

    def head(self, key):
        rc, out, err = self._run(["s3api", "head-object", "--bucket", self.bucket, "--key", key, "--output", "json"])
        if rc != 0:
            if self._missing(err):
                return None
            raise Fail(f"head-object {key} failed (not a clean 404, refusing to assume absent): {err.strip()[:300]}")
        j = json.loads(out or b"{}")
        return {"sha256": (j.get("Metadata") or {}).get("sha256"), "size": j.get("ContentLength")}

    def get(self, key):
        if self.head(key) is None:
            return None
        return self._ok(["s3", "cp", f"s3://{self.bucket}/{key}", "-"], f"get {key}")

    def put(self, key, path, *, content_type, cache_control, sha256=None, if_none_match=False):
        args = ["s3api", "put-object", "--bucket", self.bucket, "--key", key, "--body", path,
                "--content-type", content_type, "--cache-control", cache_control]
        if sha256:
            args += ["--metadata", f"sha256={sha256}"]
        if if_none_match:
            args += ["--if-none-match", "*"]
        rc, _out, err = self._run(args)
        if rc != 0:
            if if_none_match and ("PreconditionFailed" in err or "412" in err or "ConditionalRequestConflict" in err):
                raise Exists(key)
            raise Fail(f"put-object {key} failed: {err.strip()[:300]}")

    def list_objects(self):
        out = self._ok(["s3api", "list-objects-v2", "--bucket", self.bucket, "--prefix", PREFIX,
                        "--query", "Contents[].{K:Key,S:Size,M:LastModified}", "--output", "json"], "list-objects-v2")
        return json.loads(out or b"null") or []

    def download_meta(self, dest):
        self._ok(["s3", "sync", f"s3://{self.bucket}/{PREFIX}meta/", dest, "--only-show-errors"], "sync meta")

    def invalidate(self, paths):
        out = self._ok(["cloudfront", "create-invalidation", "--distribution-id", self.distribution,
                        "--paths", *paths, "--query", "Invalidation.Id", "--output", "text"], "create-invalidation")
        inv = out.decode().strip()
        if not re.fullmatch(r"[A-Z0-9]{8,}", inv):
            raise Fail("create-invalidation returned no invalidation id")
        self._ok(["cloudfront", "wait", "invalidation-completed", "--distribution-id", self.distribution, "--id", inv],
                 "wait invalidation-completed")
        return inv


# ------------------------------------------------------------------- publish
def _tmpfile(data, suffix=".json"):
    fd, p = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))
    return p


def _put_json(store, key, obj, **kw):
    p = _tmpfile(json.dumps(obj, indent=2, sort_keys=True))
    try:
        store.put(key, p, content_type="application/json", cache_control=NO_CACHE, **kw)
    finally:
        os.remove(p)


def plan(meta, promote_latest):
    steps = [f"put (create-only) {meta['key']}", f"put (create-only) {meta_key_for(meta['key'])}"]
    if promote_latest:
        steps += [f"move {LATEST_KEY} + {LATEST_META_KEY} to versionCode {meta['versionCode']} (only if above current latest)"]
    else:
        steps += ["latest pointer NOT moved (not an approved-release promotion)"]
    steps += [f"regenerate and put {INDEX_KEY}", f"invalidate {' '.join(INVALIDATE_PATHS)} and wait"]
    return steps


def publish(apk, web_manifest, *, kind, commit, run_id, promote_latest, approval_ref, store,
            render_index, app_id, signer_sha256, previous_version_code, now=None, dry_run=True, log=print):
    """Returns a report dict. Raises Fail on any refusal; never partially hides an error."""
    now = now or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if promote_latest and kind != "release":
        raise Fail("promote-latest is only allowed for kind=release; a test/rehearsal build never becomes latest")
    meta = build_meta(apk, web_manifest, kind=kind, commit=commit, run_id=run_id, now=now,
                      approval_ref=approval_ref, app_id=app_id, signer_sha256=signer_sha256)
    steps = plan(meta, promote_latest)
    report = {"key": meta["key"], "kind": kind, "sha256": meta["sha256"], "latestMoved": False,
              "apkWritten": False, "dryRun": dry_run, "plan": steps}
    if dry_run:
        for s in steps:
            log(f"[dry-run] would: {s}")
        return report

    # 1. permanent object: create-only; identical bytes = no-op, different bytes = refuse.
    mkey = meta_key_for(meta["key"])
    existing = store.head(meta["key"])
    if existing is None:
        try:
            store.put(meta["key"], apk, content_type=APK_TYPE, cache_control=IMMUTABLE,
                      sha256=meta["sha256"], if_none_match=True)
            report["apkWritten"] = True
            log(f"stored new permanent build {meta['key']}")
        except Exists:
            existing = store.head(meta["key"])
            if existing is None:
                raise Fail("conditional create refused but object not visible; refusing")
    if existing is not None:
        have = existing.get("sha256")
        if not have:
            rec = store.get(mkey)
            have = json.loads(rec)["sha256"] if rec else None
        if not have:
            raise Fail(f"{meta['key']} exists but its sha256 cannot be established; refusing to assume identical")
        if have != meta["sha256"]:
            raise Fail(f"REFUSED: {meta['key']} already exists with DIFFERENT bytes "
                       f"(stored {have[:12]}, offered {meta['sha256'][:12]}). Historical builds are never overwritten.")
        log(f"{meta['key']} already stored with identical bytes: no-op")

    # 2. metadata record: create-only; the only allowed rewrite is promoting test -> release (same bytes).
    cur = store.get(mkey)
    if cur is None:
        _put_json(store, mkey, meta, if_none_match=True)
    else:
        rec = json.loads(cur)
        if rec["sha256"] != meta["sha256"]:
            raise Fail(f"REFUSED: metadata record {mkey} describes different bytes")
        if rec["kind"] == "test" and kind == "release":
            meta["publishedAt"] = rec["publishedAt"]
            _put_json(store, mkey, meta)
            log("recorded approval: test build promoted to approved release (same bytes)")
        else:
            meta = rec
            log("metadata record already present: unchanged")

    # 3. latest pointer: approved release only, strictly rising versionCode.
    if promote_latest:
        pointer_raw = store.get(LATEST_META_KEY)
        pointer = json.loads(pointer_raw) if pointer_raw else None
        if pointer is None:
            floor, same = int(previous_version_code), False
        else:
            floor, same = int(pointer["versionCode"]), pointer.get("sha256") == meta["sha256"]
        if same:
            log("latest already points at these bytes: no-op")
        elif meta["versionCode"] > floor:
            store.put(LATEST_KEY, apk, content_type=APK_TYPE, cache_control=NO_CACHE, sha256=meta["sha256"])
            _put_json(store, LATEST_META_KEY, {
                "schema": 1, "key": meta["key"], "sha256": meta["sha256"], "versionName": meta["versionName"],
                "versionCode": meta["versionCode"], "commit": meta["commit"], "updatedAt": now})
            report["latestMoved"] = True
            log(f"latest moved to {meta['versionName']}/{meta['versionCode']}")
        else:
            raise Fail(f"REFUSED: latest must rise; offered versionCode {meta['versionCode']} <= current {floor}")

    # 4. page, then cache invalidation (fail-closed).
    d = tempfile.mkdtemp(prefix="apkcat-")
    mdir = os.path.join(d, "meta")
    os.makedirs(mdir)
    store.download_meta(mdir)
    listing = os.path.join(d, "legacy.json")
    with open(listing, "w", encoding="utf-8") as f:
        json.dump(store.list_objects(), f)
    out = os.path.join(d, "index.html")
    render_index(mdir, listing, out)
    with open(out, "rb") as f:
        html = f.read()
    if meta["key"].encode() not in html:
        raise Fail("regenerated catalog page does not list the build just published; not uploading it")
    store.put(INDEX_KEY, out, content_type="text/html; charset=utf-8", cache_control=NO_CACHE)
    try:
        report["invalidation"] = store.invalidate(INVALIDATE_PATHS)
    except Fail as e:
        raise Fail(f"UPLOADED but CloudFront invalidation did not complete ({e}); the page/latest may be stale "
                   f"for up to the cache TTL. The step is idempotent: rerun it.")
    return report


def node_render(mdir, listing, out):
    here = os.path.dirname(os.path.abspath(__file__))
    r = subprocess.run(["node", os.path.join(here, "apk_catalog.mjs"), "--meta-dir", mdir,
                        "--legacy-json", listing, "--out", out, "--git"], capture_output=True, text=True)
    if r.returncode != 0:
        raise Fail(f"catalog generator failed: {r.stderr.strip()[:300]}")


def read_env_file(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k] = v
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apk", required=True)
    ap.add_argument("--web-manifest", required=True)
    ap.add_argument("--commit", required=True)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--kind", choices=("test", "release"), required=True)
    ap.add_argument("--promote-latest", action="store_true")
    ap.add_argument("--approval-ref", default="")
    ap.add_argument("--expected-env", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "expected-release.env"))
    ap.add_argument("--report-json", help="write the publication report here (no secrets in it)")
    ap.add_argument("--execute", action="store_true", help="actually touch AWS (default: dry-run, no AWS call)")
    a = ap.parse_args(argv[1:])
    try:
        env = read_env_file(a.expected_env)
        bucket = os.environ.get("APK_BUCKET", "shramsafal-app-prod")
        dist = os.environ.get("APK_CF_DISTRIBUTION", "")
        if a.execute:
            if not re.fullmatch(r"E[A-Z0-9]{8,}", dist):
                raise Fail("APK_CF_DISTRIBUTION is unset/invalid: refusing to upload anything I cannot invalidate")
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,62}", bucket):
                raise Fail("APK_BUCKET invalid")
        rep = publish(a.apk, a.web_manifest, kind=a.kind, commit=a.commit, run_id=a.run_id,
                      promote_latest=a.promote_latest, approval_ref=a.approval_ref,
                      store=AwsStore(bucket, dist) if a.execute else None, render_index=node_render,
                      app_id=env["APP_ID"], signer_sha256=env["SIGNER_SHA256"],
                      previous_version_code=env["PREVIOUS_VERSION_CODE"], dry_run=not a.execute)
    except (Fail, rv.Fail, KeyError) as e:
        print(f"FAIL: {e}")
        return 1
    if a.report_json:
        with open(a.report_json, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2)
    print("PASS: " + json.dumps({k: v for k, v in rep.items() if k != "plan"}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
