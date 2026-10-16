// Android emulator evidence driver. INTERNAL TEST tooling.
// Runs against: the internal-test debug APK, installed on an Android emulator, talking to a CI-hosted
// test API + Postgres. Every check records PASS / FAIL / UNVERIFIED with evidence.
//   PASS        the assertion was made on observed state and held
//   FAIL        the assertion was made on observed state and did NOT hold (an app finding)
//   UNVERIFIED  the harness could not reach the state needed to assert (never a hidden pass)
import fs from 'node:fs';
import path from 'node:path';
import { Check, BANNER, counts, legMarkdown } from './lib/results.mjs';
import { adb, sh, sleep, screenSize, screencap, dumpUi, parseNodes, permissionDialog, key, imeShown, focusedWindow, resumedActivity, tap } from './lib/adb.mjs';
import { Web, Unreachable, NavFail } from './lib/web.mjs';
import { psql, psqlNum } from './lib/db.mjs';
import { classifySrcWrites } from './lib/srcwrites.mjs';

const env = (k, d) => process.env[k] ?? d;
const PKG = env('APP_ID', 'com.agrisync.shramsafal.internaltest');
const LEG = env('LEG_NAME', 'leg');
const OUT = env('OUT_DIR', './out');
const API_BASE = env('API_BASE', 'http://127.0.0.1:5190');
const PW = env('DEMO_PASSWORD', '');
const API_LOG = env('API_LOG', '');
const SMALL = env('SCREEN', 'normal') === 'small';
if (!PW) throw new Error('DEMO_PASSWORD missing');

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[+${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);

const PHONES = { owner: '8888888888', coOwner: '9800000010', mukadam: '9800000002', worker: '9800000003', ownerB: '9800000030' };
const NAMES_A = ['Ramesh Patil', 'Sunita Jadhav', 'Kisan More', 'Shankar Mukadam-Crew'];

const results = {
  banner: BANNER,
  build: { appSha: env('APP_SHA', 'unknown'), harnessSha: env('HARNESS_SHA', 'unknown') },
  leg: { informational: env('INFORMATIONAL', '') === 'true', name: LEG, apiLevel: Number(env('API_LEVEL', 0)), screen: env('SCREEN', 'normal'), target: env('EMU_TARGET', 'google_apis'), arch: 'x86_64' },
  app: {}, env: {}, inputMode: '', startedAt: new Date().toISOString(), checks: [],
};
const checks = results.checks;
const writeResults = () => {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), legMarkdown(results) + '\n');
};

let web = null;
let shotN = 0;
let statusBarPx = 0;
let navBarPx = 0;
const shot = (c, label) => {
  const f = `${LEG}-${c ? c.id : 'x'}-${String(++shotN).padStart(2, '0')}-${label}.png`;
  try { screencap(path.join(OUT, 'shots', f)); c?.screens.push(f); } catch (e) { log('screencap failed', e.message); }
  return f;
};

async function problemEvidence(c) {
  try {
    shot(c, 'state');
    if (web?.ws) {
      c.evidence.url = await web.url().catch(() => null);
      c.evidence.pageText = (await web.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1200);
    }
    c.evidence.focus = focusedWindow();
    if (web) {
      c.evidence.netTail = web.net.slice(-14).map((n) => `${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70)} ${n.status ?? n.failed ?? '-'}`);
      c.evidence.pageErrors = web.errors.slice(-4);
      log('      page: ' + String(c.evidence.pageText || '').slice(0, 220));
      log('      net: ' + JSON.stringify(c.evidence.netTail).slice(0, 700));
    }
  } catch (e) { c.evidence.evidenceError = String(e.message).slice(0, 200); }
}

let appRenders = true; // false when the WebView cannot even paint the app (e.g. stock WebView 74 on API 29)
class DeviceDead extends Error {}
const deviceAlive = () => adb(['get-state'], { allowFail: true, timeout: 15_000 }).trim() === 'device';

async function check(id, title, fn) {
  if (!deviceAlive()) throw new DeviceDead(`emulator is gone before ${id}`);
  const c = new Check(id, title);
  checks.push(c);
  log(`--- ${id} ${title}`);
  if (!appRenders && !['C01', 'C21'].includes(id)) { c.unverified('skipped: the app UI never rendered on this WebView (see C02), so there is nothing to drive'); writeResults(); return c; }
  const runOnce = () => Promise.race([fn(c), new Promise((_, rej) => setTimeout(() => rej(new Unreachable('check watchdog: no result after 9 minutes (harness hang)')), 9 * 60_000))]);
  try {
    try { await runOnce(); } catch (e0) {
      // The app process vanished mid-check (crash / low-memory kill / OOM on a loaded emulator). Record it with the crash and
      // event logs, relaunch and run the check ONCE more; the death stays on the record either way.
      if (!deviceAlive() || appRunning() || c.__rerun) throw e0;
      snapshotAppDeath(id); c.__rerun = true;
      c.evidence.firstAttemptLostTheAppProcess = String(e0.message).slice(0, 200);
      c.points.length = 0; shotN += 0;
      await launchCold(); await dismissOverlays().catch(() => false);
      await runOnce();
    }
  } catch (e) {
    if (e instanceof NavFail) { c.fail(`NAVIGATION PASS RULE: the real touch did not do the job - ${e.message}`); c.evidence.navigationFallback = 'none used (DOM/CDP input is never used to rescue a navigation)'; }
    else if (e instanceof Unreachable) c.unverified(`the UI state needed was not reachable: ${e.message}`);
    else c.unverified(`harness error: ${String(e.stack || e.message).slice(0, 500)}`);
  }
  if (!deviceAlive()) { checks.pop(); throw new DeviceDead(`emulator died during ${id}`); }
  if (c.status !== 'PASS') await problemEvidence(c);
  writeResults();
  log(`=== ${id} ${c.status}  ${c.points.map((p) => p.s[0]).join('')}`);
  if (c.status !== 'PASS') for (const p of c.points) if (p.s !== 'PASS') log(`      ${p.s}: ${p.m}`.slice(0, 600));
  return c;
}

// ------------------------------------------------------------------ device + app helpers
const fa = () => psql(`select f."Id" from ssf.farms f join public.users u on u."Id"=f.owner_user_id where u.phone='${PHONES.owner}' order by f.created_at_utc limit 1`);
const opId = (name) => psql(`select "Id" from ssf.field_operators where display_name='${name}' limit 1`);
const marksFor = (id) => psqlNum(`select count(*) from ssf.attendance_marks where field_operator_id='${id}'`);
const dupPairs = () => psqlNum('select count(*) from (select field_operator_id, work_date from ssf.attendance_marks group by 1,2 having count(*)>1) x');

// An overloaded emulator shows "<system app> isn't responding" (ANR) dialogs that steal Back and permission
// taps. Those are emulator load artefacts, not app behaviour: count them and tap "Wait".
results.anrDialogs = [];
async function dismissSystemDialogs() {
  try {
    const nodes = parseNodes(await dumpUi());
    const hit = nodes.find((n) => /isn't responding|keeps stopping|has stopped/i.test(n.text));
    const wait = nodes.find((n) => /^(wait|close app|ok)$/i.test(n.text) && !/permissioncontroller/.test(n.pkg));
    if (hit) {
      results.anrDialogs.push({ t: new Date().toISOString(), text: hit.text });
      log('      system dialog: ' + hit.text);
      const waitBtn = nodes.find((n) => /^wait$/i.test(n.text)) || wait;
      if (waitBtn) tap(waitBtn.x, waitBtn.y);
      await sleep(1500);
      return true;
    }
  } catch { /* best effort */ }
  return false;
}

const edge = {}; // screens measured during the first login: welcome, onboarding
const edgeJs = (anchorTid) => `(() => { const a = document.querySelector('[data-testid="${anchorTid}"]'); if (!a) return null;
  let root = a; while (root && root !== document.body) { if (getComputedStyle(root).position === 'fixed') break; root = root.parentElement; }
  if (!root || root === document.body) root = document.body;
  const dpr = window.devicePixelRatio; const cs = getComputedStyle(root);
  let top = 1e9, bottom = 0;
  root.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return;
    const leafText = e.children.length === 0 && (e.textContent || '').trim(); if (!(leafText || e.tagName === 'BUTTON' || e.tagName === 'IMG')) return;
    top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); });
  const rs = getComputedStyle(document.documentElement);
  return { padTopPx: Math.round(parseFloat(cs.paddingTop) * dpr), padBottomPx: Math.round(parseFloat(cs.paddingBottom) * dpr),
    contentTopPx: Math.round(top * dpr), contentBottomPx: Math.round(bottom * dpr), viewportHpx: Math.round(innerHeight * dpr),
    safeTopVar: rs.getPropertyValue('--safe-area-inset-top').trim(), safeBottomVar: rs.getPropertyValue('--safe-area-inset-bottom').trim() }; })()`;

const presentTid = (tid) => web.eval(`!!document.querySelector('[data-testid="${tid}"]')`).catch(() => false);

// The system launcher is the usual source of "isn't responding" dialogs on a loaded emulator, and those dialogs
// swallow permission dialogs and taps. Stopping it is harmless (it restarts on demand) and not an app action.
function calmLauncher() { sh('am force-stop com.google.android.apps.nexuslauncher', { allowFail: true }); }

function hideIme() { if (imeShown()) key(4); }

// Killing the app while a token refresh is in flight can leave the server with a rotated token the app never stored
// (the next launch then gets 401 and shows the login screen). Let in-flight refresh/login calls finish first.
async function quiesceAuth() {
  if (!web) return;
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const pending = web.net.filter((n) => /\/user\/auth\/(refresh|login|logout)/.test(n.url) && n.status === null && !n.failed && Date.now() - n.t < 15_000);
    if (!pending.length) break;
    await sleep(400);
  }
  await sleep(800);
}
let currentPhone = PHONES.owner;
results.appProcessDeaths = [];
const appRunning = () => sh(`pidof ${PKG}`, { allowFail: true }).trim().length > 0;
function snapshotAppDeath(label) {
  const ev = adb(['logcat', '-b', 'events,crash', '-d', '-v', 'time'], { allowFail: true, timeout: 60_000 }).split('\n').filter((l) => /am_proc_died|am_crash|am_anr|am_kill|FATAL|AndroidRuntime|lowmemorykiller|Fatal signal|agrisync/i.test(l)).slice(-25);
  results.appProcessDeaths.push({ at: new Date().toISOString(), during: label, eventsAndCrashLines: ev });
  log(`      APP PROCESS WAS NOT RUNNING during ${label}; recorded in results.appProcessDeaths (${ev.length} log lines)`);
}
results.relogins = [];

