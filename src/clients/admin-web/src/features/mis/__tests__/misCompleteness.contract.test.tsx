import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyMis, MisNumber } from '@/hooks/useCompanyMis';
import { MIS_ITEMS, MIS_SLOTS, SERVED_FIELDS, itemByKey, itemsOf, type MisSectionKey } from '@/features/mis/misItems';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import { fmtCompact, fmtDec, fmtInt, fmtMs, fmtPctPoints } from '@/features/mis/misFormat';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { allNotMeasuredFixture, at, farmsBlockedFixture, misEnvelope, misFixture } from '@/test/misFixture';
import { PLAN_ITEMS, PRINTS_SERVED_NUMBERS, planItem } from '@/test/misPlan';
import { MIS_NOW, MIS_SECTIONS, countedShown, renderMis, serveMis } from '@/test/misPage';
import linesRaw from '@/__tests__/fixtures/b24-metric-lines.json?raw';

/**
 * B25 ruling (b): the item's own `what`/`why` lines are fixed copy from the reviewed lines file
 * (like the plan-worded definitions below). Only those exact strings of the item being checked
 * are exempt; any other digit in the item is still a stray.
 */
const LINES = new Map((JSON.parse(linesRaw) as { key: string; what?: string; why?: string }[]).map((e) => [e.key, e]));
function withoutOwnLines(text: string, key: string): string {
  const e = LINES.get(key);
  let out = text;
  for (const line of [e?.what, e?.why]) if (line) out = out.split(line).join('');
  return out;
}

/**
 * CR-2b Task 4 — every tile and card is a registered item, and every digit
 * printed inside one comes from the answer (Review Focus 1).
 *
 * "Comes from the answer" is checked per item: a digit inside an item may only
 * be a formatted value of a field the PLAN gives that item (`src/test/misPlan.ts`),
 * a derivation the plan states (new farms, deltas, B8 shares, B9 funnel lines,
 * funnel shares of sign-ups, the busiest hour), a date of the ranges, an hour
 * or day-of-curve axis label, a round axis tick inside a chart, or a label
 * phrase the plan itself words with a digit ("Silent 7–29 days", "Day 30").
 */

let stub: StubbedAdapter | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIS_NOW);
  resetMisPeriod();
});
afterEach(() => {
  stub?.restore();
  stub = null;
  vi.useRealTimers();
});

const D: CompanyMis = misFixture();
const BLOCKED_LIST = farmsBlockedFixture('farm_list_unreadable');
const BLOCKED_CEILING = farmsBlockedFixture('too_many_farms_for_live_count');
const SLOT_PARENT = new Map(MIS_SLOTS.map((s) => [s.key, s.parent]));
const ALL_KEYS = new Set([...MIS_ITEMS.map((i) => i.key), ...MIS_SLOTS.map((s) => s.key)]);

function nOf(key: string): number {
  const parent = SLOT_PARENT.get(key);
  return itemByKey(parent ?? key).n;
}

async function open(section: MisSectionKey, answer: CompanyMis = D) {
  stub = serveMis(async () => ({ status: 200, data: misEnvelope(answer) }));
  const v = renderMis(section);
  await countedShown();
  return v;
}

function closeAll() {
  cleanup();
  stub?.restore();
  stub = null;
  resetMisPeriod();
}

/* ── what a digit may be ─────────────────────────────────────────────── */

function numbersIn(x: unknown, out: number[] = []): number[] {
  if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => numbersIn(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => numbersIn(y, out));
  return out;
}

function variants(v: number): string[] {
  const a = Math.abs(v);
  return [
    fmtInt(v), fmtDec(v, 1), fmtDec(v, 0), fmtDec(v, 2), fmtPctPoints(v), fmtMs(v), fmtCompact(v),
    String(v), v.toFixed(1), fmtInt(a), fmtDec(a, 1), fmtDec(a, 0),
  ];
}

/** The change against the period before, as the plan states it: relative for counts, points for shares. */
function deltaTokens(n: MisNumber): number[] {
  const c = n.current.value;
  const p = n.previous.value;
  if (c === null || p === null) return [];
  const out = [Math.abs(c - p)];
  if (p !== 0) out.push(Math.abs((c - p) / p) * 100);
  return out;
}

const share1 = (x: number, total: number) => Math.round((x / total) * 1000) / 10;
const val = (n: MisNumber) => n.current.value;

