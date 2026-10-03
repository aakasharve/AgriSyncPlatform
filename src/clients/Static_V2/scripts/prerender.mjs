#!/usr/bin/env node
/**
 * Prerender the built site to static HTML, one file per route.
 *
 * Why this exists: the site is a client-rendered SPA, so the HTML a crawler
 * receives is `<div id="root"></div>` and nothing else. Google can sometimes
 * run the JavaScript and recover; AI answer engines (ChatGPT, Perplexity,
 * Google's AI Overviews) mostly do not. For AEO — being quotable by an
 * assistant — the words have to be in the HTML itself.
 *
 * This serves `dist/`, loads each route in headless Chrome, waits for React
 * to finish, and writes the resulting DOM back over that route's index.html.
 * The scripts stay in the page, so React still hydrates and the site behaves
 * exactly as before for a human — but a machine that never runs JavaScript
 * now reads the whole argument.
 *
 * Run: node scripts/prerender.mjs     (after `npm run build`)
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

// Every route the router can serve. Keep in step with `pages` in App.tsx.
const ROUTES = ["/", "/vision", "/farmers", "/join", "/privacy-trust"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webp": "image/webp",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

// The empty Vite shell, captured once. Every route must start from it: once
// "/" is written, dist/index.html holds the homepage's DOM, and React would
// try to hydrate that markup on /vision.
const TEMPLATE = await readFile(join(DIST, "index.html"));

// a static server over dist/, with SPA fallback so /vision resolves
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let file = join(DIST, decodeURIComponent(url.pathname));
    const isPage = !extname(file) || !existsSync(file) || extname(file) === ".html";
    if (isPage) file = join(DIST, "index.html");
    const body = isPage ? TEMPLATE : await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const port = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const origin = `http://127.0.0.1:${port}`;
console.log(`serving dist/ on ${origin}`);

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
let failed = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1800 });
  // Keep analytics out of the build: otherwise every `npm run build` sends
  // five headless page_views to the live GA property and pollutes the data.
  // The gtag <script> tags are static in index.html, so they still ship.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/googletagmanager\.com|google-analytics\.com/.test(req.url())) req.abort();
    else req.continue();
  });
  // English is the default (search engines index this copy). Set it before any
  // script runs so the output never depends on what a previous run stored —
  // and so the first-visit language prompt is not frozen into the HTML.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("shramsafal.language", "en"); } catch {}
  });

  try {
    await page.goto(origin + route, { waitUntil: "networkidle0", timeout: 60000 });
    // React paints in a frame; give the i18n DOM walker a beat to finish too
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 450))));

    const textLength = await page.evaluate(() => (document.querySelector("main")?.textContent || "").trim().length);
    if (textLength < 400) throw new Error(`rendered only ${textLength} chars of text`);

    // Any Devanagari left in <main> is a string the English dictionary missed.
    // Report it so the indexed copy is not a silent English/Marathi mix.
    const leftover = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        if (n.parentElement?.closest("[data-i18n-static='true'], script, style")) continue;
        const t = n.textContent.trim();
        if (/[\u0900-\u097F]/.test(t)) out.push(t.slice(0, 80));
      }
      return out;
    });
    if (leftover.length) {
      console.warn(`  ${route.padEnd(16)} ${leftover.length} untranslated string(s):`);
      for (const t of leftover) console.warn(`      · ${t}`);
    }

    // Adjacent text nodes ("a ", {x}, " b") are separate in the live DOM but
    // merge into one when serialized and re-parsed, which breaks hydration
    // (React #418) and forces a full repaint. React's own server renderer
    // separates them with <!-- -->, which hydration skips; do the same.
    await page.evaluate(() => {
      const root = document.getElementById("root");
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const joins = [];
      while (w.nextNode()) {
        const n = w.currentNode;
        if (n.previousSibling?.nodeType === Node.TEXT_NODE) joins.push(n);
      }
      for (const n of joins) n.parentNode.insertBefore(document.createComment(" "), n);
    });

    const html = await page.content();
    const outDir = route === "/" ? DIST : join(DIST, route.replace(/^\//, ""));
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "index.html"), html, "utf8");
    console.log(`  ${route.padEnd(16)} ${textLength.toLocaleString()} chars of text written`);
  } catch (err) {
    failed++;
    console.error(`  ${route.padEnd(16)} FAILED: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
server.close();

if (failed) {
  console.error(`\n${failed} route(s) failed to prerender — not shipping a half-rendered site.`);
  process.exit(1);
}
console.log(`\nprerendered ${ROUTES.length} routes`);
