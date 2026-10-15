#!/usr/bin/env python3
"""Release artifact verifiers. Standard library only; no Android SDK needed.

Subcommands (each exits 0 on PASS, 1 on any failure, 2 on usage error):

  run     <run.json> <workflow-name> <expected-sha>
            The build run being promoted must be that workflow, concluded
            "success", and have built exactly <expected-sha>.
  bundle  <dist-dir> <manifest>
            Every file in the manifest exists with the recorded sha256, and the
            directory holds no file the manifest does not list.
  release-manifest <release-manifest.json> <apk> <web-manifest> <expected-sha>
            The json written by release-build describes exactly these two files
            and this commit.
  apk     <apk> <manifest> --app-id ID --version-name V --version-code N
          --signer-sha256 HEX
            The FINISHED apk (not the Gradle input): zip intact; every manifest
            file is present in assets/public/ byte-for-byte; no unexpected extra
            file in assets/public/; package id, versionName and versionCode read
            from the compiled AndroidManifest match; the v2/v3 signing block is
            present and its signer certificate sha256 is exactly the expected
            one (signer continuity with the previously published APK).

Manifest format: `sha256sum` output of every file under dist/, paths as ./rel.
"""
import hashlib
import json
import struct
import sys
import zipfile

# Files `cap sync` adds next to the web bundle inside assets/public/.
ALLOWED_EXTRA_PUBLIC = {"cordova.js", "cordova_plugins.js"}


class Fail(Exception):
    pass


# ---------------------------------------------------------------- manifest
def read_manifest(path):
    entries = {}
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\r\n")
            if not line:
                continue
            # GNU sha256sum writes "hash  path" (text) or "hash *path" (binary mode,
            # the default on Windows); accept both.
            h, p = line[:64], line[66:]
            if len(line) < 68 or line[64] != " " or line[65] not in (" ", "*") or not p.startswith("./")                     or any(c not in "0123456789abcdef" for c in h):
                raise Fail(f"manifest line {n} malformed")
            entries[p[2:]] = h
    if not entries:
        raise Fail("manifest is empty")
    return entries


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


# --------------------------------------------------------------------- run
def verify_run(run_json, workflow, expected_sha):
    with open(run_json, encoding="utf-8") as f:
        r = json.load(f)
    if r.get("workflowName") != workflow:
        raise Fail(f"run is workflow {r.get('workflowName')!r}, expected {workflow!r}")
    if r.get("conclusion") != "success":
        raise Fail(f"run did not succeed (conclusion={r.get('conclusion')!r})")
    if r.get("headSha") != expected_sha:
        raise Fail(f"run built {r.get('headSha')!r}, expected {expected_sha!r}")
    return "run ok"


# ------------------------------------------------------------------ bundle
def verify_bundle(dist, manifest):
    import os
    entries = read_manifest(manifest)
    on_disk = set()
    for root, _dirs, files in os.walk(dist):
        for name in files:
            on_disk.add(os.path.relpath(os.path.join(root, name), dist).replace(os.sep, "/"))
    missing = sorted(set(entries) - on_disk)
    extra = sorted(on_disk - set(entries))
    if missing:
        raise Fail(f"{len(missing)} manifest file(s) missing, first: {missing[0]}")
    if extra:
        raise Fail(f"{len(extra)} file(s) not in manifest, first: {extra[0]}")
    for rel, want in entries.items():
        with open(os.path.join(dist, rel), "rb") as f:
            got = sha256_bytes(f.read())
        if got != want:
            raise Fail(f"hash mismatch: {rel}")
    return f"bundle ok ({len(entries)} files)"


# --------------------------------------------------------- compiled manifest
def _u16(b, o): return struct.unpack_from("<H", b, o)[0]
def _u32(b, o): return struct.unpack_from("<I", b, o)[0]


def _string_pool(b, off):
    size = _u32(b, off + 4)
    count = _u32(b, off + 8)
    flags = _u32(b, off + 16)
    strings_start = _u32(b, off + 20)
    utf8 = bool(flags & 0x100)
    hdr = _u16(b, off + 2)
    offs = [_u32(b, off + hdr + 4 * i) for i in range(count)]
    base = off + strings_start
    out = []
    for o in offs:
        p = base + o
        if utf8:
            n = b[p]; p += 1 if not (n & 0x80) else 2
            n2 = b[p]; p += 1
            if n2 & 0x80:
                n2 = ((n2 & 0x7F) << 8) | b[p]; p += 1
            out.append(b[p:p + n2].decode("utf-8", "replace"))
        else:
            n = _u16(b, p); p += 2
            if n & 0x8000:
                n = ((n & 0x7FFF) << 16) | _u16(b, p); p += 2
            out.append(b[p:p + 2 * n].decode("utf-16-le", "replace"))
    return out, size


def read_compiled_manifest(data):
    """Return {package, versionName, versionCode} from a binary AndroidManifest.xml."""
    if _u16(data, 0) != 0x0003:
        raise Fail("AndroidManifest.xml is not binary XML")
    off = _u16(data, 2)
    strings = []
    while off < len(data):
        ctype, _hdr, csize = _u16(data, off), _u16(data, off + 2), _u32(data, off + 4)
        if ctype == 0x0001:
            strings, _ = _string_pool(data, off)
        elif ctype == 0x0102:  # start element
            name = strings[_u32(data, off + 20)]
            if name == "manifest":
                attr_start = _u16(data, off + 24)
                attr_size = _u16(data, off + 26)
                attr_count = _u16(data, off + 28)
                a0 = off + 16 + attr_start
                res = {}
                for i in range(attr_count):
                    a = a0 + i * attr_size
                    aname = strings[_u32(data, a + 4)]
                    raw = _u32(data, a + 8)
                    dtype = data[a + 15]
                    val = _u32(data, a + 16)
                    if dtype == 0x03 and raw != 0xFFFFFFFF:
                        res[aname] = strings[raw]
                    else:
                        res[aname] = val
                return {"package": res.get("package"),
                        "versionName": res.get("versionName"),
                        "versionCode": res.get("versionCode")}
        off += csize
    raise Fail("no <manifest> element found")


