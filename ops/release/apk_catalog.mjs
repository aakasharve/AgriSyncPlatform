#!/usr/bin/env node
/**
 * Renders the private build catalog served at https://app.shramsafal.in/apk/
 * (behind the CloudFront basic-auth function; never the public marketing site).
 *
 * Successor of the locally-ignored scripts/build-apk-index.mjs. What is kept:
 * newest-first list, change notes taken from the REAL commit range between two
 * consecutive builds (nothing invented; a commit that is not in the checkout is
 * said to be unknown), the same bucketing of subjects into Added/Fixed/... .
 *
 * What changed: the page no longer guesses a version from a commit message or
 * lists "whatever is in the bucket". Every entry comes from a metadata record
 * written at publication time from the VERIFIED APK (compiled AndroidManifest:
 * versionName, versionCode, package, signer) plus the build identity (commit,
 * run id). Builds published before the catalog existed (keys
 * `shramsafal-<commit>.apk` with no record) are still listed, marked legacy.
 *
 * Usage:
 *   node ops/release/apk_catalog.mjs --meta-dir DIR --out FILE
 *        [--legacy-json FILE] [--git] [--now ISO]
 *
 *   DIR holds one `<stem>.json` per build plus optionally `latest.json`.
 *   --legacy-json is `aws s3api list-objects-v2 ... Contents[].{K,S,M}` output.
 *   --git adds change notes (needs a deep checkout: fetch-depth: 0).
 * No network and no AWS access here: pure function of its inputs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_NOTES = 40;
export const PREFIX = "apk/";
export const LATEST_KEY = "apk/shramsafal-latest.apk";
const KIND_LABEL = { release: "Approved release", test: "Test build", legacy: "Legacy build" };

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
const ist = (iso) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });

/** Strip `type(scope): ` and a trailing `(#123)` so the sentence reads plainly. */
export const clean = (s) =>
  s.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").replace(/\s*\(#\d+\)\s*$/, "").trim();

/** Sort one commit subject into a human bucket. A wrong label is worse than none. */
export function bucketOf(s) {
  const t = (/^([a-z]+)(\([^)]*\))?!?:/i.exec(s) || [, ""])[1].toLowerCase();
  if (t === "feat") return "Added";
  if (t === "fix") return "Fixed";
  if (t === "revert") return "Removed";
  // Keyword fallback only for untyped subjects that OPEN with a removal verb.
  if (!t && /^(remove|removing|delete|deleting|drop|dropping|strip|stripping|retire|retiring)\b/i.test(s))
    return "Removed";
  if (t === "perf") return "Improved";
  return "Changed";
}
const ORDER = ["Added", "Fixed", "Improved", "Changed", "Removed"];

// -------------------------------------------------------------- git (injectable)
const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

export const realGit = {
  known: (sha) => { try { sh("git", ["cat-file", "-e", sha + "^{commit}"]); return true; } catch { return false; } },
  subject: (sha) => { try { return sh("git", ["log", "-1", "--format=%s", sha]).trim(); } catch { return null; } },
  range: (from, to) => {
    try { return sh("git", ["log", "--format=%s", `${from}..${to}`]).split("\n").map((s) => s.trim()).filter(Boolean); }
    catch { return null; }
  },
};

// -------------------------------------------------------------------- entries
/**
 * meta: array of verified-publication records; legacy: [{K,S,M}] bucket listing;
 * latest: parsed latest.json or null. Returns entries newest first.
 */
export function buildEntries({ meta, legacy = [], latest = null }) {
  const haveKeys = new Set(meta.map((m) => m.key));
  const out = meta.map((m) => ({
    kind: m.kind === "release" ? "release" : "test",
    key: m.key,
    sha256: m.sha256,
    size: m.sizeBytes,
    versionName: m.versionName,
    versionCode: m.versionCode,
    packageId: m.package,
    commit: m.commit || null,
    runId: m.runId || null,
    publishedAt: m.publishedAt,
    approvalRef: m.approvalRef || null,
    approvedAt: m.approvedAt || null,
    isLatest: !!latest && latest.key === m.key,
  }));
  for (const o of legacy) {
    if (o.K === LATEST_KEY || !o.K.endsWith(".apk") || haveKeys.has(o.K)) continue;
    const stem = o.K.slice(PREFIX.length).replace(/^shramsafal-/, "").replace(/\.apk$/, "");
    out.push({
      kind: "legacy", key: o.K, sha256: null, size: o.S, versionName: null, versionCode: null,
      packageId: null, commit: /^[0-9a-f]{7,40}$/.test(stem) ? stem : null, runId: null,
      publishedAt: o.M, approvalRef: null, approvedAt: null, isLatest: false,
    });
  }
  return out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) ||
    (b.versionCode || 0) - (a.versionCode || 0));
}

