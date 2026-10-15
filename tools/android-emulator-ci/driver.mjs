// Android emulator evidence driver. INTERNAL TEST tooling.
// Runs against: the internal-test debug APK, installed on an Android emulator, talking to a CI-hosted
// test API + Postgres. Every check records PASS / FAIL / UNVERIFIED with evidence.
//   PASS        the assertion was made on observed state and held
//   FAIL        the assertion was made on observed state and did NOT hold (an app finding)
//   UNVERIFIED  the harness could not reach the state needed to assert (never a hidden pass)
import fs from 'node:fs';
import path from 'node:path';
import { Check, BANNER, counts, legMarkdown } from './lib/results.mjs';
import { adb, sh, sleep, screencap, dumpUi, parseNodes, permissionDialog, key, imeShown, focusedWindow, resumedActivity, tap } from './lib/adb.mjs';
import { Web, Unreachable } from './lib/web.mjs';
import { psql, psqlNum } from './lib/db.mjs';

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
  leg: { name: LEG, apiLevel: Number(env('API_LEVEL', 0)), screen: env('SCREEN', 'normal'), target: env('EMU_TARGET', 'google_apis'), arch: 'x86_64' },
  app: {}, env: {}, inputMode: '', startedAt: new Date().toISOString(), checks: [],
};
const checks = results.checks;
const writeResults = () => {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), legMarkdown(results) + '\n');
};

let web = null;
let shotN = 0;
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

async function check(id, title, fn) {
  const c = new Check(id, title);
  checks.push(c);
  log(`--- ${id} ${title}`);
  try { await fn(c); } catch (e) {
    if (e instanceof Unreachable) c.unverified(`the UI state needed was not reachable: ${e.message}`);
    else c.unverified(`harness error: ${String(e.stack || e.message).slice(0, 500)}`);
  }
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

function hideIme() { if (imeShown()) key(4); }

async function launchCold({ attach = true } = {}) {
  if (web) { await web.close(); }
  sh(`am force-stop ${PKG}`, { allowFail: true }); await sleep(1500);
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true });
  if (!attach) return null;
  web = new Web({ pkg: PKG, log });
  await web.connect();
  await web.calibrate();
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
  for (let k = 0; k < 10; k++) {
    const i = await web.info(Web.tid('header-setup-hub')).catch(() => ({ n: 0 }));
    if (i.n && !i.covered) return true;
    let clicked = false;
    for (const spec of [Web.tid('welcome-continue'), Web.tid('onboarding-skip'),
      Web.text(/चला, सुरुवात करूया/), Web.text(/समजलं, पुढे चला/), Web.text(/^\s*पुढे चला\s*$/), Web.text(/^\s*नंतर\s*$/), Web.text(/^\s*Skip\s*$/i)]) {
      if (await web.visible(spec).catch(() => false)) { try { await web.click(spec, { timeout: 4000 }); clicked = true; break; } catch { /* next */ } }
    }
    await sleep(clicked ? 1500 : 1000);
  }
  return false;
}

async function loginUi(phone) {
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
    if (await web.visible(Web.tid('header-setup-hub')).catch(() => false)) return { ok: true, diag };
    for (const spec of [Web.tid('welcome-continue'), Web.tid('onboarding-skip')]) {
      if (await web.visible(spec).catch(() => false)) { try { await web.click(spec, { timeout: 4000 }); } catch { /* retry */ } }
    }
    const a = await web.info(Web.css('[role=alert]')).catch(() => ({ n: 0 }));
    if (a.n) alertText = a.text;
    await sleep(800);
  }
  d('requests after submit: ' + JSON.stringify(web.net.slice(before).map((n) => `${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 50)} ${n.status ?? n.failed ?? '-'}`)).slice(0, 500));
  shot(null, 'login-failed');
  return { ok: false, alertText, diag };
}