# ----------------------------------------------------------- signing block
def signer_cert_sha256s(path):
    with open(path, "rb") as fh:
        d = fh.read()
    eocd = d.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise Fail("not a zip (no end-of-central-directory)")
    cd_off = _u32(d, eocd + 16)
    if d[cd_off - 16:cd_off] != b"APK Sig Block 42":
        raise Fail("no APK signing block (unsigned or v1-only)")
    size = struct.unpack_from("<Q", d, cd_off - 24)[0]
    pos, end = cd_off - size - 8 + 8, cd_off - 24
    found = {}
    while pos < end:
        plen = struct.unpack_from("<Q", d, pos)[0]
        pid = _u32(d, pos + 8)
        val = d[pos + 12:pos + 8 + plen]
        pos += 8 + plen
        if pid in (0x7109871A, 0xF05368C0):
            scheme = "v2" if pid == 0x7109871A else "v3"
            total = _u32(val, 0); so = 4; certs = []
            while so < 4 + total:
                slen = _u32(val, so); signer = val[so + 4:so + 4 + slen]; so += 4 + slen
                sd = signer[4:4 + _u32(signer, 0)]
                o = 4 + _u32(sd, 0)
                if scheme == "v3":
                    o += 8
                ce = o + 4 + _u32(sd, o); o += 4
                while o < ce:
                    cl = _u32(sd, o); certs.append(sha256_bytes(sd[o + 4:o + 4 + cl])); o += 4 + cl
            found[scheme] = certs
    if not found:
        raise Fail("signing block holds no v2/v3 signer")
    return found


# ---------------------------------------------------------- release manifest
def verify_release_manifest(manifest_json, apk, web_manifest, expected_sha):
    """release-manifest.json (written by release-build) must describe THESE files."""
    with open(manifest_json, encoding="utf-8") as f:
        m = json.load(f)
    if m.get("git_sha") != expected_sha:
        raise Fail(f"release manifest is for {m.get('git_sha')!r}, expected {expected_sha!r}")
    with open(apk, "rb") as f:
        if sha256_bytes(f.read()) != m.get("apk_sha256"):
            raise Fail("APK sha256 differs from the release manifest (not the artifact that was verified)")
    with open(web_manifest, "rb") as f:
        if sha256_bytes(f.read()) != m.get("web_manifest_sha256"):
            raise Fail("web manifest sha256 differs from the release manifest")
    return f"release manifest ok (apk {m['apk_sha256'][:12]}, web {m['web_manifest_sha256'][:12]})"


# --------------------------------------------------------------------- apk
def verify_apk(apk, manifest, app_id, version_name, version_code, signer_sha256):
    entries = read_manifest(manifest)
    try:
        z = zipfile.ZipFile(apk)
    except zipfile.BadZipFile as e:
        raise Fail(f"apk is not a valid zip: {e}")
    bad = z.testzip()
    if bad:
        raise Fail(f"apk entry corrupted: {bad}")
    pub = {n[len("assets/public/"):]: n for n in z.namelist()
           if n.startswith("assets/public/") and not n.endswith("/")}
    missing = sorted(set(entries) - set(pub))
    if missing:
        raise Fail(f"{len(missing)} bundle file(s) absent from the APK, first: {missing[0]}")
    for rel, want in entries.items():
        if sha256_bytes(z.read(pub[rel])) != want:
            raise Fail(f"APK asset differs from the bundle manifest: {rel}")
    extra = sorted(set(pub) - set(entries) - ALLOWED_EXTRA_PUBLIC)
    if extra:
        raise Fail(f"{len(extra)} unexpected file(s) in APK assets/public, first: {extra[0]}")
    m = read_compiled_manifest(z.read("AndroidManifest.xml"))
    if m["package"] != app_id:
        raise Fail(f"application id {m['package']!r} != {app_id!r}")
    if m["versionName"] != version_name:
        raise Fail(f"versionName {m['versionName']!r} != {version_name!r}")
    if m["versionCode"] != int(version_code):
        raise Fail(f"versionCode {m['versionCode']!r} != {int(version_code)}")
    signers = signer_cert_sha256s(apk)
    for scheme, certs in signers.items():
        if certs != [signer_sha256.lower()]:
            raise Fail(f"{scheme} signer certificate does not match the expected signer (continuity broken)")
    return f"apk ok (package {m['package']}, {m['versionName']}/{m['versionCode']}, signer continuity ok, {len(entries)} bundle files)"


def main(argv):
    try:
        if len(argv) >= 5 and argv[1] == "run":
            msg = verify_run(argv[2], argv[3], argv[4])
        elif len(argv) >= 4 and argv[1] == "bundle":
            msg = verify_bundle(argv[2], argv[3])
        elif len(argv) >= 6 and argv[1] == "release-manifest":
            msg = verify_release_manifest(argv[2], argv[3], argv[4], argv[5])
        elif len(argv) >= 4 and argv[1] == "apk":
            opts = dict(zip(argv[4::2], argv[5::2]))
            msg = verify_apk(argv[2], argv[3], opts["--app-id"], opts["--version-name"],
                             opts["--version-code"], opts["--signer-sha256"])
        else:
            print(__doc__); return 2
    except Fail as e:
        print(f"FAIL: {e}"); return 1
    except KeyError as e:
        print(f"usage: missing {e}"); return 2
    print(f"PASS: {msg}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
