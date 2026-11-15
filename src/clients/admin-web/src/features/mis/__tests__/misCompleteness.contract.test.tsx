import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyMis, MisNumber } from '@/hooks/useCompanyMis';
import { MIS_ITEMS, MIS_SLOTS, SERVED_FIELDS, itemByKey, itemsOf, type MisSectionKey } from '@/features/mis/misItems';
import { resetMisPeriod } from '@/features/mis/misPeriod';
import { fmtCompact, fmtDec, fmtInt, fmtMs, fmtPctPoints } from '@/features/mis/misFormat';
import type { StubbedAdapter } from '@/test/stubAdapter';
import { at, misFixture } from '@/test/misFixture';
import { PLAN_ITEMS, PRINTS_SERVED_NUMBERS, planItem } from '@/test/misPlan';
import { MIS_NOW, MIS_SECTIONS, countedShown, renderMis, serveMis } from '@/test/misPage';

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
const SLOT_PARENT = new Map(MIS_SLOTS.map((s) => [s.key, s.parent]));
const ALL_KEYS = new Set([...MIS_ITEMS.map((i) => i.key), ...MIS_SLOTS.map((s) => s.key)]);

function nOf(key: string): number {
  const parent = SLOT_PARENT.get(key);
  return itemByKey(parent ?? key).n;
}

async function open(section: MisSectionKey) {
  stub = serveMis();
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

/** Plan-stated derivations, per item number. */
function derivations(n: number): number[] {
  const a = D.acquisition;
  const verified = a.verified.current.value!;
  const hasFarm = a.hasFarm.current.value!;
  const firstLog = a.firstLog.current.value!;
  switch (n) {
    case 1: // hero: new farms = registered now - registered before the range
      return [D.farms.farmsRegistered.current.value! - D.farms.farmsRegistered.previous.value!];
    case 16: case 17: case 18: case 19: case 25: // funnel: shares of sign-ups, habit of eligible, B9 lines
      return [
        (hasFarm / verified) * 100, (firstLog / verified) * 100, 100,
        (a.habit.current.value! / a.habitEligible.current.value!) * 100,
        // The funnel card (keyed as its first measured step) holds every step and its table twin.
        a.habit.current.value!, a.habitEligible.current.value!,
        ...deltaTokens(a.verified), ...deltaTokens(a.hasFarm), ...deltaTokens(a.firstLog), ...deltaTokens(a.habit),
        Math.round(((verified - hasFarm) / verified) * 100), Math.round(((hasFarm - firstLog) / hasFarm) * 100),
        verified, hasFarm, firstLog,
      ];
    case 30: { // B8 role shares
      const total = D.engagement.roleMixOfMau.reduce((s, r) => s + r.people, 0);
      return D.engagement.roleMixOfMau.map((r) => share1(r.people, total));
    }
    case 39: { // B8 band shares
      const r = D.retention;
      const bands = [r.activeFarms0To6, r.quietFarms7To13, r.quietFarms14To29, r.silentFarms30Plus, r.neverLoggedFarms].map((b) => b.current.value!);
      const total = bands.reduce((s, x) => s + x, 0);
      return bands.map((b) => share1(b, total));
    }
    default:
      return [];
  }
}

const tokenCache = new Map<number, string[]>();
function tokensFor(n: number): string[] {
  const hit = tokenCache.get(n);
  if (hit) return hit;
  const nums: number[] = [];
  for (const f of planItem(n).fields) {
    const value = at(D, f);
    numbersIn(value, nums);
    if (value && typeof value === 'object' && 'current' in (value as object)) nums.push(...deltaTokens(value as MisNumber));
  }
  nums.push(...derivations(n));
  const set = new Set<string>();
  for (const v of nums) for (const t of variants(v)) if (/\d/.test(t)) set.add(t);
  const list = [...set].sort((x, y) => y.length - x.length);
  tokenCache.set(n, list);
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
  /\blast 7 days\b/gi, /\bin the 7 days\b/g, /\b3 of (their )?first 7 days\b/g, /\bslowest 5%/gi,
  /\bmore than 500 farms\b/g, /\bon day 30\b/gi, /\bDay (1|7|14|30)\b/g, /\bday 1\b/gi,
  /\bDay-(1|30)\b/gi, // items 33, 34: next-day and day-30 return
  /\b95th percentile\b/g, // item 45 = CR-2a rule 30, nearest-rank 95th percentile
  /\btrailing 7 days\b/g, // item 61 = CR-2a rule 38, farms active at d (the 7 days to d)
];

function stripAxis(text: string): string {
  return text
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

/** A round axis tick: at most `sig` significant digits (charts: 2; a lone scale label elsewhere: 1). */
function isTick(text: string, sig = 2): boolean {
  const m = /^[−-]?([\d.,]+)\s*(%|ms|s|K|L)?$/.exec(text.trim());
  if (!m) return false;
  const digits = m[1].replace(/[.,]/g, '').replace(/^0+/, '').replace(/0+$/, '');
  return digits.length <= sig;
}

interface Stray { section: string; item: string; text: string; left: string }

function strayDigits(section: string, root: HTMLElement): Stray[] {
  const out: Stray[] = [];
  // Per element, its own text nodes joined ("Day " + "1" is one label).
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const text = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.nodeValue ?? '').join('');
    if (!/\d/.test(text)) continue;
    const host = (el.closest('[data-mis-item]') ?? null) as HTMLElement | null;
    if (!host) continue; // outside every tile, card and chart (filter row, range label, counted-at)
    const key = host.getAttribute('data-mis-item')!;
    const inSvgText = el.closest('svg') !== null && el.tagName.toLowerCase() === 'text';
    if (inSvgText && isTick(text)) continue;
    // A lone round label outside a chart, such as the end of a colour scale ("60%").
    if (!inSvgText && el.children.length === 0 && isTick(text, 1)) continue;
    let left = stripDates(text);
    for (const re of PLAN_PHRASES) left = left.replace(re, '');
    left = stripAxis(left);
    left = stripTokens(left, tokensFor(nOf(key)));
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
    const strays: Stray[] = [];
    let checked = 0;
    for (const s of MIS_SECTIONS) {
      const { container } = await open(s);
      // Charts' table twins print the same served values: open them too.
      for (const b of screen.queryAllByRole('button', { name: 'Table' })) fireEvent.click(b);
      checked += container.querySelectorAll('[data-mis-item]').length;
      strays.push(...strayDigits(s, screen.getByTestId('mis-dashboard')));
      closeAll();
    }
    expect(checked).toBeGreaterThan(60);
    expect(strays).toEqual([]);
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
        let bare = text;
        for (const re of PLAN_PHRASES) bare = bare.replace(re, '');
        if (!PRINTS_SERVED_NUMBERS.has(p.n)) expect([p.n, /\d/.test(bare), bare]).toEqual([p.n, false, bare]);
      }
      closeAll();
    }
  });
});