async function openSetupHub() {
  await dismissOverlays();
  await web.click(Web.tid('header-setup-hub'), { label: 'header setup hub' }); await sleep(1200);
}
const HUB_MARKERS = [Web.tid('labour-stat-grid'), Web.tid('labour-window-slider'), Web.tid('labour-review-strip'), Web.text(/हजेरी घ्या/), Web.tid('hub-invite-qr')];
async function hubLoaded(timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const m of HUB_MARKERS) if (await web.visible(m).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}
async function openLabourHub() {
  await openSetupHub();
  await web.click(Web.text(/^\s*कामाचा हिशोब\s*$/), { label: 'Labour hub row (कामाचा हिशोब)' });
  if (!(await hubLoaded())) throw new Unreachable('Labour hub did not show any known marker within 30 s');
  await sleep(1500);
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
    await web.waitVisible(Web.tid('consent-accept-cta'), 60_000, 'consent screen on a fresh install');
    await sleep(8000);
    shot(c, 'consent-screen');
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
    const bad = web.net.filter((n) => /\/shramsafal\//.test(n.url) && (n.failed || (n.status && n.status >= 500)));
    c.assert(bad.length === 0, 'no failed or 5xx API calls', `failing calls: ${JSON.stringify(bad.slice(0, 4).map((b) => `${b.method} ${b.url} ${b.status ?? b.failed}`))}`);
  });

  const c06 = await check('C06', 'manual attendance tile: present for owner, absent for un-granted Worker', async (c) => {
    if (!hubOk) await openLabourHub();
    const tile = await web.visible(Web.text(/^\s*हजेरी घ्या\s*$/));
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
      c.assert(/[?&]join=/.test(url) && /[?&]farm=/.test(url), 'link carries join token and farm code', 'link lacks join= or farm=');
      c.assert(!/localhost|10\.0\.2\.2|127\.0\.0\.1/.test(url), 'no local origin leaked into the link', 'a local origin leaked into the link');
    }
  });

  // ---- Back chain + Voice Diary
  let diaryReachable = null;
  await check('C08', 'hardware Back from Voice Diary / Settings returns through the app and exits only at home', async (c) => {
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
    key(4);
    let home = false; const end = Date.now() + 8000;
    while (Date.now() < end) { if (!(await web.visible(Web.tid('hub-settings-voice-diary')).catch(() => true))) { home = true; break; } await sleep(400); }
    c.assert(home && appForeground(), 'Back 3: Setup Hub -> Home (app stays open)', `Back 3 did not leave the Setup Hub or closed the app (home=${home}, fg=${appForeground()})`);
    c.evidence.back3Text = (await web.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    shot(c, 'back-3-home');
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
    shot(c, 'voice-ui');
    const start = Web.css('button[aria-label="Start Recording"]');
    if (!(await web.visible(start))) {
      c.evidence.voiceButtons = await web.eval(`Array.from(document.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label')).slice(0, 20)`);
      throw new Unreachable('Start Recording button not available (plot may need selecting): ' + JSON.stringify(c.evidence.voiceButtons));
    }
    await web.click(start, { label: 'Start Recording (first tap)' });
    // look for the real OS dialog
    let dlg = null; const end = Date.now() + 25_000;
    while (Date.now() < end) {
      const nodes = parseNodes(await dumpUi().catch(() => ''));
      dlg = permissionDialog(nodes);
      if (dlg) break;
      await sleep(800);
    }
    shot(c, 'after-first-tap');
    c.assert(!!dlg, `OS permission dialog appeared on the first tap ("${dlg?.message ?? ''}")`, 'no OS permission dialog appeared within 25 s of the first tap');
    if (!dlg) return;
    c.evidence.dialog = { message: dlg.message, texts: dlg.texts };
    if (!dlg.allow) { c.unverified('dialog found but no Allow button node could be located'); return; }
    tap(dlg.allow.x, dlg.allow.y); // a real tap on the real dialog (no `pm grant`)
    await sleep(1500);
    rec = (sh(`dumpsys package ${PKG}`, { allowFail: true, timeout: 40_000 }).match(/android\.permission\.RECORD_AUDIO: granted=(\w+)/) || [])[1];
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

  // ---- large font
  await check('C14', 'large font (1.5, 2.0): Labour / Team / attendance stay usable (screenshots + overflow metrics)', async (c) => {
    const probe = `(() => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px;font-size:16px;line-height:normal;white-space:nowrap'; d.textContent = 'Hgj'; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })()`;
    const metrics = `(() => { const vw = window.innerWidth; const bad = []; document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 2 && getComputedStyle(e).position !== 'fixed') bad.push((e.getAttribute('data-testid') || e.tagName) + ':' + Math.round(r.right)); });
      return { vw, scrollW: document.documentElement.scrollWidth, overflowingElements: bad.slice(0, 8), overflowCount: bad.length }; })()`;
    await launchCold(); await dismissOverlays();
    const base = await web.eval(probe);
    const per = {};
    try {
      for (const scale of ['1.5', '2.0']) {
        sh(`settings put system font_scale ${scale}`); await sleep(2500);
        await launchCold(); await dismissOverlays();
        const eff = await web.eval(probe);
        const ratio = Math.round((eff / base) * 100) / 100;
        const rec = { effectiveTextScale: ratio };
        await openLabourHub(); rec.hub = await web.eval(metrics); shot(c, `hub-x${scale}`);
        await openAttendance(); rec.attendance = await web.eval(metrics); shot(c, `attendance-x${scale}`);
        const save = await web.info(Web.tid('att-save'), true); rec.saveButtonReachable = !!(save.n && save.inView && !save.covered);
        await goHome(); await openTeam(); rec.team = await web.eval(metrics); shot(c, `team-x${scale}`);
        per[scale] = rec;
        if (ratio <= 1.15) c.unverified(`system font scale ${scale} did NOT change text size inside the WebView (probe ratio ${ratio}): the app ignores the Android font-size setting, so large-font layout is not exercised (screenshots show the unscaled layout)`);
        else {
          c.pass(`system font scale ${scale} reached the WebView (probe text ${ratio}x taller)`);
          for (const k of ['hub', 'attendance', 'team']) c.assert(rec[k].scrollW <= rec[k].vw + 2, `${k} has no horizontal page overflow at ${scale}x`, `${k} overflows horizontally at ${scale}x: ${JSON.stringify(rec[k])}`);
          c.assert(rec.saveButtonReachable, `attendance Save is reachable at ${scale}x`, `attendance Save NOT reachable at ${scale}x`);
        }
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

  // ---- logout and user separation A -> Worker -> B -> A
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
      await openLabourHub();
      workerTile = await web.visible(Web.text(/^\s*हजेरी घ्या\s*$/));
      shot(c, 'worker-hub');
      c06.assert(!workerTile, 'un-granted Worker (Raju) does NOT see the manual attendance tile', 'un-granted Worker (Raju) SEES the manual attendance tile');
    } catch (e) { c06.unverified('could not open the Labour hub as the Worker: ' + String(e.message).slice(0, 200)); }
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
  results.fatal = String(e.stack || e).slice(0, 1500);
  results.finishedAt = new Date().toISOString();
  results.totals = counts(checks);
  try { writeResults(); } catch { /* ignore */ }
  process.exit(2);
});
