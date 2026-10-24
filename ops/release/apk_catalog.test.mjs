// Run: node --test ops/release/   (Node >= 20, no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bucketOf, clean, buildEntries, renderIndex, loadMetaDir, LATEST_KEY } from "./apk_catalog.mjs";

const sha = (c) => c.repeat(64);
const rec = (o) => ({
  schema: 1, kind: "test", package: "com.agrisync.shramsafal", sizeBytes: 20 * 1048576,
  commit: "a".repeat(40), runId: "111", ...o,
});
const NOW = "2026-10-13T00:00:00Z";

test("bucketOf keeps the old behaviour (no mislabelling)", () => {
  assert.equal(bucketOf("feat(x): add y"), "Added");
  assert.equal(bucketOf("fix: z"), "Fixed");
  assert.equal(bucketOf("revert: q"), "Removed");
  assert.equal(bucketOf("perf: q"), "Improved");
  assert.equal(bucketOf("Turn on the AI layer: contract fix, dead-weight removal"), "Changed");
  assert.equal(bucketOf("Remove old thing"), "Removed");
  assert.equal(clean("fix(site): thing (#12)"), "thing");
});

test("entries are newest first and legacy builds are kept, flagged, version unknown", () => {
  const meta = [
    rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: "2026-10-13T10:00:00Z" }),
    rec({ key: "apk/shramsafal-1.0.12-20-bbbbbbb-222222222222.apk", sha256: sha("2"), versionName: "1.0.12", versionCode: 20, publishedAt: "2026-09-01T10:00:00Z", kind: "release", approvedAt: "2026-09-01T10:00:00Z", approvalRef: "founder" }),
  ];
  const legacy = [
    { K: "apk/shramsafal-b33403a.apk", S: 1048576, M: "2026-08-01T00:00:00Z" },
    { K: LATEST_KEY, S: 1, M: "2026-09-01T00:00:00Z" },
    { K: meta[0].key, S: 1, M: "2026-10-13T10:00:00Z" },
  ];
  const e = buildEntries({ meta, legacy, latest: { key: meta[1].key } });
  assert.deepEqual(e.map((x) => x.kind), ["test", "release", "legacy"]);
  assert.equal(e.length, 3, "latest alias and already-recorded keys are not duplicated as legacy");
  assert.equal(e[1].isLatest, true);
  assert.equal(e[2].versionName, null);
  assert.equal(e[2].commit, "b33403a");
});

test("page shows version+build, date, identity, kind, and the no-verification wording", () => {
  const meta = [rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: "2026-10-13T10:00:00Z" })];
  const html = renderIndex({ entries: buildEntries({ meta }), latest: null, now: NOW });
  assert.match(html, /v1\.0\.13 <span class="bn">build 21<\/span>/);
  assert.match(html, /Test build/);
  assert.match(html, /commit <code>aaaaaaaaaaaa<\/code>/);
  assert.match(html, /run <code>111<\/code>/);
  assert.match(html, /13 Oct 2026/);
  assert.match(html, /does not mean its functionality has been\s+verified/);
  assert.match(html, /data-key="apk\/shramsafal-1\.0\.13-21-aaaaaaa-111111111111\.apk"/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /Download latest approved release/, "a test build alone must never produce a latest button");
});

test("latest button appears only for the approved release the pointer names", () => {
  const rel = rec({ key: "apk/shramsafal-1.0.12-20-bbbbbbb-222222222222.apk", sha256: sha("2"), versionName: "1.0.12", versionCode: 20, publishedAt: "2026-09-01T10:00:00Z", kind: "release", approvedAt: "2026-09-01T10:00:00Z", approvalRef: "F-1" });
  const tst = rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: "2026-10-13T10:00:00Z" });
  const latest = { key: rel.key };
  const html = renderIndex({ entries: buildEntries({ meta: [tst, rel], latest }), latest, now: NOW });
  assert.match(html, /Download latest approved release[\s\S]*v1\.0\.12 build 20/);
  assert.match(html, /Approved release/);
  assert.match(html, /ref F-1/);
  assert.ok(html.indexOf("1.0.13-21") < html.indexOf("1.0.12-20"), "newest first");
});

test("html in record fields is escaped", () => {
  const meta = [rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: NOW, runId: "<script>alert(1)</script>" })];
  const html = renderIndex({ entries: buildEntries({ meta }), now: NOW });
  assert.doesNotMatch(html, /<script>alert/);
});

test("change notes come from the injected git range and unknown commits say so", () => {
  const meta = [
    rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: "2026-10-13T10:00:00Z", commit: "c".repeat(40) }),
    rec({ key: "apk/shramsafal-1.0.12-20-bbbbbbb-222222222222.apk", sha256: sha("2"), versionName: "1.0.12", versionCode: 20, publishedAt: "2026-09-01T10:00:00Z", commit: "d".repeat(40) }),
  ];
  const git = {
    known: (s) => s.startsWith("c") || s.startsWith("d"),
    subject: () => "release 1.0.13",
    range: (from, to) => (from.startsWith("d") && to.startsWith("c") ? ["feat(x): add voice undo (#9)", "fix: crash"] : null),
  };
  const html = renderIndex({ entries: buildEntries({ meta }), now: NOW, git });
  assert.match(html, /t-added">Added[\s\S]*add voice undo/);
  assert.match(html, /t-fixed">Fixed[\s\S]*crash/);
  assert.match(html, /No separate commits between this build/); // oldest has no predecessor
  const none = renderIndex({ entries: buildEntries({ meta }), now: NOW, git: { known: () => false, subject: () => null, range: () => null } });
  assert.match(none, /not in the checkout/);
});

test("CLI end to end: meta dir + legacy listing -> index.html; malformed record is rejected", () => {
  const d = mkdtempSync(join(tmpdir(), "apkcat-"));
  const m = rec({ key: "apk/shramsafal-1.0.13-21-aaaaaaa-111111111111.apk", sha256: sha("1"), versionName: "1.0.13", versionCode: 21, publishedAt: "2026-10-13T10:00:00Z" });
  writeFileSync(join(d, "x.json"), JSON.stringify(m));
  writeFileSync(join(d, "legacy.json"), JSON.stringify([{ K: "apk/shramsafal-b33403a.apk", S: 5, M: "2026-08-01T00:00:00Z" }]));
  const cli = join(dirname(fileURLToPath(import.meta.url)), "apk_catalog.mjs");
  const mdir = join(d, "meta"); execFileSync("node", ["-e", `require('fs').mkdirSync(${JSON.stringify(mdir)})`]);
  writeFileSync(join(mdir, "x.json"), JSON.stringify(m));
  const out = join(d, "index.html");
  execFileSync("node", [cli, "--meta-dir", mdir, "--legacy-json", join(d, "legacy.json"), "--out", out, "--now", NOW]);
  const html = readFileSync(out, "utf8");
  assert.match(html, /2 builds/);
  assert.match(html, /Legacy build/);
  writeFileSync(join(mdir, "bad.json"), JSON.stringify({ key: "k" }));
  assert.throws(() => loadMetaDir(mdir), /missing/);
});