async function launchCold({ attach = true } = {}) {
  await quiesceAuth();
  if (web) { await web.close(); }
  sh(`am force-stop ${PKG}`, { allowFail: true }); await sleep(1500);
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true });
  if (!attach) return null;
  web = new Web({ pkg: PKG, log });
  await web.connect();
  web.onCalibrateRetry = dismissSystemDialogs;
  web.beforeTap = async () => { for (let n = 0; n < 3 && sh("dumpsys window | grep -m1 'Application Not Responding' | wc -l", { allowFail: true, timeout: 20_000 }).trim() === '1'; n++) { await dismissSystemDialogs(); } };
  for (let a = 0; a < 3 && !web.calib; a++) { if (a) await dismissSystemDialogs(); await web.calibrate(); }
  web.statusBarPx = statusBarPx; web.navBarPx = navBarPx; web.screenH = screenSize().h;
  results.inputMode = web.inputMode;
  return web;
}
const appForeground = () => resumedActivity().includes(PKG);

async function noPermissionDialog(c, label) {
  const nodes = parseNodes(await dumpUi());
  const dlg = permissionDialog(nodes);
  const focus = focusedWindow();
  const rec = (sh(`dumpsys package ${PKG}`, { allowFail: true, timeout: 40_000 }).match(/android\.permission\.RECORD_AUDIO: granted=(\w+)/) || [])[1];
  c.evidence[`micState_${label}`] = { permissionDialogShown: !!dlg, dialogText: dlg?.message ?? null, focus, recordAudioGranted: rec ?? 'unknown' };
  c.assert(!dlg && !/GrantPermissions/i.test(focus), `no OS permission dialog ${label}`, `OS permission dialog was shown ${label}: "${dlg?.message ?? focus}"`);
  if (rec === 'true') c.fail(`RECORD_AUDIO was already granted ${label} without any user action (unexpected state)`);
}

async function consentIfShown() {
  const cta = Web.tid('consent-accept-cta'); const useBtn = Web.text(/Use password/i);
  let stable = 0; const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await web.visible(cta)) {
      await web.click(Web.tid('consent-age-checkbox'), { label: 'consent age checkbox' });
      await web.click(cta, { label: 'consent accept' });
      await web.waitGone(cta, 25_000);
      return true;
    }
    if (await web.visible(useBtn)) { if (++stable >= 6) return false; } else stable = 0;
    await sleep(400);
  }
  return false;
}

async function dismissOverlays() {
  for (let k = 0; k < 12; k++) {
    // session lost (e.g. refresh token 401 after the app was killed mid-refresh): recorded, then signed in again so the journey can continue
    if (k === 1 && !(await web.visible(Web.tid('header-setup-hub')).catch(() => false)) && await web.visible(Web.text(/Use password|OTP पाठवा/i)).catch(() => false)) {
      const lastRefresh = web.net.filter((n) => /\/auth\/refresh/.test(n.url)).slice(-1)[0];
      results.relogins.push({ at: new Date().toISOString(), phone: currentPhone, lastRefreshStatus: lastRefresh ? (lastRefresh.status ?? lastRefresh.failed) : null });
      log('      SESSION LOST - signing in again (recorded in results.relogins)');
      const r = await loginUi(currentPhone); if (!r.ok) return false;
      continue;
    }
    const i = await web.info(Web.tid('header-setup-hub')).catch(() => ({ n: 0 }));
    if (i.n && !i.covered) return true;
    let clicked = false;
    // 1. the known first-run / intro buttons (real taps)
    for (const spec of [Web.tid('welcome-continue'), Web.tid('onboarding-skip'),
      Web.text(/चला, सुरुवात करूया/), Web.text(/समजलं, पुढे चला/), Web.text(/^\s*पुढे चला\s*$/), Web.text(/^\s*नंतर\s*$/), Web.text(/^\s*Skip\s*$/i)]) {
      if (await web.visible(spec).catch(() => false)) { try { await web.click(spec, { timeout: 4000 }); clicked = true; log('      overlay tapped: ' + JSON.stringify(spec).slice(0, 90)); break; } catch (e) { log('      overlay click failed: ' + String(e.message).slice(0, 160)); } }
    }
    if (clicked) { await sleep(1500); continue; }
    if ((await presentTid('welcome-continue')) || (await presentTid('onboarding-skip'))) { log('      first-run screen present but its button is not visible/tappable yet; waiting'); await sleep(1500); continue; }
    // 2. the 'needs attention' bottom sheet that can open by itself over home: its own X
    if (i.n && i.covered && await web.visible(Web.css('svg.lucide-x')).catch(() => false)) { try { await web.click(Web.css('svg.lucide-x'), { timeout: 4000 }); await sleep(1200); continue; } catch { /* fall through */ } }
    // 3. last resort: the control at the top-right of whatever covers the header
    if (i.n && i.covered && k >= 4) {
      const tagged = await web.eval(`(() => { let e = document.elementFromPoint(24, 75); while (e && e !== document.body && getComputedStyle(e).position !== 'fixed') e = e.parentElement; if (!e) return false;
        let best = null; e.querySelectorAll('button, [role=button]').forEach((b) => { const r = b.getBoundingClientRect(); if (r.width > 0 && r.top < innerHeight * 0.5 && (!best || r.right - r.top * 2 > best.score)) best = { b, score: r.right - r.top * 2 }; });
        if (!best) return false; best.b.setAttribute('data-ci-close', '1'); return true; })()`).catch(() => false);
      if (tagged) { try { await web.click(Web.css('[data-ci-close="1"]'), { timeout: 4000 }); await sleep(1200); } catch { /* fall through */ } await web.eval(`document.querySelectorAll('[data-ci-close]').forEach((e) => e.removeAttribute('data-ci-close'))`).catch(() => {}); continue; }
    }
    await sleep(1000);
  }
  return false;
}

async function loginUi(phone) {
  currentPhone = phone;
  const diag = [];
  const d = (m) => { diag.push(m); log('      login: ' + m); };
  if (await consentIfShown()) { d('consent passed'); await sleep(3000); }
  // the password form must really be on screen before typing (a re-render can reset it to OTP mode)
  for (let a = 0; a < 4; a++) {
    if (await web.visible(Web.css('#auth-password'))) break;
    await web.click(Web.text(/Use password/i), { label: 'Use password' });
    await sleep(1500);
    d(`use-password tap ${a + 1}; password field visible=${await web.visible(Web.css('#auth-password'))}`);
  }
  await web.fill(Web.css('#auth-phone'), phone);
  await web.fill(Web.css('#auth-password'), PW);
  const vals = await web.eval(`({ phoneLen: (document.querySelector('#auth-phone')||{}).value?.length, pwLen: (document.querySelector('#auth-password')||{}).value?.length })`);
  d(`field lengths ${JSON.stringify(vals)}`);
  hideIme(); await sleep(800);
  shot(null, 'login-filled');
  const before = web.net.length;
  await web.click(Web.css('button[type="submit"]'), { label: 'login submit' });
  const end = Date.now() + 60_000; let alertText = null;
  while (Date.now() < end) {
    if (!appRunning()) throw new Error('app process not running: pid=none');
    for (const [name, spec, tid] of [['welcome', Web.tid('welcome-continue'), 'welcome-continue'], ['onboarding', Web.tid('onboarding-skip'), 'onboarding-skip']]) {
      if (await web.visible(spec).catch(() => false)) {
        if (!edge[name]) { await sleep(2500); edge[name] = await web.eval(edgeJs(tid)).catch(() => null); shot(null, `edge-${name}`); }
        try { await web.click(spec, { timeout: 4000 }); } catch (e) { log('      first-run click failed: ' + String(e.message).slice(0, 160)); }
      }
    }
    if (await web.visible(Web.tid('header-setup-hub')).catch(() => false) && !(await presentTid('welcome-continue')) && !(await presentTid('onboarding-skip'))) return { ok: true, diag };
    const a = await web.info(Web.css('[role=alert]')).catch(() => ({ n: 0 }));
    if (a.n) alertText = a.text;
    await sleep(800);
  }
  d('requests after submit: ' + JSON.stringify(web.net.slice(before).map((n) => `${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 50)} ${n.status ?? n.failed ?? '-'}`)).slice(0, 500));
  shot(null, 'login-failed');
  return { ok: false, alertText, diag };
}

const SETUP_HUB_OPEN = [Web.text(/बाहेर पडा/), Web.tid('hub-settings-voice-diary'), Web.text(/^\s*कामाचा हिशोब\s*$/)];
async function setupHubOpen() { for (const m of SETUP_HUB_OPEN) if (await web.visible(m).catch(() => false)) return true; return false; }
async function openSetupHub() {
  await dismissOverlays();
  // a slow emulator can swallow the first tap; retry until the Setup Hub is really showing
  for (let a = 0; a < 4; a++) {
    await web.click(Web.tid('header-setup-hub'), { label: 'header setup hub' });
    for (let k = 0; k < 8; k++) { await sleep(500); if (await setupHubOpen()) { await sleep(600); return; } }
    await dismissOverlays();
  }
  const diag = await web.domDiagnostic(Web.tid('header-setup-hub')); // DIAGNOSTIC ONLY, never rescues
  await sleep(1500);
  results.diagnostics = (results.diagnostics || []).concat([{ what: 'Setup Hub DOM click after 4 failed real taps (diagnostic only)', result: diag, openedByDom: await setupHubOpen() }]);
  throw new NavFail('4 real taps on the header Setup Hub button did not open it');
}
const HUB_MARKERS = [Web.text(/हजेरी वही/), Web.tid('labour-stat-grid'), Web.tid('labour-window-slider'), Web.tid('labour-review-strip'), Web.text(/हजेरी घ्या/), Web.tid('hub-invite-qr')];
async function hubLoaded(timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const m of HUB_MARKERS) if (await web.visible(m).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}
async function openLabourHub({ lenient = false } = {}) {
  await openSetupHub();
  await web.click(Web.text(/^\s*कामाचा हिशोब\s*$/), { label: 'Labour hub row (कामाचा हिशोब)' });
  if (!(await hubLoaded(lenient ? 15_000 : 30_000))) {
    if (lenient && !(await web.visible(Web.text(/^\s*कामाचा हिशोब\s*$/)).catch(() => true))) return 'opened-without-known-markers';
    throw new Unreachable('Labour hub did not show any known marker within 30 s');
  }
  await sleep(1500);
  return 'markers';
}
async function openTeam() {
  await openSetupHub();
  await web.click(Web.text(/शेतकरी ओळख/), { label: 'Team entry (शेतकरी ओळख)' });
  await web.waitVisible(Web.text(/माझा शेत संघ/), 25_000, 'Team heading (माझा शेत संघ)');
  await sleep(1500);
}
async function openAttendance() {
  await web.click(Web.text(/^\s*हजेरी घ्या\s*$/), { label: 'manual attendance tile' });
  await web.waitVisible(Web.tid('attendance-screen'), 20_000, 'attendance screen');
  await web.waitVisible(Web.tidPrefix('att-row-'), 20_000, 'attendance roster rows');
  await sleep(1000);
}
async function goHome() { await web.reload(); await dismissOverlays(); }