function notesFor(e, prev, git) {
  if (!git) return { html: `<p class="none">Change notes were not generated for this page.</p>`, subj: null, known: false };
  const have = e.commit && git.known(e.commit);
  const subj = have ? git.subject(e.commit) : null;
  let groups = null, extra = 0;
  if (have && prev && prev.commit && git.known(prev.commit)) {
    const subs = git.range(prev.commit, e.commit);
    if (subs && subs.length) {
      const capped = subs.slice(0, MAX_NOTES);
      extra = subs.length - capped.length;
      groups = {};
      for (const s of capped) (groups[bucketOf(s)] ||= []).push(clean(s) || s);
    }
  }
  const html = !have
    ? `<p class="none">This build's commit is not in the checkout, so its changes cannot be listed.</p>`
    : !groups
      ? `<p class="none">No separate commits between this build and the one before it.</p>`
      : ORDER.filter((k) => groups[k]?.length)
          .map((k) => `<div class="grp"><span class="tag t-${k.toLowerCase()}">${k}</span><ul>` +
            groups[k].map((x) => `<li>${esc(x)}</li>`).join("") + `</ul></div>`).join("") +
        (extra ? `<p class="none">+ ${extra} more commits not shown.</p>` : "");
  return { html, subj, known: !!have };
}

function entryHtml(e, prev, git) {
  const n = notesFor(e, prev, git);
  const ver = e.versionName != null
    ? `v${esc(e.versionName)} <span class="bn">build ${esc(e.versionCode)}</span>`
    : `<span class="bn">version not recorded</span>`;
  const id = [
    e.commit ? `commit <code>${esc(e.commit.slice(0, 12))}</code>` : null,
    e.runId ? `run <code>${esc(e.runId)}</code>` : null,
    e.sha256 ? `sha256 <code>${esc(e.sha256.slice(0, 16))}…</code>` : null,
  ].filter(Boolean).join(" &middot; ") || "identity not recorded (built before the catalog)";
  const approved = e.kind === "release" && e.approvedAt
    ? `<p class="subj">Approved ${esc(ist(e.approvedAt))} IST${e.approvalRef ? ` &middot; ref ${esc(e.approvalRef)}` : ""}.</p>` : "";
  return `<article class="build k-${e.kind}" data-key="${esc(e.key)}" data-kind="${e.kind}"` +
    ` data-version-name="${esc(e.versionName ?? "")}" data-version-code="${esc(e.versionCode ?? "")}"` +
    ` data-sha256="${esc(e.sha256 ?? "")}" data-commit="${esc(e.commit ?? "")}" data-run-id="${esc(e.runId ?? "")}">
  <header>
    <div class="idl"><span class="ver">${ver}</span>
      <span class="badge b-${e.kind}">${KIND_LABEL[e.kind]}</span>${e.isLatest ? ` <span class="badge b-latest">Current latest</span>` : ""}</div>
    <div class="meta">Published ${esc(ist(e.publishedAt))} IST &middot; ${mb(e.size)}</div>
    <a class="dl" href="/${esc(e.key)}" download>Download</a>
  </header>
  <p class="ident">${id}</p>
  ${approved}${n.subj ? `<p class="subj">${esc(n.subj)}</p>` : ""}
  <details><summary>What changed in this build</summary><div class="notes">${n.html}</div></details>
</article>`;
}

