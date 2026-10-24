// Load check: serves dist/ exactly like CloudFront (shramsafal-index-rewrite),
// opens every route on a throttled phone and reports LCP, CLS, whether the
// Marathi prompt shows, and any hydration warning. Any [hydrate] WARN means the
// prerendered HTML is being thrown away and repainted. Run: npm run perf:load
// Timings on a busy dev machine swing 2-3x; trust the WARN count and CLS.
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const DIST = join(process.cwd(), "dist");
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".webp":"image/webp", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".txt":"text/plain", ".xml":"application/xml", ".webmanifest":"application/manifest+json" };
// mirrors CloudFront fn shramsafal-index-rewrite
const srv = createServer(async (req, res) => {
  let uri = new URL(req.url, "http://x").pathname;
  if (uri.endsWith("/")) uri += "index.html"; else if (!uri.includes(".")) uri += "/index.html";
  try { const b = await readFile(join(DIST, uri)); res.writeHead(200, { "Content-Type": MIME[extname(uri)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(403).end("AccessDenied"); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + srv.address().port;
const b = await puppeteer.launch({ headless: "new" });
for (const route of ["/", "/vision", "/farmers", "/join", "/privacy-trust"]) for (const js of [false, true]) {
  const p = await b.newPage();
  const warns = []; p.on("console", m => { if (/hydrat|Minified React error|\[hydrate\]/i.test(m.text())) warns.push(m.text().slice(0, 160)); });
  p.on("pageerror", e => warns.push("pageerror " + e.message.slice(0, 160)));
  await p.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true });
  await p.setJavaScriptEnabled(js);
  const c = await p.createCDPSession();
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await c.send("Network.enable");
  await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6e6/8, uploadThroughput: 750e3/8 });
  await p.setRequestInterception(true);
  p.on("request", r => /googletagmanager|google-analytics/.test(r.url()) ? r.abort() : r.continue());
  await p.evaluateOnNewDocument(() => {
    window.__lcp = []; window.__cls = 0;
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__lcp.push(Math.round(e.startTime)))).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true });
  });
  await p.goto(origin + route, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise(r => setTimeout(r, 2500));
  const r = await p.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, prompt: !!document.querySelector(".language-prompt"), lang: document.documentElement.lang, h1: document.querySelector("h1")?.textContent.slice(0, 50) }));
  console.log(route.padEnd(15), js ? "JS on " : "JS off", "LCP", String(r.lcp.at(-1)).padStart(5), "ms  CLS", r.cls.toFixed(3), " prompt", r.prompt, r.lang, "|", r.h1, warns.length ? "\n   WARN " + warns.join("\n   WARN ") : "");
  await p.close();
}
await b.close(); srv.close();
