"""Publishes the Shram Safal website to shramsafal.in (S3 shramsafal-marketing-prod behind CloudFront E2M06A2B71ZW1O).

  python deploy.py                    builds with build.py --publish, checks the build, shows what WOULD change. Touches nothing.
  python deploy.py --confirm PUBLISH  the same, then uploads, clears the CloudFront cache and waits until that is done.

Rules it keeps, whatever is in site/:
  - Nothing is ever deleted from the bucket (no --delete). A page removed from the site stays online until removed by hand,
    which is deliberately the safer failure.
  - privacy/, privacy-mr/, delete-account/ and googlef604748e4173278f.html are never uploaded: Static_V2 owns them
    (src/clients/Static_V2: npm run deploy -- --privacy-only). After publishing it checks their live copies did not change.
  - It publishes only a build it made itself a moment ago with build.py --publish: no preview ribbon or yellow notes, no
    design previews, no page left over from an earlier build.
  - It publishes only committed source, so the live site is always a commit and a rollback is "check out that commit and
    run this again".
Upload order: assets/css and assets/js, the other assets, *.txt, the other root files, and every *.html LAST, so no page goes
live before the files it uses.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "site-src"
OUT = ROOT / "site"
BUCKET = "shramsafal-marketing-prod"
DISTRIBUTION = "E2M06A2B71ZW1O"
# Owned by Static_V2 (the privacy notice the app and the Play listing link to, and the Search Console proof).
PROTECTED_DIRS = ("privacy/", "privacy-mr/", "delete-account/")
PROTECTED_FILES = ("googlef604748e4173278f.html",)
# Added last to every upload, so they win over any include before them.
PROTECTED_FILTERS = [a for d in PROTECTED_DIRS for a in ("--exclude", d + "*")] + [a for f in PROTECTED_FILES for a in ("--exclude", f)]

# (name, folder inside site/, aws s3 sync filters, Cache-Control, Content-Type or None for the CLI's guess)
STEPS = [
    ("assets/css + assets/js", "assets", ["--exclude", "*", "--include", "css/*", "--include", "js/*"],
     "public, max-age=31536000, immutable", None),
    ("other assets", "assets", ["--exclude", "css/*", "--exclude", "js/*"], "public, max-age=86400", None),
    ("*.txt", ".", ["--exclude", "*", "--include", "*.txt", "--exclude", "*/*"], "public, max-age=3600", "text/plain; charset=utf-8"),
    ("other root files", ".", ["--exclude", "*/*", "--exclude", "*.html", "--exclude", "*.txt"], "public, max-age=3600", None),
    ("*.html (last)", ".", ["--exclude", "*", "--include", "*.html", "--exclude", "assets/*"], "no-cache", "text/html; charset=utf-8"),
]
MUST_EXIST = ("index.html", "en/index.html", "robots.txt", "sitemap.xml", "llms.txt", "analytics.js",
              "assets/css/site.css", "assets/js/site.js")
AWS = shutil.which("aws")
ENV = {**os.environ, "MSYS_NO_PATHCONV": "1"}  # stops Git Bash rewriting "/*" into a Windows path


def fail(message):
    sys.exit(f"\nSTOPPED: {message}")


def step_of(rel):
    """The upload step (index into STEPS) that carries a built file, or None when no step would upload it."""
    if rel.startswith(("assets/css/", "assets/js/")):
        return 0
    if rel.startswith("assets/"):
        return 1
    if "/" not in rel and rel.endswith(".txt"):
        return 2
    if "/" not in rel and not rel.endswith(".html"):
        return 3
    if rel.endswith(".html"):
        return 4
    return None


def is_protected(key):
    return key.startswith(PROTECTED_DIRS) or key in PROTECTED_FILES


def md5(path):
    return hashlib.md5(path.read_bytes()).hexdigest()


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def aws(*args, check=True):
    p = subprocess.run([AWS, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
    if check and p.returncode != 0:
        fail(f"aws {' '.join(args[:2])} failed:\n{p.stderr.strip()}")
    return p


def live_objects():
    """Every object in the bucket: key -> (MD5 ETag, last modified). One listing call."""
    p = aws("s3api", "list-objects-v2", "--bucket", BUCKET, "--output", "json", "--query", "Contents[].[Key,ETag,LastModified]")
    return {k: (e.strip('"'), m) for k, e, m in json.loads(p.stdout or "null") or []}


def build():
    started = time.time()
    print("$ python build.py --publish")
    if subprocess.run([sys.executable, "build.py", "--publish"], cwd=SRC).returncode != 0:
        fail("build.py --publish failed; nothing was uploaded.")
    return started


def check_build(started):
    files = {p.relative_to(OUT).as_posix(): p for p in OUT.rglob("*") if p.is_file()}
    problems = []
    for rel, p in sorted(files.items()):
        if any(part.startswith("_") for part in rel.split("/")):
            problems.append(f"{rel}: a design preview or local file; those are never published")
        if is_protected(rel):
            problems.append(f"{rel}: owned by Static_V2; this script must never upload it")
        if step_of(rel) is None:
            problems.append(f"{rel}: no upload step carries this kind of file")
        if not rel.startswith("assets/") and p.suffix in (".html", ".txt", ".xml") and p.stat().st_mtime < started - 2:
            problems.append(f"{rel}: not written by this build (left over from an earlier one?)")
        if p.suffix == ".html" and re.search(r"pv-note|preview-bar", p.read_text(encoding="utf-8")):
            problems.append(f"{rel}: has preview notes (pv-note / preview-bar), so it is not a --publish build")
    problems += [f"{need}: missing" for need in MUST_EXIST if need not in files]
    if problems:
        fail("the build is not safe to publish:\n  " + "\n  ".join(problems))
    return files


def sync(i, dry, files):
    """Runs one upload step and returns the keys it uploaded (or, with dry, would upload)."""
    name, folder, filters, cache, ctype = STEPS[i]
    dest = f"s3://{BUCKET}/" + ("" if folder == "." else folder + "/")
    args = ["s3", "sync", folder, dest, *filters, *PROTECTED_FILTERS, "--cache-control", cache, "--no-progress"]
    args += ["--content-type", ctype] if ctype else []
    args += ["--dryrun"] if dry else []
    p = subprocess.run([AWS, *args], cwd=OUT, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
    where = f"step {i + 1} ({name})" + ("" if dry else "; the steps before it are live, the ones after it did not run")
    if p.returncode != 0:
        fail(f"aws s3 sync failed in {where}:\n{p.stderr.strip()}")
    keys = []
    for line in p.stdout.splitlines():
        m = re.match(rf"^(?:\(dryrun\) )?upload: .+ to s3://{BUCKET}/(\S+)$", line.strip())
        if not m:
            if line.strip():
                fail(f"unexpected aws output in {where}: {line.strip()}")
            continue
        key = m.group(1)
        if is_protected(key):
            fail(f"{where} would upload {key}, which Static_V2 owns.")
        if key not in files or step_of(key) != i:
            fail(f"{where} picked up {key}, which belongs to another step; the filters are wrong.")
        keys.append(key)
    return keys


def main():
    sys.stdout.reconfigure(line_buffering=True)  # keep this script's lines in order with build.py's and aws's
    args = sys.argv[1:]
    publish = args == ["--confirm", "PUBLISH"]
    if args and not publish:
        fail("to publish, pass exactly:  --confirm PUBLISH   (no arguments = dry run)")
    if not AWS:
        fail("the AWS CLI (aws) is not installed or not on PATH.")

    # 1. The live site must be a commit: say which one, and refuse to publish uncommitted work.
    try:
        sha, branch, dirty = git("rev-parse", "--short", "HEAD"), git("rev-parse", "--abbrev-ref", "HEAD"), git("status", "--porcelain", "--", ".")
    except (OSError, subprocess.CalledProcessError):
        fail("git is not available here; the live site has to be a commit you can roll back to.")
    print(f"Source: commit {sha} on {branch}")
    if dirty:
        message = "src/clients/Website has uncommitted changes:\n" + dirty
        if publish:
            fail(message + "\nCommit them first, so the live site is a commit you can roll back to.")
        print("WARNING: " + message + "\n(a dry run carries on; --confirm PUBLISH would stop here)")

    # 2. A fresh --publish build, checked before anything is uploaded.
    files = check_build(build())

    # 3. Who is uploading? The identity only (no secrets), so a wrong profile is obvious.
    print("\nAWS identity: " + aws("sts", "get-caller-identity", "--query", "Arn", "--output", "text").stdout.strip())

    # 4. Compare every built file with its live copy, byte for byte (the bucket's ETag is the MD5 of a single-part upload).
    live = live_objects()
    protected_before = {k: v for k, v in live.items() if is_protected(k)}
    changed = sorted(rel for rel, p in files.items() if live.get(rel, ("",))[0] != md5(p))
    # aws s3 sync decides by size and time, not content. Marking every file as new makes it send all of them (about 2 MB),
    # so no changed file can be skipped, and the dry run below proves each file goes out exactly once, with its own headers.
    for p in files.values():
        os.utime(p)

    print("\n=== PUBLISHING to shramsafal.in ===" if publish else "\n=== DRY RUN - nothing will be uploaded. Add  --confirm PUBLISH  to go live. ===")
    print("\nPlan, compared byte for byte with what is live now:")
    planned = []
    for i, (name, _, _, cache, ctype) in enumerate(STEPS):
        mine = [rel for rel in files if step_of(rel) == i]
        keys = sync(i, True, files)
        planned += keys
        print(f"  {i + 1}. {name:<24} {cache:<38} {len(keys):>3} files, {sum(r in changed for r in mine):>3} changed"
              + (f"  [{ctype}]" if ctype else ""))
    if sorted(planned) != sorted(files):
        fail("aws s3 sync would not send every built file exactly once.\n  not sent: "
             + (", ".join(sorted(set(files) - set(planned))) or "none")
             + "\n  sent twice: " + (", ".join(sorted({k for k in planned if planned.count(k) > 1})) or "none"))
    print(f"\nChanged or new on the live site: {len(changed)} of {len(files)}" + "".join(f"\n  - {rel}" for rel in changed))
    print("Deletions: 0 (this script never deletes; aws s3 sync printed no delete line)")
    print("(Unchanged files are sent again with the same bytes; only the changed ones alter what visitors see.)")
    print("\nStatic_V2 files, never sent by this script (live now):")
    for p in PROTECTED_DIRS + PROTECTED_FILES:
        hits = {k: v for k, v in protected_before.items() if k == p or k.startswith(p)}
        if not hits:
            print(f"  {p:<32} NOT on S3")
        for k, (etag, modified) in sorted(hits.items()):
            print(f"  {k:<32} {etag}  {modified}")

    if not publish:
        print("\nDry run finished. Nothing was uploaded or invalidated.")
        return

    # 5. Upload, pages last.
    sent = []
    for i in range(len(STEPS)):
        sent += sync(i, False, files)
        print(f"  step {i + 1} done ({STEPS[i][0]})")
    print(f"Uploaded {len(sent)} files.")

    # 6. Clear the CloudFront cache and wait until every edge has the new files.
    inv = aws("cloudfront", "create-invalidation", "--distribution-id", DISTRIBUTION, "--paths", "/*",
              "--query", "Invalidation.Id", "--output", "text").stdout.strip()
    print(f"\nInvalidation {inv} created; waiting for it to complete (usually a few minutes)...")
    if aws("cloudfront", "wait", "invalidation-completed", "--distribution-id", DISTRIBUTION, "--id", inv, check=False).returncode != 0:
        fail(f"the files are uploaded, but invalidation {inv} had not finished when the wait gave up. Check it with:\n"
             f"  aws cloudfront get-invalidation --distribution-id {DISTRIBUTION} --id {inv}")

    # 7. Prove it: every built file is live byte for byte, and the Static_V2 files did not move.
    after = live_objects()
    wrong = sorted(rel for rel, p in files.items() if after.get(rel, ("",))[0] != md5(p))
    moved = sorted(k for k in set(protected_before) | {k for k in after if is_protected(k)} if after.get(k) != protected_before.get(k))
    if wrong or moved:
        fail("after publishing, the bucket does not match:\n  not live as built: " + (", ".join(wrong) or "none")
             + "\n  Static_V2 files changed: " + (", ".join(moved) or "none"))
    print(f"Verified: all {len(files)} built files are live byte for byte; the Static_V2 files are unchanged.")
    print(f"\nDone. shramsafal.in now serves commit {sha}.")


if __name__ == "__main__":
    main()
