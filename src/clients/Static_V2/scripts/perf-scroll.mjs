// Scroll check: wheel-scrolls a route on a 4x-throttled CPU and reports frame
// times plus main-thread style/layout/script cost, once per CSS variant that
// switches off one suspect effect. Compare the main-thread numbers, not fps —
// fps is too noisy on a dev machine. Run: npm run perf:scroll [variant] [route]
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const DIST = join(process.cwd(), "dist");
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".webp":"image/webp", ".png":"image/png", ".jpg":"image/jpeg", ".woff2":"font/woff2" };
const srv = createServer(async (req, res) => {
  let uri = new URL(req.url, "http://x").pathname;
  if (uri.endsWith("/")) uri += "index.html"; else if (!uri.includes(".")) uri += "/index.html";
  try { const b = await readFile(join(DIST, uri)); res.writeHead(200, { "Content-Type": MIME[extname(uri)] || "application/octet-stream" }); res.end(b); } catch { res.writeHead(404).end(); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + srv.address().port;
const variants = {
  baseline: "",
  "no glow+grain": ".global-glow,.fine-grain{display:none!important}",
  "no backdrop-filter": "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
  "no blend modes": "*{mix-blend-mode:normal!important}",
  "no css animations": "*{animation:none!important}",
  "no transitions": "*{transition:none!important}",
  "no shadows": "*{box-shadow:none!important;filter:none!important}",
  "no glow": ".global-glow{display:none!important}",
  "reduced-motion": "@media all{}",
};
const which = process.argv[2] ? [process.argv[2]] : Object.keys(variants);
const route = process.argv[3] || "/";
const b = await puppeteer.launch({ headless: "new", args: ["--enable-gpu-rasterization"] });
for (const v of which) {
  const p = await b.newPage();
  await p.setViewport({ width: 1366, height: 768 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem("shramsafal.language", "en"); } catch {} });
  await p.setRequestInterception(true);
  p.on("request", r => /googletagmanager|google-analytics/.test(r.url()) ? r.abort() : r.continue());
  await p.goto(origin + route, { waitUntil: "networkidle0" });
  if (variants[v]) await p.addStyleTag({ content: variants[v] });
  if (v === "reduced-motion") { await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); await p.reload({ waitUntil: "networkidle0" }); }
  const c = await p.createCDPSession();
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await new Promise(r => setTimeout(r, 800));
  await c.send("Performance.enable"); await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval",{interval:200}); await c.send("Profiler.start"); const m0 = Object.fromEntries((await c.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  await p.evaluate(() => { window.__f = []; let last = performance.now(); const tick = t => { window.__f.push(t - last); last = t; if (window.__run) requestAnimationFrame(tick); }; window.__run = true; requestAnimationFrame(tick); });
  await p.mouse.move(600, 400);
  for (let i = 0; i < 60; i++) { await p.mouse.wheel({ deltaY: 120 }); await p.mouse.move(500 + (i % 7) * 30, 300 + (i % 5) * 40); await new Promise(r => setTimeout(r, 50)); }
  const f = await p.evaluate(() => { window.__run = false; return window.__f.slice(2); });
  const s = [...f].sort((a, b) => a - b), p95 = s[Math.floor(s.length * 0.95)], avg = f.reduce((a, b) => a + b, 0) / f.length;
  const janky = f.filter(x => x > 50).length;
  const m1 = Object.fromEntries((await c.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value])); const d = k => ((m1[k] - m0[k]) * 1000).toFixed(0).padStart(5);
  const { profile } = await c.send("Profiler.stop"); const self = {}; const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n])); profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || "(anon)") + " " + n.callFrame.url.split("/").pop() + ":" + n.callFrame.lineNumber + ":" + n.callFrame.columnNumber; self[k] = (self[k] || 0) + (dt[i] || 0) / 1000; }); Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, ms]) => console.log("      ", ms.toFixed(0).padStart(6), "ms", k.slice(0, 110)));
  console.log("   ", v.padEnd(18), "main-thread ms: script", d("ScriptDuration"), " style", d("RecalcStyleDuration"), " layout", d("LayoutDuration"), " total", d("TaskDuration"), " layouts", m1.LayoutCount - m0.LayoutCount, " styles", m1.RecalcStyleCount - m0.RecalcStyleCount);
  console.log(v.padEnd(20), "frames", String(f.length).padStart(4), " avg", avg.toFixed(1).padStart(5), "ms  p95", p95.toFixed(0).padStart(4), "ms  >50ms:", janky, " fps≈", (1000 / avg).toFixed(0));
  await p.close();
}
await b.close(); srv.close();