const CSS = `
 :root{--ink:#1c1c16;--muted:#5c685f;--green:#145225;--surface:#fdf9f0;--line:#e2e6dd;--card:#fff}
 *{box-sizing:border-box}
 body{margin:0;padding:24px 16px 64px;background:var(--surface);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
 .wrap{max-width:860px;margin:0 auto}
 h1{font-size:1.4rem;margin:0 0 4px}
 .sub{color:var(--muted);margin:0 0 20px;font-size:.88rem}
 .warn{border:1px solid #e4c66a;background:#fdf6e0;border-radius:10px;padding:12px 14px;margin:0 0 22px;font-size:.87rem}
 .latest{display:block;background:var(--green);color:#fff;text-decoration:none;border-radius:12px;padding:16px 18px;margin:0 0 26px}
 .latest b{display:block;font-size:1.05rem;margin-bottom:2px}
 .latest span{opacity:.85;font-size:.85rem}
 .nolatest{border:1px dashed var(--line);border-radius:12px;padding:14px 18px;margin:0 0 26px;color:var(--muted);font-size:.88rem}
 .build{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 12px}
 .build.k-release{border-left:5px solid var(--green)}
 .build.k-test{border-left:5px solid #c9a227}
 .build header{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline}
 .idl{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;min-width:0}
 .ver{font-weight:700} .bn{font-weight:400;color:var(--muted);font-size:.85rem}
 .badge{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px}
 .b-release{background:#e3f3e5;color:#1b5e2a} .b-test{background:#fdf1cf;color:#6b5200}
 .b-legacy{background:#eceae3;color:#4a4a42} .b-latest{background:#145225;color:#fff}
 code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
 .meta{color:var(--muted);font-size:.82rem;flex:1 1 auto}
 .ident{margin:6px 0 0;font-size:.82rem;color:var(--muted)}
 .dl{color:var(--green);font-weight:600;text-decoration:none;white-space:nowrap}
 .dl:hover{text-decoration:underline}
 .subj{margin:8px 0 0;font-size:.9rem}
 details{margin-top:8px} summary{cursor:pointer;color:var(--muted);font-size:.84rem}
 .notes{padding-top:10px}
 .grp{display:flex;gap:10px;align-items:flex-start;margin:0 0 8px}
 .tag{flex:0 0 auto;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:999px;margin-top:3px}
 .t-added{background:#e3f3e5;color:#1b5e2a}.t-fixed{background:#fdeede;color:#8a4b12}
 .t-improved{background:#e4eefb;color:#1b4a7a}.t-changed{background:#eceae3;color:#4a4a42}.t-removed{background:#fae3e3;color:#7a1f1f}
 ul{margin:0;padding-left:18px} li{font-size:.88rem;margin:2px 0}
 .none{color:var(--muted);font-size:.85rem;font-style:italic;margin:4px 0}
 footer{color:var(--muted);font-size:.8rem;margin-top:24px}`;

export function renderIndex({ entries, latest = null, now = new Date().toISOString(), git = null, legacyLatest = false }) {
  const latestEntry = latest ? entries.find((e) => e.key === latest.key) : null;
  const rows = entries.map((e, i) => entryHtml(e, entries[i + 1], git)).join("\n");
  const latestBox = latestEntry
    ? `<a class="latest" href="/${esc(LATEST_KEY)}" download>
  <b>Download latest approved release &rarr;</b>
  <span>v${esc(latestEntry.versionName)} build ${esc(latestEntry.versionCode)} &middot; ${mb(latestEntry.size)} &middot; published ${esc(ist(latestEntry.publishedAt))} IST</span></a>`
    : `<div class="nolatest">No approved release has been marked as latest through the catalog yet. Test builds are never promoted to &ldquo;latest&rdquo;.${legacyLatest
        ? ` The existing latest link still serves the build published before the catalog existed; its version was never recorded.` : ""}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ShramSafal — internal builds</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
 <h1>ShramSafal — internal builds</h1>
 <p class="sub">${entries.length} builds, newest first. Generated ${esc(ist(now))} IST.</p>

 <div class="warn"><strong>Internal only.</strong> Password protected and hidden from search engines. Not for farmers
 and not for public distribution. <strong>A build being listed or downloadable does not mean its functionality has been
 verified.</strong> Only an entry marked <em>Approved release</em> has been signed off by the founder; a <em>Test build</em>
 was delivered for trial and may be unstable. Older builds are kept permanently and are never replaced.</div>

 ${latestBox}

${rows}

 <footer>Version and build number are read from the finished APK itself when it is published, not from commit messages.
 Change lists are the real commits between one build and the build before it. Legacy builds pre-date the catalog, so
 their version and identity were never recorded.</footer>
</div>
</body>
</html>
`;
}

// ------------------------------------------------------------------------ CLI
export function loadMetaDir(dir) {
  const meta = []; let latest = null;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (f === "latest.json") { latest = j; continue; }
    for (const k of ["key", "sha256", "versionName", "versionCode", "publishedAt", "sizeBytes"])
      if (j[k] == null) throw new Error(`${f}: missing ${k}`);
    meta.push(j);
  }
  return { meta, latest };
}

function main(argv) {
  const opt = {}; const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--git") flags.add("git");
    else if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
  }
  if (!opt["meta-dir"] || !opt.out) { console.error("usage: apk_catalog.mjs --meta-dir DIR --out FILE [--legacy-json F] [--git]"); return 2; }
  const { meta, latest } = loadMetaDir(opt["meta-dir"]);
  const legacy = opt["legacy-json"] ? (JSON.parse(readFileSync(opt["legacy-json"], "utf8")) || []) : [];
  const entries = buildEntries({ meta, legacy, latest });
  const html = renderIndex({ entries, latest, now: opt.now || new Date().toISOString(), git: flags.has("git") ? realGit : null,
    legacyLatest: legacy.some((o) => o.K === LATEST_KEY) });
  writeFileSync(opt.out, html, "utf8");
  console.log(`wrote ${opt.out}: ${entries.length} builds (${meta.length} recorded, ${entries.length - meta.length} legacy)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
