// Check recorder + report builders. Pure functions (unit-tested in test/results.test.mjs).
export const BANNER = 'Android emulator, internal test build, CI-hosted test backend; NOT the production APK, NOT a physical device.';

const RANK = { PASS: 0, UNVERIFIED: 1, FAIL: 2 };

export class Check {
  constructor(id, title) {
    this.id = id; this.title = title; this.points = []; this.evidence = {}; this.screens = [];
  }
  pass(msg) { this.points.push({ s: 'PASS', m: msg }); return this; }
  fail(msg) { this.points.push({ s: 'FAIL', m: msg }); return this; }
  unverified(msg) { this.points.push({ s: 'UNVERIFIED', m: msg }); return this; }
  assert(cond, okMsg, badMsg) { return cond ? this.pass(okMsg) : this.fail(badMsg); }
  /** Worst point wins; a check that asserted nothing is UNVERIFIED, never PASS. */
  get status() {
    if (!this.points.length) return 'UNVERIFIED';
    return this.points.reduce((w, p) => (RANK[p.s] > RANK[w] ? p.s : w), 'PASS');
  }
  toJSON() { return { id: this.id, title: this.title, status: this.status, points: this.points, evidence: this.evidence, screens: this.screens }; }
}

export function counts(checks) {
  const c = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
  for (const k of checks) c[k.status] += 1;
  return c;
}

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function legMarkdown(r) {
  const c = counts(r.checks);
  const out = [];
  out.push(`### ${r.leg.name}`);
  out.push(`_${BANNER}_`);
  out.push('');
  out.push(`API level ${r.leg.apiLevel}, screen profile ${r.leg.screen}, app ${r.app?.applicationId ?? '?'} ${r.app?.versionName ?? '?'}. PASS ${c.PASS}, FAIL ${c.FAIL}, UNVERIFIED ${c.UNVERIFIED}.`);
  out.push('');
  out.push('| Check | Result | Detail |');
  out.push('|---|---|---|');
  for (const k of r.checks) {
    const detail = k.points.map((p) => `${p.s}: ${p.m}`).join(' / ');
    out.push(`| ${esc(k.id)} ${esc(k.title)} | ${k.status} | ${esc(detail).slice(0, 700)} |`);
  }
  return out.join('\n');
}

/** Matrix of check id x leg. */
export function matrixMarkdown(legs) {
  const ids = [];
  for (const l of legs) for (const k of l.checks) if (!ids.find((x) => x.id === k.id)) ids.push({ id: k.id, title: k.title });
  const out = ['# Android emulator evidence matrix', '', `_${BANNER}_`, ''];
  out.push(`| Check | ${legs.map((l) => l.leg.name).join(' | ')} |`);
  out.push(`|---|${legs.map(() => '---').join('|')}|`);
  for (const { id, title } of ids) {
    const cells = legs.map((l) => (l.checks.find((k) => k.id === id) || { status: 'n/a' }).status);
    out.push(`| ${esc(id)} ${esc(title)} | ${cells.join(' | ')} |`);
  }
  out.push('');
  for (const l of legs) { out.push(legMarkdown(l)); out.push(''); }
  return out.join('\n');
}

export function totalFailures(legs) {
  return legs.reduce((n, l) => n + counts(l.checks).FAIL, 0);
}
