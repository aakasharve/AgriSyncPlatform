import { describe, expect, it } from 'vitest';
import raw from './fixtures/b24-metric-lines.json?raw';
import { METRIC_LINES } from '@/app/metricLines';
import { MIS_ITEMS } from '@/features/mis/misItems';

/**
 * B24 (2026-11-17) — the two plain lines, pinned from the reviewed file.
 * The reviewed lines file lives outside the repo, so its text is pinned here as a fixture
 * (`fixtures/b24-metric-lines.json`, a byte copy). Expected text is never read from the code under test.
 */

interface Entry {
  page: string; key: string; label: string; status: 'real' | 'idea' | 'double' | 'not-measured';
  buildId: string; what?: string; why?: string; keeper?: string;
}
const ENTRIES = JSON.parse(raw) as Entry[];
const OLDER = ENTRIES.filter((e) => !e.page.startsWith('MIS'));
const MIS = ENTRIES.filter((e) => e.page.startsWith('MIS'));

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const EMOJI = /\p{Extended_Pictographic}/u;
const HEADLINE_N = [14, 25, 32, 42, 53, 62, 73];

describe('the reviewed lines file itself (B24 fixture)', () => {
  it('B24_fixture_has_137_entries_in_the_stated_split', () => {
    expect(ENTRIES).toHaveLength(137);
    const count = (s: string) => ENTRIES.filter((e) => e.status === s).length;
    expect(count('real')).toBe(67); // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): E3 F6 U1 U2 L7 P1 P4 P5 P6 P7 P10 P11 S1 S2 S3 H9 became real
    expect(count('not-measured')).toBe(35);
    expect(count('idea')).toBe(17);
    expect(count('double')).toBe(18);
    expect(MIS).toHaveLength(73);
  });
});

describe('every entry has both lines within the limits (B21/B22/B24)', () => {
  it.each(ENTRIES.filter((e) => e.status !== 'double').map((e) => [e.key, e] as const))(
    'B24_%s_has_what_and_why_at_most_18_words_no_AI_no_emoji',
    (_k, e) => {
      for (const line of [e.what, e.why]) {
        expect(line, `${e.key} line`).toBeTruthy();
        expect(words(line!)).toBeLessThanOrEqual(18);
        expect(line!).not.toMatch(/\bAI\b/);
        expect(line!).not.toMatch(EMOJI);
      }
    },
  );
});

describe('metricLines.ts carries the older-page entries verbatim (B24)', () => {
  it('B24_metricLines_has_exactly_the_older_page_entries', () => {
    expect(METRIC_LINES).toHaveLength(OLDER.length);
    expect(new Set(METRIC_LINES.map((m) => m.key))).toEqual(new Set(OLDER.map((e) => e.key)));
  });

  it.each(OLDER.map((e) => [e.key, e] as const))('B24_metricLines_%s_is_verbatim', (_k, e) => {
    const m = METRIC_LINES.find((x) => x.key === e.key)!;
    expect(m.page).toBe(e.page);
    expect(m.label).toBe(e.label);
    expect(m.status).toBe(e.status);
    expect(m.buildId).toBe(e.buildId);
    if (e.status === 'double') {
      expect(m.keeper).toBe(e.keeper);
    } else {
      expect(m.what).toBe(e.what);
      expect(m.why).toBe(e.why);
    }
  });

  it('B24_metricLines_split_is_18_doubles_17_ideas_29_real', () => {
    const c = (s: string) => METRIC_LINES.filter((m) => m.status === s).length;
    expect(c('double')).toBe(18);
    expect(c('idea')).toBe(17); // CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): P1 P4 P5 P6 P7 P10 P11 S1 S2 S3 H9 became real
    expect(c('real')).toBe(29);
    expect(c('real')).toBe(OLDER.filter((e) => e.status === 'real').length);
  });

  it('B24_every_double_names_its_keeper', () => {
    for (const m of METRIC_LINES.filter((x) => x.status === 'double')) expect(m.keeper, m.key).toBeTruthy();
  });
});

describe('misItems.ts carries the MIS lines verbatim (B24)', () => {
  it('B24_every_MIS_item_has_a_json_entry_and_back', () => {
    expect(MIS_ITEMS).toHaveLength(MIS.length);
    expect(new Set(MIS_ITEMS.map((i) => i.key))).toEqual(new Set(MIS.map((e) => e.key)));
  });

  it.each(MIS.map((e) => [e.key, e] as const))('B24_misItem_%s_what_and_whyHere_verbatim', (_k, e) => {
    const item = MIS_ITEMS.find((i) => i.key === e.key)!;
    expect(item.what).toBe(e.what);
    expect(item.whyHere).toBe(e.why);
    expect(words(item.what)).toBeLessThanOrEqual(18);
    expect(words(item.whyHere)).toBeLessThanOrEqual(18);
  });

  it('B24_the_seven_headline_items_exist_by_number', () => {
    for (const n of HEADLINE_N) expect(MIS_ITEMS.some((i) => i.n === n), `n ${n}`).toBe(true);
  });
});