async function logoutUi() {
  await openSetupHub();
  await web.click(Web.text(/बाहेर पडा/), { label: 'log out row' });
  await sleep(1500);
  // a confirmation may follow
  for (const spec of [Web.text(/^\s*(होय|बाहेर पडा|Log out|Yes)\s*$/i)]) {
    if (await web.visible(spec).catch(() => false)) { try { await web.click(spec, { timeout: 3000 }); } catch { /* none */ } }
  }
  await web.waitVisible(Web.text(/Use password|OTP पाठवा|Send OTP/i), 30_000, 'login screen after logout');
}

const fetchApiFromPage = (ms = 5000) => web.eval(`(async () => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ${ms});
  try { const r = await fetch(${JSON.stringify(API_BASE.replace('127.0.0.1', '10.0.2.2'))} + '/health/ready', { signal: c.signal, cache: 'no-store' }); clearTimeout(t); return { ok: r.ok, status: r.status }; }
  catch (e) { clearTimeout(t); return { ok: false, error: String(e && e.name || e) }; } })()`, { timeout: ms + 8000 });

async function consentMe() {
  const r = await fetch(`${API_BASE}/user/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'ci-consent' }, body: JSON.stringify({ phone: PHONES.owner, password: PW, rememberDevice: false }) });
  const tok = (await r.json()).accessToken;
  const c = await fetch(`${API_BASE}/shramsafal/consent/me`, { headers: { Authorization: `Bearer ${tok}`, 'X-Device-Id': 'ci-consent' } });
  const j = await c.json().catch(() => null);
  return j ? j.fullHistoryJournal === true : null;
}
async function ensureConsentGranted(c) {
  let consent = await consentMe();
  if (!consent) {
    await web.click(Web.tid('voice-retained-consent-checkbox'), { label: 'consent checkbox' });
    const fg = Web.tid('voice-retained-first-grant-banner');
    await web.waitVisible(fg, 8000).catch(() => {});
    if (await web.visible(fg)) await web.click(Web.tid('voice-retained-first-grant-confirm'), { label: 'first-grant confirm' });
    await sleep(3000); consent = await consentMe();
  }
  c.assert(consent === true, 'server records full-history consent = granted (set through the UI with real taps)', `consent is ${consent} on the server after the UI grant`);
  return consent;
}
const DIARY_BANNER = Web.text(/Open Settings|सेटिंग्ज उघडा/);
async function openDiaryViaSettings() {
  await openSetupHub();
  await web.click(Web.tid('hub-settings-voice-diary'), { label: 'Settings -> Voice Diary row' });
  await web.waitVisible(Web.tid('voice-retained-consent-toggle'), 25_000, 'Settings (voice retention) screen');
}

function airplane(on) {
  sh(`cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`, { allowFail: true });
}
const apiLogLines = () => { try { return fs.readFileSync(API_LOG, 'utf8').split('\n'); } catch { return []; } };

// ------------------------------------------------------------------ device facts
function collectDeviceFacts() {
  const g = (p) => sh(`getprop ${p}`, { allowFail: true });
  const pk = sh(`dumpsys package ${PKG}`, { allowFail: true, timeout: 40_000 });
  results.env = {
    sdk: g('ro.build.version.sdk'), release: g('ro.build.version.release'), model: g('ro.product.model'), abi: g('ro.product.cpu.abi'),
    wmSize: sh('wm size', { allowFail: true }), wmDensity: sh('wm density', { allowFail: true }), fontScale: sh('settings get system font_scale', { allowFail: true }),
    locale: g('persist.sys.locale') || g('ro.product.locale'), timezone: g('persist.sys.timezone'),
    webview: (sh('dumpsys webviewupdate', { allowFail: true }).match(/Current WebView package \(name, version\): \(([^)]*)\)/) || [])[1] || 'unknown',
  };
  results.app = {
    applicationId: PKG,
    versionName: (pk.match(/versionName=(\S+)/) || [])[1],
    versionCode: (pk.match(/versionCode=(\d+)/) || [])[1],
    targetSdk: (pk.match(/targetSdk=(\d+)/) || [])[1],
    debuggableFlag: /pkgFlags=\[[^\]]*DEBUGGABLE/.test(pk),
    firstInstall: (pk.match(/firstInstallTime=(.*)/) || [])[1],
  };
}

// =================================================================== the journeys
async function main() {
  collectDeviceFacts();
  let c02;

  await check('C01', 'internal-test build installs on the emulator', async (c) => {
    c.evidence = { app: results.app, device: results.env };
    c.assert(results.app.applicationId === PKG && /internal-test$/.test(results.app.versionName || ''),
      `installed ${PKG} versionName ${results.app.versionName} (internal-test suffix present)`,
      `unexpected package identity: ${JSON.stringify(results.app)}`);
    c.assert(results.app.debuggableFlag, 'debug build (expected for the internal-test build)', 'package is not flagged DEBUGGABLE');
  });

  // ---- C02 + C03: fresh launch, consent, login
  c02 = await check('C02', 'NO microphone prompt at cold start (fresh install, after login, relaunch)', async (c) => {
    sh(`pm clear ${PKG}`, { allowFail: true });
    await launchCold();
    c.evidence.userAgent = await web.eval('navigator.userAgent');
    try { await web.waitVisible(Web.tid('consent-accept-cta'), 60_000, 'consent screen on a fresh install'); } catch (e) {
      appRenders = false; c.evidence.pageTextAtFailure = (await web.text().catch(() => '')).slice(0, 200);
      // classify WHY nothing rendered: reload with the console attached, then probe what this WebView supports
      try {
        web.errors.length = 0; web.consoleErrors.length = 0;
        await web.reload(); await sleep(10_000);
        c.evidence.classification = {
          webview: results.env.webview, userAgent: await web.eval('navigator.userAgent').catch(() => null),
          scriptRequests: web.net.filter((n) => /\.js(\?|$)/.test(n.url)).map((n) => `${n.status ?? n.failed}`).slice(0, 12),
          uncaughtExceptions: web.errors.slice(0, 6), consoleErrors: web.consoleErrors.slice(0, 6),
          featureProbe: await web.eval(`(() => { const t = (f) => { try { return !!f(); } catch (e) { return 'ERR:' + e.name; } };
            return { optionalChaining: t(() => eval('({a:1})?.a===1')), nullishCoalescing: t(() => eval('null ?? 1')), bigInt: typeof BigInt !== 'undefined', objectHasOwn: typeof Object.hasOwn === 'function', arrayAt: typeof [].at === 'function',
              replaceAll: typeof ''.replaceAll === 'function', structuredClone: typeof structuredClone === 'function', privateClassFields: t(() => eval('(class{#a=1})')), classStaticBlock: t(() => eval('(class{static{}})')) }; })()`).catch((x) => String(x.message).slice(0, 100)),
          readout: 'Unclassified observation: the bundle did not render on this WebView. See uncaughtExceptions and featureProbe. No compatibility is claimed or implied for this WebView or any API below 34.' };
      } catch (x) { c.evidence.classificationError = String(x.message).slice(0, 200); }
      throw e; }
    await sleep(8000);
    shot(c, 'consent-screen');
    try {
      const dw = sh('dumpsys window', { allowFail: true, timeout: 40_000 });
      const grab = (re) => [...dw.matchAll(re)].map((m) => ({ top: Number(m[1]), bottom: Number(m[2]) }));
      const sbs = grab(/type=(?:ITYPE_)?status[Bb]ars?[^\n]*?frame=\[\d+,(\d+)\]\[\d+,(\d+)\]/g);
      const navs = grab(/type=(?:ITYPE_)?navigation[Bb]ars?[^\n]*?frame=\[\d+,(\d+)\]\[\d+,(\d+)\]/g);
      const sbH = sbs.map((x) => x.bottom - x.top).filter((h) => h > 0);
      const nvH = navs.map((x) => x.bottom - x.top).filter((h) => h > 0);
      statusBarPx = sbH.length ? Math.min(...sbH) : 0; web.statusBarPx = statusBarPx;
      navBarPx = nvH.length ? Math.min(...nvH) : 0; web.navBarPx = navBarPx; web.screenH = screenSize().h;
      c.evidence.statusBarPx = statusBarPx; c.evidence.navBarPx = navBarPx;
      c.evidence.insetCandidates = { statusBars: sbH, navigationBars: nvH, screenH: web.screenH };
    } catch { /* optional */ }
    await noPermissionDialog(c, 'on the consent screen (fresh install, 8 s after launch)');
  });

  await check('C03', 'consent accepted and password login (owner) on the real WebView', async (c) => {
    const consent = await consentIfShown();
    c.evidence.consentShown = consent;
    const res = await loginUi(PHONES.owner);
    shot(c, 'after-login');
    c.assert(res.ok, 'owner reached the signed-in home (header present)', `login did not reach home: ${res.alertText ?? 'no alert text'}`);
    const loginCalls = web.net.filter((n) => n.method === 'POST' && /\/user\/auth\/login/.test(n.url));
    c.evidence.loginCalls = loginCalls.map((n) => ({ url: n.url, status: n.status, failed: n.failed }));
    c.assert(loginCalls.some((n) => n.status === 200), 'POST /user/auth/login returned 200 from the emulator to the CI API', 'no 200 from /user/auth/login');
    const consentCalls = web.net.filter((n) => n.method === 'POST' && /consent/i.test(n.url));
    c.evidence.consentCalls = consentCalls.map((n) => ({ url: n.url.replace(/\?.*/, ''), status: n.status }));
    if (consent) c.assert(consentCalls.some((n) => n.status === 200), 'consent acceptance reached the server (200)', 'consent POST did not return 200');
    await dismissOverlays();
    await sleep(6000);
    await noPermissionDialog(c02, 'after login (home, 6 s)');
  });

  await check('C15', 'top-bar controls are not under the system status bar (a finger can reach them)', async (c) => {
    await dismissOverlays();
    const g = await web.eval(`(() => { const e = document.querySelector('[data-testid="header-setup-hub"]'); if (!e) return null; const r = e.getBoundingClientRect();
      const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)'; document.body.appendChild(p);
      const inset = parseFloat(getComputedStyle(p).paddingTop) || 0; p.remove();
      return { top: r.top, bottom: r.bottom, centerY: r.top + r.height / 2, safeAreaInsetTopCss: inset, dpr: window.devicePixelRatio }; })()`);
    if (!g || !statusBarPx) { c.unverified(`could not measure (header=${JSON.stringify(g)}, statusBarPx=${statusBarPx})`); return; }
    const topPx = Math.round(g.top * g.dpr); const centerPx = Math.round(g.centerY * g.dpr);
    c.evidence.geometry = { ...g, headerTopPx: topPx, headerCenterPx: centerPx, statusBarBottomPx: statusBarPx };
    shot(c, 'header-vs-status-bar');
    c.assert(centerPx > statusBarPx, `Setup Hub button centre (${centerPx}px) is below the status bar (${statusBarPx}px)`,
      `Setup Hub button (header, top-left) centre is at ${centerPx}px but the system status bar covers 0-${statusBarPx}px: a real touch hits the status bar, not the app (CSS safe-area-inset-top = ${g.safeAreaInsetTopCss}px)`);
  });

  await check('C02b', 'NO microphone prompt on relaunch of a signed-in install', async (c) => {
    await launchCold();
    await dismissOverlays();
    await sleep(8000);
    shot(c, 'relaunch-home');
    c.assert(await web.visible(Web.tid('header-setup-hub')), 'signed-in session survived force-stop and relaunch (home shown, no login)', 'relaunch did not land on home');
    await noPermissionDialog(c, 'after force-stop relaunch (home, 8 s)');
  });

  // ---- hub, manual attendance, mark
  let hubOk = false;
  await check('C04', 'Labour hub loads (owner)', async (c) => {
    await openLabourHub();
    hubOk = true;
    shot(c, 'labour-hub');
    const txt = await web.text();
    c.evidence.hubTextSample = txt.replace(/\s+/g, ' ').slice(0, 500);
    c.pass('Labour hub opened from the Setup Hub and rendered');
    c.assert(web.errors.length === 0, 'no uncaught page exceptions while loading', `page exceptions: ${JSON.stringify(web.errors.slice(0, 3))}`);
    const bad = web.net.filter((n) => /\/shramsafal\//.test(n.url) && !/\/weather\//.test(n.url) && (n.failed || (n.status && n.status >= 500)));
    c.assert(bad.length === 0, 'no failed or 5xx API calls (weather excluded: the CI backend has no weather provider key, so /weather answers 503 by design)', `failing calls: ${JSON.stringify(bad.slice(0, 4).map((b) => `${b.method} ${b.url} ${b.status ?? b.failed}`))}`);
  });

  const c06 = await check('C06', 'manual attendance tile: present for owner, absent for un-granted Worker', async (c) => {
    if (!hubOk) await openLabourHub();
    let tile = false; for (let k = 0; k < 20 && !tile; k++) { tile = await web.visible(Web.text(/^\s*हजेरी घ्या\s*$/)); if (!tile) await sleep(1000); }
    c.assert(tile, 'owner sees the manual attendance tile (हजेरी घ्या)', 'owner does NOT see the manual attendance tile');
    shot(c, 'owner-hub-tile');
  });

  let markedOp = null;
  await check('C07', 'mark attendance on the device -> a row in the server database', async (c) => {
    await openAttendance();
    shot(c, 'attendance-screen');
    const id = opId('Ramesh Patil'); markedOp = id;
    c.assert(!!id, 'seeded operator Ramesh Patil exists in the DB', 'seed problem: operator missing');
    const before = marksFor(id);
    await web.click(Web.tid(`att-day-Full-${id}`), { label: 'Ramesh Patil Full' });
    await sleep(400);
    shot(c, 'before-save');
    await web.click(Web.tid('att-save'), { label: 'attendance save' });
    let toast = false;
    for (let k = 0; k < 24; k++) { if ((await web.text()).includes('लक्षात ठेवलं')) { toast = true; break; } await sleep(300); }
    c.assert(toast, 'save acknowledged on screen (लक्षात ठेवलं)', 'no save acknowledgement seen within 7 s');
    let after = before;
    for (let k = 0; k < 40 && after <= before; k++) { await sleep(1500); after = marksFor(id); }
    c.evidence.dbRows = { before, after, row: psql(`select am.day_mark || '|' || am.night_mark || '|' || am.work_date from ssf.attendance_marks am where am.field_operator_id='${id}' order by am.work_date desc limit 1`) };
    c.assert(after === before + 1, `server DB gained exactly 1 attendance_marks row for Ramesh Patil (${before} -> ${after})`, `DB rows for Ramesh Patil ${before} -> ${after} (expected +1)`);
    c.evidence.queue = await web.queue();
    shot(c, 'after-save');
  });

  // ---- Team
  await check('C05', 'Team page shows the real roles and members', async (c) => {
    await goHome();
    await openTeam();
    shot(c, 'team-page');
    const txt = await web.text();
    c.evidence.teamText = txt.replace(/\s+/g, ' ').slice(0, 1500);
    const rows = psql(`select u.display_name || '|' || m.role from ssf.farm_memberships m join public.users u on u."Id"=m.user_id where m.farm_id='${fa()}' and m.status=3 order by 1`).split('\n').filter(Boolean);
    c.evidence.dbMembers = rows;
    const roleWord = { PrimaryOwner: 'मालक', SecondaryOwner: 'सहमालक', Mukadam: 'मुकादम', Worker: 'कामगार' };
    for (const r of rows) {
      const [name, role] = r.split('|');
      const first = name.split(' ')[0];
      c.assert(txt.includes(first), `member shown: ${name} (${role})`, `member ${name} (${role}) is in the DB but NOT on the Team page`);
    }
    for (const role of [...new Set(rows.map((r) => r.split('|')[1]))]) {
      c.assert(txt.includes(roleWord[role] || '??'), `role label present for ${role} (${roleWord[role]})`, `no Marathi label for role ${role} on the Team page`);
    }
    for (const n of NAMES_A) c.assert(txt.includes(n), `named worker listed: ${n}`, `named worker ${n} missing on Team page`);
  });

  await check('C09', 'invite QR / share link origin is https://app.shramsafal.in', async (c) => {
    const hadShare = await web.eval("typeof navigator.share === 'function'");
    c.evidence.nativeNavigatorShare = hadShare;
    await web.eval(`(() => { window.__shared = null; window.__copied = null;
      if (typeof navigator.share === 'function') navigator.share = async (d) => { window.__shared = d; };
      try { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; } catch (e) {} })()`);
    await web.click(Web.text(/Share farm QR/i), { label: 'Share farm QR' });
    await web.waitVisible(Web.css('img[alt^="QR code to join"]'), 30_000, 'invite QR image');
    shot(c, 'invite-sheet');
    await web.click(Web.text(/^\s*Share\s*$/), { label: 'Share button' });
    await sleep(1200);
    let url = await web.eval('window.__shared && window.__shared.url || window.__copied || null');
    if (!url) { await web.click(Web.text(/Copy link/i), { label: 'Copy link' }); await sleep(800); url = await web.eval('window.__copied'); }
    c.evidence.shareUrl = url ? url.replace(/join=[^&]+/, 'join=<token>') : null;
    c.evidence.path = hadShare ? 'navigator.share' : 'copy-link fallback (WebView has no navigator.share)';
    c.assert(!!url, 'the sheet produced a share/copy link', 'no link was produced by Share or Copy link');
    if (url) {
      c.assert(url.startsWith('https://app.shramsafal.in/'), 'link origin is https://app.shramsafal.in', `link origin is NOT the public origin: ${String(url).slice(0, 40)}`);
      c.assert(/[?&]join=[^&]+/.test(url) && /[?&]farm=[^&]+/.test(url), 'link carries join token and a non-empty farm code', `link lacks join= or has an empty farm=: ${c.evidence.shareUrl}`);
      c.assert(!/localhost|10\.0\.2\.2|127\.0\.0\.1/.test(url), 'no local origin leaked into the link', 'a local origin leaked into the link');
    }
  });

  // ---- edge clearance (status bar / gesture bar) on the screens the safe-area fix touches
  await check('C16', 'Welcome, Onboarding permissions, Profile bottom, plot-map action bar clear the status bar and gesture bar', async (c) => {
    const clears = (name, m, checkTop = true) => {
      if (!m) { c.unverified(`${name}: screen could not be reached`); return; }
      c.evidence[name] = m;
      if (checkTop) c.assert(m.contentTopPx >= statusBarPx - 2, `${name}: top content (${m.contentTopPx}px) is below the status bar (${statusBarPx}px)`,
        `${name}: top content at ${m.contentTopPx}px is UNDER the status bar (0-${statusBarPx}px); --safe-area-inset-top='${m.safeTopVar}'`);
      c.assert(!navBarPx || m.contentBottomPx <= m.viewportHpx - navBarPx + 2, `${name}: bottom content (${m.contentBottomPx}px) is above the gesture bar (${m.viewportHpx - navBarPx}px)`,
        `${name}: bottom content at ${m.contentBottomPx}px is UNDER the gesture/navigation bar (starts ${m.viewportHpx - navBarPx}px); --safe-area-inset-bottom='${m.safeBottomVar}'`);
    };
    // make the first-run screens appear again (clears two stored UI flags), then reach them with real taps
    await web.eval(`(async () => { const dbs = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^AgriLogDB/.test(n));
      for (const n of dbs) { const db = await new Promise((r) => { const q = indexedDB.open(n); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); if (!db) continue;
        if (db.objectStoreNames.contains('uiPrefs')) await new Promise((r) => { const tx = db.transaction('uiPrefs', 'readwrite'); const st = tx.objectStore('uiPrefs'); st.delete('shramsafal_welcome_seen'); st.delete('shramsafal_permissions_granted'); tx.oncomplete = () => r(); tx.onerror = () => r(); });
        db.close(); } })()`);
    await web.reload();
    const seen = {};
    for (const [name, tid] of [['welcome screen', 'welcome-continue'], ['onboarding permissions screen', 'onboarding-skip']]) {
      const ok = await web.waitVisible(Web.tid(tid), 25_000).then(() => true).catch(() => false);
      if (!ok) { c.unverified(`${name}: did not appear after resetting the first-run flags`); continue; }
      await sleep(2800); shot(c, name.split(' ')[0]);
      seen[name] = await web.eval(edgeJs(tid)); clears(name, seen[name]);
      await web.click(Web.tid(tid), { label: `${name} continue/skip (real tap)` }); await sleep(1500);
    }
    await dismissOverlays();
    await openTeam();
    const prof = await web.eval(`(async () => { document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 40) e.scrollTop = 1e6; }); window.scrollTo(0, 1e6);
      await new Promise((r) => setTimeout(r, 600)); const dpr = devicePixelRatio; const H = innerHeight * dpr; let low = 0;
      document.querySelectorAll('button, a, [role=button]').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.bottom * dpr > H * 0.8) low = Math.max(low, r.bottom * dpr); });
      let lastText = 0; document.querySelectorAll('p, span, h1, h2, h3, div').forEach((e) => { if (e.children.length === 0 && (e.textContent || '').trim()) { const r = e.getBoundingClientRect(); if (r.width > 0) lastText = Math.max(lastText, r.bottom * dpr); } });
      const rs = getComputedStyle(document.documentElement);
      return { contentTopPx: 0, contentBottomPx: Math.round(low || lastText), viewportHpx: Math.round(H), safeTopVar: rs.getPropertyValue('--safe-area-inset-top').trim(), safeBottomVar: rs.getPropertyValue('--safe-area-inset-bottom').trim() }; })()`, { timeout: 20_000 });
    shot(c, 'profile-bottom');
    clears('Profile page bottom area', prof, false);
    c.unverified('plot-map action bar: the map screen needs a Google Maps key, which this secretless workflow does not have, so it was not reachable or measured');
  });

  // ---- cold-start safe-area variables + header not double padded
  await check('C17', 'safe-area variables at cold start (timeline) and header position (no double padding)', async (c) => {
    sh(`am force-stop ${PKG}`, { allowFail: true }); await sleep(1200);
    sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true });
    const prevHook = web ? web.beforeTap : null;
    if (web) await web.close();
    web = new Web({ pkg: PKG, log }); const t0 = Date.now(); await web.connect(); const attachMs = Date.now() - t0;
    web.onCalibrateRetry = dismissSystemDialogs; web.beforeTap = prevHook;
    await web.calibrate(); web.statusBarPx = statusBarPx; web.navBarPx = navBarPx; web.screenH = screenSize().h;
    const series = [];
    for (let i = 0; i < 24; i++) {
      series.push(await web.eval(`(() => { const rs = getComputedStyle(document.documentElement); const hdr = document.querySelector('[data-testid="header-setup-hub"]');
        return { t: ${i * 250}, safeTop: rs.getPropertyValue('--safe-area-inset-top').trim(), safeBottom: rs.getPropertyValue('--safe-area-inset-bottom').trim(), headerTop: hdr ? Math.round(hdr.getBoundingClientRect().top * 100) / 100 : null }; })()`).catch(() => ({ t: i * 250, err: true })));
      await sleep(250);
    }
    c.evidence.attachMsAfterLaunch = attachMs; c.evidence.timeline = series;
    const vals = series.filter((x) => !x.err);
    const zeroSeen = vals.some((x) => x.safeTop === '' || x.safeTop === '0px');
    c.evidence.transientZeroOrUnsetSeen = zeroSeen;
    const last = vals[vals.length - 1] || {};
    await dismissOverlays();
    const g = await web.eval(`(() => { const e = document.querySelector('[data-testid="header-setup-hub"]'); const r = e && e.getBoundingClientRect(); const rs = getComputedStyle(document.documentElement); return r ? { top: r.top, dpr: devicePixelRatio, safeTop: rs.getPropertyValue('--safe-area-inset-top').trim() } : null; })()`);
    c.evidence.headerNow = g;
    if (!g) { c.unverified('header not measurable'); return; }
    const api = Number(env('API_LEVEL', 0));
    const baseline = SMALL ? 47.52 : 62.36; // run12 (before any fix) API 36 header top, CSS px
    if (api >= 35) {
      c.assert(Math.abs(g.top - baseline) <= 6, `API ${api}: header top ${Math.round(g.top * 10) / 10}px matches the unpatched value ${baseline}px (no double padding)`,
        `API ${api}: header top is ${Math.round(g.top * 10) / 10}px but was ${baseline}px before the fix: the inset is being applied twice (--safe-area-inset-top='${g.safeTop}')`);
    } else {
      c.assert(parseFloat(g.safeTop) > 0, `API ${api}: --safe-area-inset-top is published (${g.safeTop})`, `API ${api}: --safe-area-inset-top is '${g.safeTop}' (not published)`);
      c.assert(g.top * g.dpr >= statusBarPx - 2, `API ${api}: header top (${Math.round(g.top * g.dpr)}px) is below the status bar (${statusBarPx}px)`, `API ${api}: header is under the status bar`);
    }
    c.evidence.observation = zeroSeen ? 'an early sample showed the variable unset/0 before the app published it (transient flash, see timeline)' : 'no unset/0 sample seen in the timeline (first sample is only possible after DevTools attaches)';
  });

  // ---- Back chain + Voice Diary
  let diaryReachable = null;
  await check('C08', 'hardware Back from Voice Diary / Settings returns through the app and exits only at home', async (c) => {
    calmLauncher();
    await goHome();
    await openSetupHub();
    await web.click(Web.tid('hub-settings-voice-diary'), { label: 'Settings -> Voice Diary row' });
    await web.waitVisible(Web.tid('voice-retained-consent-toggle'), 25_000, 'Settings (voice retention) screen');
    c.pass('Settings screen reached');
    shot(c, 'settings');
    await web.click(Web.tid('voice-retained-open-diary'), { label: 'open Voice Diary' });
    const diaryOk = await web.waitVisible(Web.tid('voice-diary-page'), 25_000, 'Voice Diary page').then(() => true).catch(() => false);
    shot(c, 'voice-diary');
    // C10 recorded as its own check object below, using this observation
    diaryReachable = diaryOk;

    const back = async (label, expectSpec) => {
      await dismissSystemDialogs();
      key(4); // KEYCODE_BACK
      let ok = false; const end = Date.now() + 8000;
      while (Date.now() < end) { if (await web.visible(expectSpec).catch(() => false)) { ok = true; break; } await sleep(400); }
      const fg = appForeground();
      c.evidence[`back_${label}`] = { expectedVisible: ok, appForeground: fg };
      shot(c, `back-${label}`);
      return { ok, fg };
    };
    let r = await back('1-from-diary', Web.tid('voice-retained-consent-toggle'));
    c.assert(r.ok && r.fg, 'Back 1: Voice Diary -> Settings (app stays open)', `Back 1 did not return to Settings (settingsVisible=${r.ok}, appForeground=${r.fg})`);
    r = await back('2-from-settings', Web.tid('hub-settings-voice-diary'));
    c.assert(r.ok && r.fg, 'Back 2: Settings -> Setup Hub (app stays open)', `Back 2 did not return to the Setup Hub (hubVisible=${r.ok}, appForeground=${r.fg})`);
    await dismissSystemDialogs();
    key(4);
    let home = false; const end = Date.now() + 8000;
    while (Date.now() < end) { if (!(await web.visible(Web.tid('hub-settings-voice-diary')).catch(() => true))) { home = true; break; } await sleep(400); }
    c.assert(home && appForeground(), 'Back 3: Setup Hub -> Home (app stays open)', `Back 3 did not leave the Setup Hub or closed the app (home=${home}, fg=${appForeground()})`);
    c.evidence.back3Text = (await web.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    shot(c, 'back-3-home');
    await dismissSystemDialogs();
    key(4); // at Home: exits
    let exited = false; const end2 = Date.now() + 10_000;
    while (Date.now() < end2) { if (!appForeground()) { exited = true; break; } await sleep(500); }
    c.assert(exited, 'Back 4 at Home: the app exits (leaves the foreground) - and only here', 'Back at Home did NOT leave the app');
    c.evidence.afterExit = resumedActivity();
  });

  await check('C10', 'Voice Diary reachable', async (c) => {
    if (diaryReachable === null) { c.unverified('the Back-chain check did not get as far as opening the Voice Diary'); return; }
    c.assert(diaryReachable === true, 'Voice Diary page rendered (voice-diary-page) via Setup Hub -> Settings -> Open diary', 'Voice Diary page did not render');
  });

  // ---- voice capture: first tap -> real OS dialog
  await check('C11', 'first tap on voice capture raises the OS microphone dialog; capture starts after the real Allow tap', async (c) => {
    calmLauncher(); const anrBefore = results.anrDialogs.length;
    await launchCold();
    await dismissOverlays();
    sh(`pm revoke ${PKG} android.permission.RECORD_AUDIO`, { allowFail: true }); // makes the "not yet asked" state explicit
    let rec = (sh(`dumpsys package ${PKG}`, { allowFail: true, timeout: 40_000 }).match(/android\.permission\.RECORD_AUDIO: granted=(\w+)/) || [])[1];
    c.evidence.recordAudioBeforeTap = rec;
    // reach the voice start button
    if (!(await web.visible(Web.tid('input-method-voice')))) {
      const crop = Web.text(/(द्राक्ष|ऊस|Grapes|Sugarcane)/i);
      if (await web.visible(crop)) { await web.click(crop, { label: 'a crop' }); await sleep(1200); }
      if (await web.visible(Web.tid('plot-tray-button'))) { await web.click(Web.tid('plot-tray-button'), { label: 'plot tray' }); await sleep(900); }
    }
    await web.click(Web.tid('input-method-voice'), { label: 'voice input method' }); await sleep(800);
    const start = Web.css('button[aria-label="Start Recording"]');
    c.evidence.scopeTestIds = await web.eval(`Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')).filter((t) => /plot|crop|farm|scope/i.test(t)).slice(0, 40)`);
    const whole = Web.tidPrefix('crop-selector-entire-farm-row');
    if (!(await web.visible(start)) && (await web.visible(whole) || await web.visible(Web.text(/संपूर्ण शेत/)))) {
      // no plots are listed for the demo farm; the app's own scope for that is "whole farm"
      await web.click((await web.visible(whole)) ? whole : Web.text(/संपूर्ण शेत/), { label: 'whole farm' }); await sleep(2500);
      shot(c, 'after-whole-farm');
      c.evidence.afterWholeFarmLabels = await web.eval(`Array.from(document.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label')).slice(0, 20)`);
      if (await web.visible(Web.tid('input-method-voice'))) { await web.click(Web.tid('input-method-voice'), { label: 'voice input method (again)' }); await sleep(800); }
    }
    shot(c, 'voice-ui');
    if (!(await web.visible(start))) {
      c.evidence.voiceButtons = await web.eval(`Array.from(document.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label')).slice(0, 20)`);
      throw new Unreachable('Start Recording button not available: ' + JSON.stringify(c.evidence.voiceButtons));
    }
    await web.click(start, { label: 'Start Recording (first tap)' });
    // look for the real OS dialog
    let dlg = null; const end = Date.now() + 25_000;
    while (Date.now() < end) {
      const nodes = parseNodes(await dumpUi().catch(() => ''));
      dlg = permissionDialog(nodes);
      if (dlg) break;
      if (nodes.some((n) => /isn't responding/i.test(n.text))) await dismissSystemDialogs();
      await sleep(800);
    }
    shot(c, 'after-first-tap');
    if (!dlg && results.anrDialogs.length > anrBefore) { c.unverified(`the OS permission dialog was not observed, but the emulator showed ${results.anrDialogs.length - anrBefore} "isn't responding" dialog(s) during the wait (system overload), so the absence cannot be attributed to the app`); return; }
    c.assert(!!dlg, `OS permission dialog appeared on the first tap ("${dlg?.message ?? ''}")`, 'no OS permission dialog appeared within 25 s of the first tap (no system overload dialogs were seen)');
    if (!dlg) return;
    c.evidence.dialog = { message: dlg.message, texts: dlg.texts };
    if (!dlg.allow) { c.unverified('dialog found but no Allow button node could be located'); return; }
    const recState = () => (sh(`dumpsys package ${PKG}`, { allowFail: true, timeout: 40_000 }).match(/android\.permission\.RECORD_AUDIO: granted=(\w+)/) || [])[1];
    rec = 'false';
    for (let attempt = 1; attempt <= 3 && rec !== 'true'; attempt++) {
      tap(dlg.allow.x, dlg.allow.y); // a real tap on the real dialog (no `pm grant`)
      for (let k = 0; k < 6 && rec !== 'true'; k++) { await sleep(1500); rec = recState(); }
      if (rec !== 'true') { // a busy emulator can swallow the tap: look again and re-tap, never pm grant
        await dismissSystemDialogs();
        const again = permissionDialog(parseNodes(await dumpUi().catch(() => '')));
        c.evidence[`allowAttempt${attempt}`] = again ? 'dialog still shown, retapping' : 'dialog gone but permission not granted';
        if (again?.allow) dlg = again; else break;
      }
    }
    c.evidence.recordAudioAfterAllow = rec;
    c.assert(rec === 'true', 'RECORD_AUDIO became granted through the dialog tap', `RECORD_AUDIO is ${rec} after tapping Allow`);
    // capture should start inside the same tap (no second tap)
    let started = false;
    for (let k = 0; k < 30; k++) { if (await web.visible(Web.css('button[aria-label="Stop Recording"]')).catch(() => false)) { started = true; break; } await sleep(500); }
    shot(c, 'after-allow');
    if (started) {
      c.pass('capture started after Allow without a second tap (Stop Recording is shown)');
      await sleep(2500);
      await web.click(Web.css('button[aria-label="Stop Recording"]'), { label: 'Stop Recording' });
    } else {
      const gum = await web.eval(`(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'ok'; } catch (e) { return String(e && e.name) + ': ' + String(e && e.message).slice(0, 120); } })()`);
      c.evidence.getUserMediaDirect = gum;
      if (gum === 'ok') c.fail('permission is granted and getUserMedia works, but the app did not start capturing after Allow');
      else c.unverified(`capture did not start; a direct getUserMedia call also failed (${gum}) - likely the emulator has no capture device, not an app defect`);
    }
  });

  // ---- local recording playback (real tap), src written once
  await check('C18', 'Play on a LOCAL recording: one real tap starts audio, src written exactly once', async (c) => {
    calmLauncher();
    await launchCold(); await dismissOverlays();
    await openDiaryViaSettings();
    await ensureConsentGranted(c);
    // record a short local clip with the real UI (mic permission was granted in C11)
    await launchCold(); await dismissOverlays();
    if (!(await web.visible(Web.tid('input-method-voice')))) {
      const crop = Web.text(/(द्राक्ष|ऊस|Grapes|Sugarcane)/i);
      if (await web.visible(crop)) { await web.click(crop, { label: 'a crop' }); await sleep(1200); }
    }
    await web.click(Web.tid('input-method-voice'), { label: 'voice input method' }); await sleep(800);
    const startBtn = Web.css('button[aria-label="Start Recording"]');
    if (!(await web.visible(startBtn)) && (await web.visible(Web.tidPrefix('crop-selector-entire-farm-row')))) {
      await web.click(Web.tidPrefix('crop-selector-entire-farm-row'), { label: 'whole farm' }); await sleep(2500);
      if (await web.visible(Web.tid('input-method-voice'))) { await web.click(Web.tid('input-method-voice'), { label: 'voice input method (again)' }); await sleep(800); }
    }
    let running = false;
    for (let attempt = 1; attempt <= 3 && !running; attempt++) {
      await web.click(startBtn, { label: `Start Recording (attempt ${attempt})` });
      const dlg0 = permissionDialog(parseNodes(await dumpUi().catch(() => '')));
      if (dlg0?.allow) { tap(dlg0.allow.x, dlg0.allow.y); await sleep(2000); }
      running = await web.waitVisible(Web.css('button[aria-label="Stop Recording"]'), 12_000).then(() => true).catch(() => false);
      if (!running) {
        c.evidence[`recordAttempt${attempt}`] = { labels: await web.eval(`Array.from(document.querySelectorAll('button[aria-label]')).map((b) => b.getAttribute('aria-label')).slice(0, 12)`).catch(() => null), focus: focusedWindow() };
        shot(c, `record-attempt-${attempt}`);
        if (await web.visible(Web.tid('input-method-voice'))) { await web.click(Web.tid('input-method-voice'), { label: 'voice input method (retry)' }); await sleep(800); }
      }
    }
    if (!running) throw new Unreachable('capture did not start in 2 real-tap attempts (Stop Recording never shown)');
    await sleep(6000);
    for (let st = 1; st <= 4; st++) { // a real tap can be swallowed (animating button, system dialog): tap again until recording has really stopped
      await web.click(Web.css('button[aria-label="Stop Recording"]'), { label: `Stop Recording (tap ${st})` });
      await sleep(2500);
      if (!(await web.visible(Web.css('button[aria-label="Stop Recording"]')).catch(() => false))) break;
    }
    const clipRows = () => web.eval(`(async () => { const dbs = (await indexedDB.databases()).map((d) => d.name).filter((n) => /^AgriLogDB/.test(n)); let n = 0; const sizes = [];
      for (const name of dbs) { const db = await new Promise((r) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); if (!db) continue;
        if (db.objectStoreNames.contains('voiceClips')) { const rows = await new Promise((r) => { const t = db.transaction('voiceClips').objectStore('voiceClips').getAll(); t.onsuccess = () => r(t.result); t.onerror = () => r([]); }); n += rows.length; rows.forEach((x) => sizes.push({ blob: x.localBlob && x.localBlob.size, state: x.archiveState || null })); }
        db.close(); } return { n, sizes }; })()`);
    let rows = { n: 0 };
    for (let k = 0; k < 30 && !rows.n; k++) { await sleep(2000); rows = await clipRows().catch(() => ({ n: 0 })); }
    c.evidence.localClipRowsAfterStop = rows;
    c.evidence.textAfterStop = (await web.text()).replace(/\s+/g, ' ').slice(0, 300);
    shot(c, 'after-stop');
    if (!rows.n) { c.unverified('the app stored no local recording after Stop (see textAfterStop); a playable local clip does not exist in this run'); return; }
    await launchCold(); await dismissOverlays();
    await openDiaryViaSettings();
    await web.eval(`(() => { window.__srcWrites = []; window.__ciSeq = 0; const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      if (d && d.set) Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get: d.get, set(v) { (this.__ciId = this.__ciId || ++window.__ciSeq); window.__srcWrites.push({ elId: this.__ciId, t: Date.now(), via: 'prop', v: String(v).slice(0, 30), stack: String(new Error().stack).split('\\n').slice(2, 6).map((l) => l.trim().slice(0, 90)).join(' < ') }); return d.set.call(this, v); } });
      const sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function (n, v) { if (this instanceof HTMLMediaElement && String(n).toLowerCase() === 'src') (this.__ciId = this.__ciId || ++window.__ciSeq); window.__srcWrites.push({ elId: this.__ciId, t: Date.now(), via: 'attr', v: String(v).slice(0, 30), stack: String(new Error().stack).split('\\n').slice(2, 6).map((l) => l.trim().slice(0, 90)).join(' < ') }); return sa.call(this, n, v); }; })()`);
    await web.click(Web.tid('voice-retained-open-diary'), { label: 'open Voice Diary' });
    await web.waitVisible(Web.tid('voice-diary-page'), 25_000, 'Voice Diary page');
    await sleep(2500);
    const id = await web.eval(`(() => { const e = document.querySelector('[data-testid^="voice-diary-clip-card-"]'); return e ? e.getAttribute('data-testid').slice('voice-diary-clip-card-'.length) : null; })()`);
    if (!id) { c.unverified('no recording card in the Voice Diary after recording a clip with consent on, so playback could not be exercised'); return; }
    c.evidence.clipId = id;
    const sample = () => web.eval(`(() => { const a = document.querySelector('[data-testid="voice-diary-clip-card-${id}"] audio'); return a ? { paused: a.paused, currentTime: a.currentTime, duration: a.duration, ended: a.ended, readyState: a.readyState, hasSrc: !!a.getAttribute('src') || !!a.src, err: a.error ? a.error.code : null } : null; })()`);
    const writesBefore = await web.eval('window.__srcWrites.length');
    c.evidence.before = await sample();
    shot(c, 'diary-clip-before-play');
    const tTap = await web.eval('Date.now()');
    await web.click(Web.tid(`voice-diary-clip-play-${id}`), { label: 'Play (single real tap)' });
    // poll until playback is observed (or 4 s); this is the window the tap is responsible for
    let s1 = null; let s2 = null; let tStarted = null;
    for (let k = 0; k < 16; k++) {
      await sleep(250); const cur = await sample();
      if (!s1) s1 = cur;
      if (cur && (!cur.paused || cur.currentTime > 0 || cur.ended)) { tStarted = await web.eval('Date.now()'); s2 = cur; break; }
    }
    await sleep(700); const s3 = await sample();
    const label = await web.eval(`(document.querySelector('[data-testid="voice-diary-clip-play-${id}"]') || { getAttribute: () => null }).getAttribute('aria-label')`);
    shot(c, 'diary-clip-after-play');
    const writes = await web.eval('window.__srcWrites');
    const tEnd = tStarted ?? await web.eval('Date.now()');
    const selectedElId = await web.eval(`(() => { const a = document.querySelector('[data-testid="voice-diary-clip-card-${id}"] audio'); return a ? (a.__ciId ?? null) : null; })()`);
    const cls = classifySrcWrites(writes, { selectedElId, tTap, tEnd: tEnd + 100 });
    c.evidence.samples = { s1, s2, s3, buttonLabel: label, selectedAudioElementId: selectedElId };
    c.evidence.srcWritesInformational = { note: 'writes on the SELECTED clip element BEFORE the tap (mount / list refresh); other elements ignored', beforeTap: cls.before.map((w) => ({ msBeforeTap: tTap - w.t, via: w.via, blob: w.v, stack: w.stack })), otherElementWrites: cls.otherElementWrites };
    c.evidence.srcWritesInTapWindow = cls.inWindow;
    const started = !!s3 && ((s2 && (!s2.paused || s2.currentTime > 0)) || (!s3.paused && s3.currentTime > 0) || s3.ended);
    const advancing = !!s2 && !!s3 && (s3.currentTime > s2.currentTime || s3.ended);
    c.assert(started, `audio actually started after one real tap (paused=${s3?.paused}, currentTime ${s2?.currentTime ?? s1?.currentTime} -> ${s3?.currentTime}, ended=${s3?.ended})`, `no audio playback after the tap: ${JSON.stringify({ s1, s2, s3 })}`);
    c.assert(advancing || s3?.ended, 'media position advanced after the tap (really playing)', `media position did not advance: ${JSON.stringify({ s2, s3 })}`);
    c.assert(cls.ok, `selected element: ${cls.inWindow.length} src write(s) between the real tap and playback start (never a double write)`, `DOUBLE WRITE on the selected element between tap and playback start: ${JSON.stringify(cls.inWindow)}`);
    c.pass(`informational: the selected element's src was written ${cls.before.length} time(s) before the tap (mount/refresh), see srcWritesInformational`);
    // NEGATIVE CONTROL: deliberately write src twice on THIS element; the same classifier must flag it, or the counter is blind.
    await web.eval(`(() => { const a = document.querySelector('[data-testid="voice-diary-clip-card-${id}"] audio'); a.pause(); window.__ctl0 = Date.now(); const v = a.getAttribute('src'); a.setAttribute('src', v); a.setAttribute('src', v); window.__ctl1 = Date.now(); })()`);
    const w2 = await web.eval('window.__srcWrites'); const t0 = await web.eval('window.__ctl0'); const t1 = await web.eval('window.__ctl1');
    const selId2 = await web.eval(`document.querySelector('[data-testid="voice-diary-clip-card-${id}"] audio').__ciId`);
    const ctl = classifySrcWrites(w2, { selectedElId: selId2, tTap: t0, tEnd: t1 + 50 });
    c.evidence.negativeControl = { injectedWrites: 2, detectedInWindow: ctl.inWindow.length, flaggedAsDoubleWrite: ctl.doubleWrite };
    c.assert(ctl.doubleWrite && !ctl.ok, 'negative control: a deliberately injected double src write on the selected element is flagged (the counter is not blind)', 'negative control FAILED: an injected double src write was NOT flagged - the C18 write counter cannot be trusted');
  });

  // ---- large font (Team page at 1.0 / 1.5 / 2.0, hub + attendance at 1.5 / 2.0)
  await check('C14', 'large font 1.0 / 1.5 / 2.0: Team page (and Labour hub, attendance at 1.5 / 2.0) stay inside the screen', async (c) => {
    const probe = `(() => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px;font-size:16px;line-height:normal;white-space:nowrap'; d.textContent = 'Hgj'; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })()`;
    const metrics = `(() => { const vw = window.innerWidth; const bad = []; document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 2 && getComputedStyle(e).position !== 'fixed') bad.push((e.getAttribute('data-testid') || e.tagName) + ':' + Math.round(r.right)); });
      return { vw, scrollW: document.documentElement.scrollWidth, overflowingElements: bad.slice(0, 8), overflowCount: bad.length }; })()`;
    sh('settings put system font_scale 1.0'); await sleep(1500);
    await launchCold(); await dismissOverlays();
    const base = await web.eval(probe);
    const per = {};
    try {
      for (const scale of ['1.0', '1.5', '2.0']) {
        sh(`settings put system font_scale ${scale}`); await sleep(2500);
        await launchCold(); await dismissOverlays();
        const eff = await web.eval(probe);
        const ratio = Math.round((eff / base) * 100) / 100;
        const rec = { effectiveTextScale: ratio };
        if (scale !== '1.0') {
          await openLabourHub(); rec.hub = await web.eval(metrics); shot(c, `hub-x${scale}`);
          await openAttendance(); rec.attendance = await web.eval(metrics); shot(c, `attendance-x${scale}`);
          const save = await web.info(Web.tid('att-save'), true); rec.saveButtonReachable = !!(save.n && save.inView && !save.covered);
          await goHome();
        }
        await openTeam(); rec.team = await web.eval(metrics); shot(c, `team-x${scale}`);
        per[scale] = rec;
        if (scale !== '1.0' && ratio <= 1.15) { c.unverified(`system font scale ${scale} did NOT change text size inside the WebView (probe ratio ${ratio})`); continue; }
        if (scale !== '1.0') c.pass(`system font scale ${scale} reached the WebView (probe text ${ratio}x taller)`);
        for (const k of scale === '1.0' ? ['team'] : ['hub', 'attendance', 'team']) c.assert(rec[k].scrollW <= rec[k].vw + 2 && rec[k].overflowCount === 0, `${k}: nothing extends past the screen edge at ${scale}x`, `${k}: content extends past the right screen edge at ${scale}x (clipped): ${JSON.stringify(rec[k].overflowingElements)}`);
        if (scale !== '1.0') c.assert(rec.saveButtonReachable, `attendance Save is reachable at ${scale}x`, `attendance Save NOT reachable at ${scale}x`);
      }
    } finally { sh('settings put system font_scale 1.0', { allowFail: true }); }
    c.evidence.perScale = per;
  });

  // ---- offline
  await check('C12', 'genuine airplane mode: cold start offline, mark queues, reconnect pushes once, no duplicates', async (c) => {
    await launchCold(); await dismissOverlays();
    // warm the cache while online
    await openLabourHub(); await openAttendance(); await sleep(2000);
    const id = opId('Sunita Jadhav');
    const marksBefore = marksFor(id); const totalBefore = psqlNum('select count(*) from ssf.attendance_marks');

    airplane(true); await sleep(5000);
    let probeOff = await fetchApiFromPage(5000);
    let radios = false;
    if (probeOff.ok) { sh('svc wifi disable', { allowFail: true }); sh('svc data disable', { allowFail: true }); radios = true; await sleep(4000); probeOff = await fetchApiFromPage(5000); }
    c.evidence.airplane = { settingAirplaneOn: sh('settings get global airplane_mode_on', { allowFail: true }), apiReachableFromPage: probeOff, radiosAlsoDisabled: radios };
    c.assert(!probeOff.ok, `device is offline (airplane mode${radios ? ' + wifi/data radios off' : ''}); the CI API is unreachable from the WebView`, 'API still reachable after airplane mode - not a genuine offline test');
    if (probeOff.ok) { airplane(false); return; }

    await launchCold();
    await sleep(3000);
    const loginShown = await web.visible(Web.text(/Use password/i)).catch(() => false);
    const consentShown = await web.visible(Web.tid('consent-accept-cta')).catch(() => false);
    await dismissOverlays();
    shot(c, 'offline-cold-start');
    c.assert(await web.visible(Web.tid('header-setup-hub')) && !loginShown && !consentShown, 'cold start offline opens the signed-in home (no login, no consent gate)', `offline cold start did not open signed-in home (login=${loginShown}, consent=${consentShown})`);

    await openLabourHub(); await sleep(2000);
    const stale = await web.visible(Web.tid('labour-stale-readout'));
    shot(c, 'offline-hub');
    c.assert(stale, 'stale-data note is shown on the offline hub', 'no stale-data note on the offline hub');
    await openAttendance();
    const txt = await web.text();
    const shown = NAMES_A.filter((n) => txt.includes(n));
    c.evidence.offlineNames = shown;
    c.assert(shown.length === NAMES_A.length, `cached names shown offline (${shown.length}/${NAMES_A.length})`, `only ${shown.length}/${NAMES_A.length} cached names shown offline: ${shown.join(', ')}`);
    const q0 = await web.queue();
    await web.click(Web.tid(`att-day-Full-${id}`), { label: 'Sunita Jadhav Full (offline)' });
    await web.click(Web.tid('att-save'), { label: 'attendance save (offline)' });
    let toast = false; for (let k = 0; k < 24; k++) { if ((await web.text()).includes('लक्षात ठेवलं')) { toast = true; break; } await sleep(300); }
    shot(c, 'offline-after-save');
    const q1 = await web.queue();
    c.evidence.queue = { before: q0, afterMark: q1 };
    c.assert(toast, 'offline save acknowledged on screen', 'no acknowledgement for the offline save');
    c.assert(q1.total === q0.total + 1, `the mark sits in the on-device queue (${q0.total} -> ${q1.total})`, `queue did not grow by 1 (${q0.total} -> ${q1.total})`);
    await sleep(15_000);
    c.assert(marksFor(id) === marksBefore, 'server DB unchanged while offline', 'server DB changed while the device was offline?!');

    // reconnect
    const tBack = Date.now(); const logOffset = apiLogLines().length;
    if (radios) { sh('svc wifi enable', { allowFail: true }); sh('svc data enable', { allowFail: true }); }
    airplane(false);
    let online = false;
    for (let k = 0; k < 60; k++) { await sleep(2000); const p = await fetchApiFromPage(4000).catch(() => ({ ok: false })); if (p.ok) { online = true; break; } }
    c.assert(online, 'connectivity restored (airplane mode off)', 'connectivity did not come back after disabling airplane mode');
    let after = marksFor(id);
    for (let k = 0; k < 60 && after === marksBefore; k++) { await sleep(2000); after = marksFor(id); }
    await sleep(15_000);
    const pushes = web.net.filter((n) => n.method === 'POST' && /\/sync\/push/.test(n.url) && n.t >= tBack);
    const ok200 = pushes.filter((n) => n.status === 200);
    const apiPushes = apiLogLines().slice(logOffset).filter((l) => /POST/.test(l) && /sync\/push/.test(l) && /responded/.test(l));
    c.evidence.reconnect = { rowsBefore: marksBefore, rowsAfter: marksFor(id), webviewPushes: pushes.map((n) => `${n.status ?? n.failed}`), apiLogPushes: apiPushes.length, secondsToRow: Math.round((Date.now() - tBack) / 1000) };
    c.assert(marksFor(id) === marksBefore + 1, `after reconnect the DB has exactly 1 new row for Sunita Jadhav (${marksBefore} -> ${marksFor(id)})`, `DB rows for Sunita Jadhav ${marksBefore} -> ${marksFor(id)} (expected +1)`);
    c.assert(ok200.length === 1, `exactly 1 successful POST /sync/push after reconnect (WebView saw ${pushes.length} push request(s))`, `expected exactly 1 successful push after reconnect, WebView saw ${pushes.length} (${ok200.length} x 200)`);
    if (apiPushes.length) c.assert(apiPushes.length === 1, 'API log agrees: 1 push', `API log shows ${apiPushes.length} pushes after reconnect`);
    else c.unverified('API request log had no push lines to cross-check (log format); WebView and DB evidence stand');
    c.assert(dupPairs() === 0, 'no duplicate (operator, date) attendance rows anywhere', 'duplicate (operator, date) attendance rows exist');
    c.assert(psqlNum('select count(*) from ssf.attendance_marks') === totalBefore + 1, 'total attendance rows grew by exactly 1', 'total attendance rows did not grow by exactly 1');
    const q2 = await web.queue(); c.evidence.queue.afterReconnect = q2;
    await goHome(); await openLabourHub(); await sleep(3000);
    c.assert(!(await web.visible(Web.tid('labour-stale-readout'))), 'stale-data note is gone after reconnect', 'stale-data note still shown after reconnect');
    shot(c, 'after-reconnect-hub');
  });
  airplane(false); sh('svc wifi enable', { allowFail: true }); sh('svc data enable', { allowFail: true });

  await check('C19', 'Voice Diary: offline -> online (airplane toggle) re-reads consent and refreshes the page', async (c) => {
    await launchCold(); await dismissOverlays();
    await openDiaryViaSettings();
    await ensureConsentGranted(c);
    await web.click(Web.tid('voice-retained-open-diary'), { label: 'open Voice Diary' });
    await web.waitVisible(Web.tid('voice-diary-page'), 25_000, 'Voice Diary page');
    await sleep(2500);
    const bannerOnline = await web.visible(DIARY_BANNER);
    const srcText = () => web.eval(`(() => { const e = document.querySelector('[data-testid^="voice-diary-clip-source-"]'); return e ? e.innerText.trim() : null; })()`);
    c.evidence.online = { consentOffBannerVisible: bannerOnline, firstClipSourceBadge: await srcText() };
    shot(c, 'diary-online');

    airplane(true); await sleep(5000);
    let probe = await fetchApiFromPage(5000).catch(() => ({ ok: false }));
    let radios = false;
    if (probe.ok) { sh('svc wifi disable', { allowFail: true }); sh('svc data disable', { allowFail: true }); radios = true; await sleep(4000); probe = await fetchApiFromPage(5000).catch(() => ({ ok: false })); }
    c.assert(!probe.ok, `device offline (airplane mode${radios ? ' + radios' : ''})`, 'still online: not a genuine offline test');
    await launchCold(); await dismissOverlays();
    await openDiaryViaSettings();
    await web.click(Web.tid('voice-retained-open-diary'), { label: 'open Voice Diary (offline)' });
    await web.waitVisible(Web.tid('voice-diary-page'), 25_000, 'Voice Diary page (offline)');
    let bannerOffline = false; for (let k = 0; k < 15 && !bannerOffline; k++) { await sleep(1000); bannerOffline = await web.visible(DIARY_BANNER); }
    c.evidence.offline = { consentOffBannerVisible: bannerOffline, firstClipSourceBadge: await srcText() };
    shot(c, 'diary-offline');

    const tBack = Date.now();
    if (radios) { sh('svc wifi enable', { allowFail: true }); sh('svc data enable', { allowFail: true }); }
    airplane(false);
    let reread = null; let bannerNow = bannerOffline;
    for (let k = 0; k < 45; k++) {
      await sleep(2000);
      reread = web.net.find((n) => n.t >= tBack && n.method === 'GET' && /\/consent\/me/.test(n.url) && n.status === 200) || reread;
      bannerNow = await web.visible(DIARY_BANNER).catch(() => bannerNow);
      if (reread && (!bannerNow || !bannerOffline)) break;
    }
    await sleep(2000);
    shot(c, 'diary-after-reconnect');
    c.evidence.after = { consentReadAfterReconnect: reread ? { url: reread.url.replace(/\?.*/, ''), status: reread.status, secondsAfter: Math.round((reread.t - tBack) / 1000) } : null, consentOffBannerVisible: bannerNow, firstClipSourceBadge: await srcText() };
    c.assert(!!reread, 'after reconnect the open Voice Diary re-read the consent (GET /consent/me 200 seen from the WebView)', 'no consent re-read after reconnect: the page kept its offline state');
    if (bannerOffline) c.assert(!bannerNow, 'the stale consent-off banner shown while offline cleared after reconnect', 'the consent-off banner is STILL shown after reconnect although the server has consent on');
    else c.unverified('offline state did not show the consent-off banner, so a stale-state refresh was not exercised (the re-read itself was checked above)');
  });

  await check('C22', 'Voice Diary badge reaching "saved" after reconnect (needs a real S3/KMS persist)', async (c) => {
    c.unverified('NOT COVERED on the emulator: reaching the saved status needs the real S3 bucket and KMS key (tenant DEK), which this secretless CI does not have. C19 covers the consent re-read and page refresh only.');
  });

  await check('C20', 'Cloud-recovered (server-only) recording: first tap plays', async (c) => {
    c.unverified('NOT COVERED on the emulator: a recording that only the server holds needs the real S3 bucket and KMS key, which this secretless CI has none of. Browser real-chain proof exists (RECOVERY_TEST_RUN3); nothing here fakes it.');
  });

  await check('C21', 'keyboard up: --safe-area-inset-bottom stays gesture-bar sized (not keyboard sized)', async (c) => {
    await launchCold();
    const safe = () => web.eval(`(() => { const rs = getComputedStyle(document.documentElement); const el = document.activeElement; const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return { safeBottom: rs.getPropertyValue('--safe-area-inset-bottom').trim(), safeTop: rs.getPropertyValue('--safe-area-inset-top').trim(), innerHeight, dpr: devicePixelRatio, visualViewportH: window.visualViewport ? window.visualViewport.height : null, focusedBottom: r ? r.bottom : null }; })()`);
    let usingProbe = !appRenders;
    if (!usingProbe) {
      try {
        await dismissOverlays(); await openLabourHub(); await openAttendance();
        await web.click(Web.tid('att-add-open'), { label: 'add person' }); await sleep(800);
        c.evidence.keyboardDown = await safe();
        await web.click(Web.tid('att-new-name'), { label: 'new name field (real tap raises the keyboard)' });
      } catch (e) { if (e instanceof NavFail) throw e; usingProbe = true; }
    }
    if (usingProbe) {
      // app UI not usable: a plain probe input on the page still exercises the native inset rule (MainActivity), labelled as such
      c.evidence.method = 'PROBE INPUT injected into the page (the app UI is not usable on this WebView)';
      await web.eval(`(() => { const i = document.createElement('input'); i.id = '__ci_probe'; i.type = 'text'; i.style.cssText = 'position:fixed;left:10%;top:35%;width:80%;height:56px;z-index:2147483647;font-size:20px;background:#fff;border:2px solid #333'; document.body.appendChild(i); })()`);
      c.evidence.keyboardDown = await safe();
      await web.click(Web.css('#__ci_probe'), { label: 'probe input (real tap raises the keyboard)' });
    }
    let ime = false; for (let k = 0; k < 14; k++) { await sleep(500); if (imeShown()) { ime = true; break; } }
    await sleep(1500);
    const kb = await safe(); c.evidence.keyboardUp = kb; shot(c, 'keyboard-up');
    if (!ime) { c.unverified('the soft keyboard did not appear, so the inset under the keyboard was not measured'); return; }
    const px = parseFloat(kb.safeBottom || '0') * kb.dpr;
    c.evidence.safeBottomPxWithKeyboard = Math.round(px);
    if (kb.safeBottom === '') { c.unverified(`--safe-area-inset-bottom is unset on this device (API ${env('API_LEVEL')}); the keyboard rule cannot be read`); }
    else c.assert(px <= navBarPx + 4, `with the keyboard up --safe-area-inset-bottom is ${kb.safeBottom} (${Math.round(px)}px), not keyboard sized (gesture bar ${navBarPx}px)`,
      `with the keyboard up --safe-area-inset-bottom is ${kb.safeBottom} (${Math.round(px)}px): larger than the gesture bar (${navBarPx}px), likely keyboard sized -> oversized bottom gap`);
    if (kb.focusedBottom != null) c.evidence.gapBelowFocusedFieldPx = Math.round((kb.innerHeight - kb.focusedBottom) * kb.dpr);
    key(4); await sleep(500);
  });

  await check('C13', 'logout and user separation A -> B -> A (with the Worker as a role check)', async (c) => {
    const haystackNamesA = NAMES_A.map((n) => n.toLowerCase());
    await launchCold(); await dismissOverlays();
    await logoutUi(); shot(c, 'A-logged-out');
    c.pass('owner A logged out to the login screen');

    // Worker Raju
    let res = await loginUi(PHONES.worker);
    c.assert(res.ok, 'worker Raju logged in', `worker login failed: ${res.alertText}`);
    let workerTile = null;
    try {
      const mode = await openLabourHub({ lenient: true });
      workerTile = await web.visible(Web.text(/^\s*हजेरी घ्या\s*$/));
      shot(c, 'worker-hub');
      c06.evidence.workerHub = { mode, text: (await web.text()).replace(/\s+/g, ' ').slice(0, 400) };
      c06.assert(!workerTile, 'un-granted Worker (Raju) does NOT see the manual attendance tile', 'un-granted Worker (Raju) SEES the manual attendance tile');
    } catch (e) { shot(c, 'worker-hub-unreachable'); c06.evidence.workerVisibleTestIds = await web.eval(`Array.from(document.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid')).slice(0, 40)`).catch(() => null); c06.evidence.workerHubText = (await web.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500); c06.unverified('could not open the Labour hub as the Worker: ' + String(e.message).slice(0, 200)); }
    writeResults();
    await goHome(); await logoutUi();

    // Farm B owner
    res = await loginUi(PHONES.ownerB);
    c.assert(res.ok, 'farm-B owner logged in', `farm-B login failed: ${res.alertText}`);
    await goHome();
    try { await openLabourHub(); await openAttendance(); } catch (e) { c.unverified('B attendance roster not reachable: ' + String(e.message).slice(0, 160)); }
    shot(c, 'B-attendance');
    const bText = (await web.text()).toLowerCase();
    const bHay = await web.storageHaystack();
    c.assert(!haystackNamesA.some((n) => bText.includes(n)), 'B screen shows none of farm A names', 'B screen shows farm A names');
    c.assert(!haystackNamesA.some((n) => bHay.includes(n)), 'B device storage (localStorage + IndexedDB) holds none of farm A names', `B device storage still holds farm A names: ${haystackNamesA.filter((n) => bHay.includes(n)).join(', ')}`);
    c.assert(bText.includes('baburao-b') || bHay.includes('baburao-b'), "B sees B's own person (Baburao-B)", "B does not see B's own person (Baburao-B)");
    await goHome(); await logoutUi();

    // Back to A
    res = await loginUi(PHONES.owner);
    c.assert(res.ok, 'owner A logged in again', `A re-login failed: ${res.alertText}`);
    await goHome();
    await openLabourHub(); await openAttendance();
    shot(c, 'A-attendance-again');
    const aText = (await web.text()).toLowerCase();
    const aHay = await web.storageHaystack();
    c.assert(haystackNamesA.every((n) => aText.includes(n)), 'A sees all of farm A names again', 'A is missing farm A names after the round trip');
    c.assert(!aText.includes('baburao-b'), 'A screen shows nothing of farm B', 'A screen shows farm B data');
    c.assert(!aHay.includes('baburao-b'), 'A device storage holds nothing of farm B', 'A device storage still holds farm B data');
    c.evidence.dbMarksToday = psql("select count(*) from ssf.attendance_marks");
  });

  // wrap-up
  try {
    const lc = adb(['logcat', '-d', '-t', '4000'], { allowFail: true, timeout: 60_000 });
    const keep = lc.split('\n').filter((l) => /FATAL EXCEPTION|ANR in|AndroidRuntime|chromium.*(CONSOLE|ERROR)|Capacitor|ShramSafal|internaltest/i.test(l)).slice(-400).join('\n');
    fs.writeFileSync(path.join(OUT, `${LEG}-logcat-filtered.txt`), keep);
    results.logcatFatal = /FATAL EXCEPTION|ANR in/.test(lc);
  } catch { /* best effort */ }
  results.finishedAt = new Date().toISOString();
  results.totals = counts(checks);
  writeResults();
  log('DONE', JSON.stringify(results.totals));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('DRIVER FATAL', e);
  if (e instanceof DeviceDead) { try { fs.writeFileSync(path.join(OUT, 'device-died'), String(e.message)); } catch { /* ignore */ } }
  results.fatal = String(e.stack || e).slice(0, 1500);
  results.finishedAt = new Date().toISOString();
  results.totals = counts(checks);
  try { writeResults(); } catch { /* ignore */ }
  process.exit(2);
});