/** Plan-stated derivations, per item number, from whichever answer is on screen. Null-safe. */
function derivations(d: CompanyMis, n: number): number[] {
  const a = d.acquisition;
  const [verified, hasFarm, firstLog, habit, eligible] = [a.verified, a.hasFarm, a.firstLog, a.habit, a.habitEligible].map(val);
  const out: number[] = [];
  switch (n) {
    case 1: { // hero: new farms = registered now - registered before the range
      const r = d.farms.farmsRegistered;
      if (r.current.value !== null && r.previous.value !== null) out.push(r.current.value - r.previous.value);
      return out;
    }
    case 16: case 17: case 18: case 19: case 25: // funnel: shares of sign-ups, habit of eligible, B9 lines
      if (verified) {
        if (hasFarm !== null) out.push((hasFarm / verified) * 100, Math.round(((verified - hasFarm) / verified) * 100));
        if (firstLog !== null) out.push((firstLog / verified) * 100);
        out.push(100);
      }
      if (hasFarm && firstLog !== null) out.push(Math.round(((hasFarm - firstLog) / hasFarm) * 100));
      if (habit !== null && eligible) out.push((habit / eligible) * 100);
      for (const x of [verified, hasFarm, firstLog, habit, eligible]) if (x !== null) out.push(x);
      for (const x of [a.verified, a.hasFarm, a.firstLog, a.habit]) out.push(...deltaTokens(x));
      return out;
    case 30: { // B8 role shares
      const total = d.engagement.roleMixOfMau.reduce((s, r) => s + r.people, 0);
      return total > 0 ? d.engagement.roleMixOfMau.map((r) => share1(r.people, total)) : [];
    }
    case 37: { // V4: the colour scale's top = the largest served cell rounded up to the next 10
      const cells = d.retention.cohortByWeek.flatMap((r) => r.activePctOnDays).filter((x): x is number => x !== null);
      return cells.length ? [Math.ceil(Math.max(...cells) / 10) * 10] : [];
    }
    case 39: { // B8 band shares
      const r = d.retention;
      const bands = [r.activeFarms0To6, r.quietFarms7To13, r.quietFarms14To29, r.silentFarms30Plus, r.neverLoggedFarms].map(val);
      if (bands.some((b) => b === null)) return [];
      const total = (bands as number[]).reduce((s, x) => s + x, 0);
      return total > 0 ? (bands as number[]).map((b) => share1(b, total)) : [];
    }
    default:
      return out;
  }
}

