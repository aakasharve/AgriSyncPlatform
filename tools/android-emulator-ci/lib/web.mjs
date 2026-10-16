// Drives the REAL Android WebView of the installed app over Chrome DevTools (adb forward to the
// WebView devtools socket). Clicks are real touches injected through adb (`input tap`) after a
// calibration step; if calibration fails we fall back to CDP mouse events and SAY SO (inputMode).
import WebSocket from 'ws';
import { adb, sh, sleep, tap, screenSize } from './adb.mjs';

export class Unreachable extends Error {}
/** The REAL touch could not do the job (e.g. it lands on the system status bar). Always a FAIL, never rescued. */
export class NavFail extends Error {}

// ----------------------------------------------------------------- in-page helpers
const BOOT = `(function(){
  if (window.__ci) return window.__ci;
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(el);
    return !(s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0); };
  const clickable = (e) => e.closest('button,a,[role=button],label,summary') || e;
  const find = (spec) => {
    let list = [];
    if (spec.testid) list = Array.from(document.querySelectorAll('[data-testid="' + spec.testid + '"]'));
    else if (spec.testidPrefix) list = Array.from(document.querySelectorAll('[data-testid^="' + spec.testidPrefix + '"]'));
    else if (spec.css) list = Array.from(document.querySelectorAll(spec.css));
    else if (spec.text) {
      const rx = new RegExp(spec.text.src, spec.text.flags);
      const cands = Array.from(document.querySelectorAll('button,a,[role=button],label,h1,h2,h3,h4,p,span,div,li,td,summary'))
        .filter((e) => vis(e) && rx.test((e.innerText || '').trim()));
      const deepest = cands.filter((e) => !cands.some((d) => d !== e && e.contains(d)));
      list = Array.from(new Set(deepest.map(clickable)));
    }
    return list.filter(vis);
  };
  const info = (spec, scroll) => {
    const l = find(spec); const n = l.length;
    const el = l[spec.index || 0];
    if (!el) return { n: 0 };
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // a finger may land anywhere on the control: use the centre, else the first uncovered of a few other points on it
    const pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.5], [0.85, 0.5]];
    let cx = r.left + r.width / 2, cy = r.top + r.height / 2, covered = true, coveredBy = null;
    for (const [fx, fy] of pts) {
      const px = r.left + r.width * fx, py = r.top + r.height * fy;
      if (px < 0 || py < 0 || px > vw || py > vh) continue;
      const t = document.elementFromPoint(px, py);
      const ok = !!t && (el === t || el.contains(t) || t.contains(el));
      if (ok) { cx = px; cy = py; covered = false; coveredBy = null; break; }
      if (coveredBy === null && t) coveredBy = t.getAttribute('data-testid') || t.tagName;
    }
    return { n, x: cx, y: cy, w: r.width, h: r.height, inView: cx >= 0 && cy >= 0 && cx <= vw && cy <= vh,
      covered, coveredBy,
      text: (el.innerText || '').trim().slice(0, 160), disabled: !!el.disabled, vw, vh };
  };
  window.__ci = { vis, find, info };
  return window.__ci;
})()`;

export class Web {
  constructor({ pkg, port = 9222, log = console.log }) {
    this.pkg = pkg; this.port = port; this.log = log;
    this.ws = null; this.nextId = 1; this.pending = new Map();
    this.net = []; this.errors = []; this.consoleErrors = [];
    this.inputMode = 'unknown'; this.calib = null; this.statusBarPx = 0; this.navBarPx = 0; this.screenH = 0; this.statusBarCollisions = [];
  }

  // ------------------------------------------------------------ connection
  async connect(timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = 'no webview socket yet';
    while (Date.now() < deadline) {
      try {
        const pid = sh(`pidof ${this.pkg}`, { allowFail: true }).split(/\s+/).filter(Boolean)[0];
        const unix = sh('cat /proc/net/unix', { allowFail: true });
        const socks = [...unix.matchAll(/@(webview_devtools_remote_(\d+))/g)].map((m) => ({ name: m[1], pid: m[2] }));
        const mine = socks.find((s) => s.pid === pid);
        if (mine) {
          adb(['forward', `tcp:${this.port}`, `localabstract:${mine.name}`]);
          const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
          const targets = await res.json();
          const page = targets.find((t) => t.type === 'page' && /^https:\/\/localhost/.test(t.url));
          if (page) {
            await this.#open(page.webSocketDebuggerUrl);
            await this.send('Runtime.enable'); await this.send('Page.enable'); await this.send('Network.enable');
            this.pid = pid;
            return;
          }
          lastErr = `webview socket present, no https://localhost page yet (${targets.map((t) => t.url).join(',')})`;
        } else lastErr = `pid=${pid || 'none'} sockets=${socks.map((s) => s.pid).join(',') || 'none'}`;
      } catch (e) { lastErr = String(e.message).slice(0, 200); }
      await sleep(2000);
    }
    throw new Unreachable('could not attach to the app WebView over DevTools: ' + lastErr);
  }

  #open(url) {
    return new Promise((resolve, reject) => {
      if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
      const ws = new WebSocket(url, { perMessageDeflate: false });
      this.ws = ws; this.pending.clear();
      ws.on('open', () => resolve());
      ws.on('error', (e) => reject(e));
      ws.on('message', (data) => this.#onMessage(JSON.parse(String(data))));
      ws.on('close', () => { for (const [, p] of this.pending) p.reject(new Error('devtools socket closed')); this.pending.clear(); });
    });
  }

  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message}`)); else p.resolve(msg.result);
      return;
    }
    const { method, params } = msg;
    if (method === 'Network.requestWillBeSent') {
      this.net.push({ t: Date.now(), id: params.requestId, method: params.request.method, url: params.request.url, status: null, failed: null });
    } else if (method === 'Network.responseReceived') {
      const r = this.net.find((x) => x.id === params.requestId); if (r) r.status = params.response.status;
    } else if (method === 'Network.loadingFailed') {
      const r = this.net.find((x) => x.id === params.requestId); if (r) r.failed = params.errorText;
    } else if (method === 'Runtime.exceptionThrown') {
      this.errors.push({ t: Date.now(), text: (params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '').slice(0, 300) });
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      this.consoleErrors.push({ t: Date.now(), text: (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    }
  }

  send(method, params = {}, timeout = 30_000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('devtools socket not open'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() { try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; }

  // ------------------------------------------------------------ evaluation
  async eval(expr, { timeout = 30_000, retries = 3 } = {}) {
    let err;
    for (let i = 0; i < retries; i++) {
      try {
        const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout);
        if (r.exceptionDetails) throw new Error('page exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
        return r.result?.value;
      } catch (e) {
        err = e;
        if (/context|destroyed|not open|closed/i.test(String(e.message))) { await sleep(1000); continue; }
        throw e;
      }
    }
    throw err;
  }

  // ------------------------------------------------------------ locators
  static tid(id) { return { testid: id }; }
  static tidPrefix(p) { return { testidPrefix: p }; }
  static css(sel, index = 0) { return { css: sel, index }; }
  static text(re, index = 0) { return { text: { src: re.source, flags: re.flags }, index }; }

  async info(spec, scroll = false) {
    return this.eval(`(() => { const ci = ${BOOT}; return ci.info(${JSON.stringify(spec)}, ${scroll}); })()`);
  }
  async count(spec) { const i = await this.info(spec); return i.n || 0; }
  async visible(spec) { return (await this.count(spec)) > 0; }

  async waitVisible(spec, timeout = 20_000, label = '') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await this.visible(spec)) return true; } catch { /* page reloading */ }
      await sleep(400);
    }
    throw new Unreachable(`${label || JSON.stringify(spec)} not visible after ${timeout} ms`);
  }
  async waitGone(spec, timeout = 20_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { try { if (!(await this.visible(spec))) return true; } catch { /* ignore */ } await sleep(400); }
    return false;
  }

  /** Tap the centre of an element: real touch via adb when calibrated, else CDP mouse. */
  async click(spec, { timeout = 20_000, label = '' } = {}) {
    const end = Date.now() + timeout; let last = null;
    while (Date.now() < end) {
      let i;
      try { i = await this.info(spec, true); if (i.n) { await sleep(450); i = await this.info(spec, false); } } catch (e) { last = e.message; await sleep(500); continue; }
      last = JSON.stringify(i);
      if (i.n && i.inView && !i.covered) {
        await sleep(150);
        await this.#tapAt(i.x, i.y);
        return i;
      }
      await sleep(500);
    }
    const why = last && /"inView":false/.test(last) ? ' (element exists but is OUTSIDE the viewport after scrolling)' : /"covered":true/.test(last || '') ? ' (covered by another element)' : '';
    throw new Unreachable(`click target ${label || JSON.stringify(spec)} not tappable${why}: ${String(last).slice(0, 200)}`);
  }

  async #tapAt(cx, cy) {
    if (this.calib && this.beforeTap) await this.beforeTap();
    if (this.calib) {
      const x = Math.round(cx * this.calib.scale + this.calib.ox); const y = Math.round(cy * this.calib.scale + this.calib.oy);
      if (this.statusBarPx && y < this.statusBarPx) {
        // A finger here hits the system status bar, not the app. NAVIGATION PASS RULE: this is a failure; no
        // DOM/CDP input is used to carry on (see domDiagnostic for the labelled, never-passing diagnostic).
        this.statusBarCollisions.push({ x, y, statusBarPx: this.statusBarPx });
        throw new NavFail(`real touch at device y=${y}px would land on the system status bar (0-${this.statusBarPx}px)`);
      }
      if (this.navBarPx && this.screenH && y > this.screenH - this.navBarPx) {
        this.statusBarCollisions.push({ x, y, navBarPx: this.navBarPx });
        throw new NavFail(`real touch at device y=${y}px would land on the system gesture/navigation bar (${this.screenH - this.navBarPx}-${this.screenH}px)`);
      }
      tap(x, y); await sleep(250); return;
    }
    for (let a = 0; a < 3 && !this.calib; a++) { if (this.onCalibrateRetry) await this.onCalibrateRetry(); await this.calibrate(); }
    // A harness problem (a system dialog or a dead emulator ate the probe tap), not an app result: never fall back to non-touch input.
    if (!this.calib) throw new Unreachable('no touch calibration after 3 tries: refusing to use non-touch input');
    return this.#tapAt(cx, cy);
  }

  /** DIAGNOSTIC ONLY: would a DOM click on this target do something? Never used to pass anything. */
  async domDiagnostic(spec) {
    try { await this.eval(`(() => { const ci = ${BOOT}; const el = ci.find(${JSON.stringify(spec)})[0]; if (el) el.click(); })()`); return 'dom click issued'; } catch (e) { return 'dom click failed: ' + String(e.message).slice(0, 80); }
  }

  /** Map CSS px -> device px by injecting a probe and tapping a known device pixel. */
  async calibrate() {
    try {
      const size = screenSize();
      await this.eval(`(() => { window.__ciTap = null; window.addEventListener('pointerdown', (e) => { window.__ciTap = { x: e.clientX, y: e.clientY }; }, { capture: true, once: true }); })()`);
      const dx = Math.round(size.w / 2); const dy = Math.round(size.h * 0.4);
      tap(dx, dy); await sleep(600);
      const hit = await this.eval('window.__ciTap');
      const dpr = await this.eval('window.devicePixelRatio');
      if (hit && dpr) {
        this.calib = { scale: dpr, ox: dx - hit.x * dpr, oy: dy - hit.y * dpr, dpr, probe: { device: [dx, dy], css: [hit.x, hit.y] } };
        this.inputMode = `adb-touch (offset ${Math.round(this.calib.ox)},${Math.round(this.calib.oy)} scale ${dpr})`;
      } else { this.calib = null; this.inputMode = 'cdp-mouse (touch calibration got no pointer event)'; }
    } catch (e) { this.calib = null; this.inputMode = 'cdp-mouse (calibration error: ' + String(e.message).slice(0, 100) + ')'; }
    return this.inputMode;
  }

  /** Focus an input and replace its content with real text input events. */
  async fill(spec, text, { timeout = 15_000 } = {}) {
    await this.waitVisible(spec, timeout);
    await this.eval(`(() => { const ci = ${BOOT}; const el = ci.find(${JSON.stringify(spec)})[${spec.index || 0}]; el.scrollIntoView({block:'center'}); el.focus(); if (el.select) el.select(); })()`);
    await sleep(200);
    await this.send('Input.insertText', { text });
    await sleep(200);
  }

  async text() { return (await this.eval('document.body ? document.body.innerText : ""')) || ''; }
  async url() { return this.eval('location.href'); }
  async reload() { try { await this.send('Page.reload', {}, 20_000); } catch { /* ignore */ } await sleep(2500); }

  // ------------------------------------------------------------ app storage helpers
  async queue() {
    return this.eval(`(async () => {
      const dbs = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^AgriLogDB/.test(n)); const per = {}; let total = 0; const st = {};
      for (const name of dbs) {
        const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        if (db.objectStoreNames.contains('mutationQueue')) {
          const rows = await new Promise((res) => { const t = db.transaction('mutationQueue').objectStore('mutationQueue').getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); });
          rows.forEach((r) => { const k = String(r.status); st[k] = (st[k] || 0) + 1; }); per[name] = rows.length; total += rows.length;
        }
        db.close();
      }
      return { total, st, per };
    })()`);
  }
  /** All IndexedDB + localStorage content as one lowercase string, to prove a name is NOT stored. */
  async storageHaystack() {
    return this.eval(`(async () => {
      let out = '';
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out += ' ' + k + '=' + localStorage.getItem(k); }
      const dbs = await indexedDB.databases();
      for (const d of dbs) {
        const db = await new Promise((res) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
        if (!db) continue;
        for (const s of Array.from(db.objectStoreNames)) {
          const rows = await new Promise((res) => { try { const t = db.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); } catch (e) { res([]); } });
          try { out += ' ' + s + ':' + JSON.stringify(rows); } catch (e) { /* blobs */ }
        }
        db.close();
      }
      return out.toLowerCase();
    })()`, { timeout: 60_000 });
  }
}