const tokenCache = new WeakMap<CompanyMis, Map<number, string[]>>();
function tokensFor(d: CompanyMis, n: number): string[] {
  let byN = tokenCache.get(d);
  if (!byN) { byN = new Map(); tokenCache.set(d, byN); }
  const hit = byN.get(n);
  if (hit) return hit;
  const nums: number[] = [];
  for (const f of planItem(n).fields) {
    const value = at(d, f);
    numbersIn(value, nums);
    if (value && typeof value === 'object' && 'current' in (value as object)) nums.push(...deltaTokens(value as MisNumber));
  }
  nums.push(...derivations(d, n));
  const set = new Set<string>();
  for (const v of nums) for (const t of variants(v)) if (/\d/.test(t)) set.add(t);
  const list = [...set].sort((x, y) => y.length - x.length);
  byN.set(n, list);
  return list;
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const MONTH_INDEX = Object.fromEntries(MONTHS.split('|').map((m, i) => [m, i]));
const FIRST_DAY = Date.UTC(2026, 8, 10); // a week before the previous range, for week starts
const LAST_DAY = Date.UTC(2026, 10, 15);

function stripDates(text: string): string {
  return text
    .replace(new RegExp(`\\b(\\d{1,2})( ?[–-] ?(\\d{1,2}))? (${MONTHS})(,? (\\d{4}))?\\b`, 'g'), (whole, d1, _r, d2, mon, _y, year) => {
      const y = year ? Number(year) : 2026;
      const ok = [d1, d2].filter(Boolean).every((d) => {
        const ms = Date.UTC(y, MONTH_INDEX[mon], Number(d));
        return ms >= FIRST_DAY && ms <= LAST_DAY;
      });
      return ok ? '' : whole;
    })
    .replace(/\b20\d\d-\d\d-\d\d\b/g, (iso) => {
      const ms = Date.parse(`${iso}T00:00:00Z`);
      return ms >= FIRST_DAY && ms <= LAST_DAY ? '' : iso;
    });
}

/** Label phrases the plan itself words with a digit. */
const PLAN_PHRASES: RegExp[] = [
  /\bday 1, 7, 14 and 30\b/gi, // B4: the cohort grid's four days (before the shorter "day 1")
  /\b7[–-]29 days\b/g, /\b7[–-]13 days\b/g, /\b14[–-]29 days\b/g, /\b30 days or more\b/g, /\b30\+ days\b/g,
  /\blast 7 days\b/gi, /\blast 30 days\b/gi, /\bin the 7 days\b/g, /\b3 of (their )?first 7 days\b/g, /\bslowest 5%/gi,
  /\bmore than 500 farms\b/g, /\bon day 30\b/gi, /\bDay (1|7|14|30)\b/g, /\bday 1\b/gi,
  /\bDay-(1|30)\b/gi, // items 33, 34: next-day and day-30 return
  /\b95th percentile\b/g, // item 45 = CR-2a rule 30, nearest-rank 95th percentile
  /\btrailing 7 days\b/g, // item 61 = CR-2a rule 38, farms active at d (the 7 days to d)
  /\b7 days in\b/g, // B14 and the funnel subtitle: old enough to judge the habit
];

function stripAxis(text: string): string {
  return text
    .replace(/\b(1[0-2]|[1-9]):[0-5]\d (am|pm)\b/gi, '') // the counted-at time
    .replace(/\b(1[0-2]|[1-9]) ?(am|pm)\b/gi, '') // hour labels and the busiest hour
    .replace(/\bDay ([0-9]|[12][0-9]|30)\b/g, ''); // return-curve day axis
}

function stripTokens(text: string, tokens: string[]): string {
  let t = text;
  for (const tok of tokens) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`, 'g'), '');
  }
  return t;
}

/**
 * A NAMED axis element: a chart's y-axis tick label, i.e. an SVG <text> drawn
 * beside its own gridline (<g><line/><text text-anchor="end"/></g>). Exempt by
 * what the element is, never by how short its number is (review V2).
 */
function isAxisTick(el: Element): boolean {
  if (el.tagName.toLowerCase() !== 'text' || el.closest('svg') === null) return false;
  const g = el.parentElement;
  return g !== null && g.tagName.toLowerCase() === 'g'
    && g.querySelector(':scope > line') !== null
    && el.getAttribute('text-anchor') === 'end';
}

interface Stray { section: string; item: string; text: string; left: string }

function strayDigits(d: CompanyMis | null, section: string, root: HTMLElement): Stray[] {
  const out: Stray[] = [];
  // Per element, its own text nodes joined ("Day " + "1" is one label).
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const text = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.nodeValue ?? '').join('');
    if (!/\d/.test(text)) continue;
    const host = (el.closest('[data-mis-item]') ?? null) as HTMLElement | null;
    if (!host) continue; // outside every tile, card and chart (filter row, range label, counted-at)
    const key = host.getAttribute('data-mis-item')!;
    if (isAxisTick(el)) continue;
    let left = withoutOwnLines(text, key);
    left = stripDates(left);
    for (const re of PLAN_PHRASES) left = left.replace(re, '');
    left = stripAxis(left);
    if (d) left = stripTokens(left, tokensFor(d, nOf(key)));
    if (/\d/.test(left)) out.push({ section, item: key, text, left });
  }
  return out;
}

describe('every tile and card is a registered item (CR-2b Task 4)', () => {
  it('Every_tile_and_card_is_a_registered_item', async () => {
    for (const s of MIS_SECTIONS) {
      const { container } = await open(s);
      const tiles = [...container.querySelectorAll('[data-testid^="kpi-"]')]
        .filter((e) => !(e.getAttribute('data-testid') ?? '').endsWith('-value'));
      // Cards: every section on the page except the strip that only holds tiles.
      const cards = [...container.querySelectorAll('section')].filter((e) => e.querySelector('[data-testid^="kpi-"]') === null);
      for (const r of [...tiles, ...cards]) {
        const key = r.getAttribute('data-mis-item');
        expect([s, r.tagName, key !== null && ALL_KEYS.has(key)]).toEqual([s, r.tagName, true]);
      }
      for (const e of container.querySelectorAll('[data-mis-item]')) {
        expect([s, e.getAttribute('data-mis-item'), ALL_KEYS.has(e.getAttribute('data-mis-item')!)])
          .toEqual([s, e.getAttribute('data-mis-item'), true]);
      }
      closeAll();
    }
  });

  it('Every_registered_item_appears_on_its_page', async () => {
    for (const s of MIS_SECTIONS) {
      const { container } = await open(s);
      const shown = new Set([...container.querySelectorAll('[data-mis-item]')].map((e) => e.getAttribute('data-mis-item')));
      for (const item of itemsOf(s)) expect([s, item.n, item.key, shown.has(item.key)]).toEqual([s, item.n, item.key, true]);
      // And nothing from another page.
      for (const key of shown) expect([s, key, itemByKey(SLOT_PARENT.get(key!) ?? key!).section]).toEqual([s, key, s]);
      closeAll();
    }
  });

  it('Served_items_name_only_served_fields', async () => {
    for (const s of MIS_SECTIONS) {
      const { container } = await open(s);
      for (const e of container.querySelectorAll('[data-mis-item]')) {
        const key = e.getAttribute('data-mis-item')!;
        const fields = (e.getAttribute('data-mis-fields') ?? '').split(' ').filter(Boolean);
        const p = planItem(nOf(key));
        for (const f of fields) {
          expect.soft([key, f, SERVED_FIELDS.includes(f)]).toEqual([key, f, true]);
          expect.soft([key, f, p.fields.includes(f)]).toEqual([key, f, true]);
        }
        if (p.kind === 'S' && !SLOT_PARENT.has(key)) expect([key, fields.length > 0]).toEqual([key, true]);
      }
      closeAll();
    }
  });

  it('Every_number_on_every_page_comes_from_the_answer', async () => {
    // Review V2: the same check on the full answer, on two farm-numbers-blocked answers and on an
    // answer where nothing is measured. In the last, no digit may appear in any tile or card apart
    // from dates and the range (and the plan's own label wording).
    const answers: [string, CompanyMis, CompanyMis | null][] = [
      ['full', D, D],
      ['farm_list_unreadable', BLOCKED_LIST, BLOCKED_LIST],
      ['too_many_farms_for_live_count', BLOCKED_CEILING, BLOCKED_CEILING],
      ['nothing measured', allNotMeasuredFixture(), null], // no answer value may be printed at all
    ];
    for (const [name, answer, tokens] of answers) {
      const strays: Stray[] = [];
      let checked = 0;
      for (const s of MIS_SECTIONS) {
        const { container } = await open(s, answer);
        // Charts' table twins print the same served values: open them too.
        for (const b of screen.queryAllByRole('button', { name: 'Table' })) fireEvent.click(b);
        checked += container.querySelectorAll('[data-mis-item]').length;
        strays.push(...strayDigits(tokens, `${name}: ${s}`, screen.getByTestId('mis-dashboard')));
        closeAll();
      }
      expect([name, checked > 60]).toEqual([name, true]);
      expect.soft(strays).toEqual([]);
    }
  });

  it('An_invented_zero_on_a_tile_would_be_caught', () => {
    // The check itself, on a hand-made tile: a 0 nobody served is a stray, a served one is not.
    const box = document.createElement('div');
    box.innerHTML = '<div data-mis-item="overview.understanding"><p>0</p></div><div data-mis-item="overview.dau"><p>143</p></div>';
    document.body.appendChild(box);
    const strays = strayDigits(D, 'probe', box);
    box.remove();
    expect(strays.map((x) => x.item)).toEqual(['overview.understanding']);
  });

  it('An_invented_digit_next_to_the_items_own_lines_is_still_caught', () => {
    // B25 (b): only the exact what/why strings are exempt; a digit beside them is still a stray.
    const e = LINES.get('overview.understanding')!;
    const box = document.createElement('div');
    box.innerHTML = `<div data-mis-item="overview.understanding"><p>${e.what}</p><p>${e.why}</p><p>0</p></div>`;
    document.body.appendChild(box);
    const strays = strayDigits(D, 'probe', box);
    box.remove();
    expect(strays.map((x) => [x.item, x.text])).toEqual([['overview.understanding', '0']]);
  });

  it('Not_served_items_show_their_sentence_and_no_digit', async () => {
    for (const s of MIS_SECTIONS) {
      const { container } = await open(s);
      for (const p of PLAN_ITEMS.filter((x) => x.section === s && x.kind !== 'S')) {
        const key = MIS_ITEMS[p.n - 1].key;
        const els = [...container.querySelectorAll(`[data-mis-item="${key}"]`)];
        expect([p.n, els.length > 0]).toEqual([p.n, true]);
        // Text nodes joined with spaces, so the end of one line never runs into the next word.
        const text = els.map((e) => {
          const parts: string[] = [];
          const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
          for (let t = w.nextNode(); t; t = w.nextNode()) parts.push(t.nodeValue ?? '');
          return parts.join(' ');
        }).join(' ');
        if (p.n === 12) {
          expect(text).toContain('Only Google Play knows');
          continue;
        }
        expect([p.n, text.includes(p.why!)]).toEqual([p.n, true]);
        // A definition the plan words with a digit ("3 of their first 7 days") is not a number.
        let bare = withoutOwnLines(text, key); // B25 (b): this item's own what/why lines are fixed copy
        for (const re of PLAN_PHRASES) bare = bare.replace(re, '');
        if (!PRINTS_SERVED_NUMBERS.has(p.n)) expect([p.n, /\d/.test(bare), bare]).toEqual([p.n, false, bare]);
      }
      closeAll();
    }
  });
});
