import { describe, expect, it } from 'vitest';
import { itemsOf, MIS_ITEMS, type MisSectionKey } from '@/features/mis/misItems';
import { misToAiJson, misToAiText } from '@/features/mis/copyForAi';
import { misFixture, notMeasured } from '@/test/misFixture';
import { PAGE_NAMES, PLAN_REASONS } from '@/test/misPlan';

/**
 * CR-3 Task A8 (D-156b): Copy for AI. D8: every expected value below is a literal
 * written by hand from the fixture in `test/misFixture.ts`, never produced by the
 * formatter under test.
 */

const SECTIONS: MisSectionKey[] = ['overview', 'acquisition', 'engagement', 'retention', 'quality', 'farms', 'operations'];

interface PackItem { key: string; label: string; value: number | null; shown: string | null; meaning: string; notMeasured: string | null }
interface Pack {
  page: string;
  range: { from: string; to: string; days: number };
  countedAt: string;
  testAccountsLeftOut: number;
  items: PackItem[];
}
const pack = (section: MisSectionKey, d = misFixture()): Pack => JSON.parse(misToAiJson(d, section)) as Pack;
const item = (p: Pack, key: string): PackItem => {
  const found = p.items.find((i) => i.key === key);
  if (!found) throw new Error(`no item ${key}`);
  return found;
};

describe('Copy for AI packs (CR-3 A8)', () => {
  it('Text_and_json_hold_the_numbers_the_screen_shows', () => {
    const d = misFixture();
    const overview = misToAiText(d, 'overview');
    expect(overview.split('\n')[0]).toBe('ShramSafal Company MIS — Overview');
    expect(overview).toContain('Range 2026-10-17..2026-11-15 (30 days). Counted at 15 Nov 2026, 2:32 pm India time. Test accounts left out: 3.');
    expect(overview).toContain('Active farms: 412 — Farms that saved at least one entry in the 7 days ending on the last day chosen.');
    expect(overview).toContain('Sign-ups: 268 — ');
    expect(overview).toContain('Stickiness: 24.4% — ');
    expect(overview).toContain('Saved by voice: 42.5% — ');
    expect(overview).toContain('मला किती समजलं: 6.5 of 10 — ');

    const j = pack('overview');
    expect(j.page).toBe('Overview');
    expect(j.range).toEqual({ from: '2026-10-17', to: '2026-11-15', days: 30 });
    expect(j.testAccountsLeftOut).toBe(3);
    expect(j.countedAt).toBe('15 Nov 2026, 2:32 pm India time');
    expect(item(j, 'overview.activeFarms')).toMatchObject({ value: 412, shown: '412', notMeasured: null });
    expect(item(j, 'overview.stickiness')).toMatchObject({ value: 24.4, shown: '24.4%' });
    expect(item(j, 'overview.voiceShare')).toMatchObject({ value: 42.5, shown: '42.5%' });

    const farms = misToAiText(d, 'farms');
    expect(farms).toContain('Farms registered: 774 — ');
    expect(farms).toContain('Acres covered: 963.4 — ');
    expect(farms).toContain('Grapes');
    expect(farms).toContain('Godavari Kisan Producer Company');
    expect(item(pack('farms'), 'farms.registered').value).toBe(774);
    expect(item(pack('quality'), 'quality.transcriptionAvg')).toMatchObject({ value: 2340, shown: '2.3 s' });
  });

  it('The_json_parses_and_has_one_item_per_page_item', () => {
    for (const s of SECTIONS) {
      const p = pack(s);
      expect(p.items.length).toBe(itemsOf(s).length);
      expect(p.items.map((i) => i.key)).toEqual(itemsOf(s).map((i) => i.key));
      expect(p.page).toBe(PAGE_NAMES[s]);
    }
    expect(MIS_ITEMS.length).toBe(73);
  });

  it('A_not_measured_value_carries_its_reason_not_zero', () => {
    const d = misFixture({ overview: { signUps: notMeasured('no_complete_window') } });
    const j = pack('overview', d);
    const outside = item(j, 'overview.installs');
    expect(outside).toMatchObject({ value: null, shown: null });
    expect(outside.notMeasured).toBe('Only Google Play knows how many people installed the app, and that report is not connected.');
    const served = item(j, 'overview.signUps');
    expect(served).toMatchObject({ value: null, shown: null });
    expect(served.notMeasured).toBe(PLAN_REASONS.no_complete_window);
    const text = misToAiText(d, 'overview');
    expect(text).toContain('Installs: not measured — Only Google Play knows how many people installed the app, and that report is not connected.');
    expect(text).toContain(`Sign-ups: not measured — ${PLAN_REASONS.no_complete_window}`);
    expect(text).not.toMatch(/Sign-ups: 0/);
  });

  it('The_copy_carries_no_phone_name_or_id', () => {
    const phone = /\d{10}|\+91/;
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const s of SECTIONS) {
      const text = misToAiText(misFixture(), s);
      const json = misToAiJson(misFixture(), s);
      for (const out of [text, json]) {
        expect(out).not.toMatch(phone);
        expect(out).not.toMatch(guid);
        expect(out).not.toMatch(/displayName|ownerPhone|userId|farmId/);
      }
    }
  });

  it('Every_served_item_of_a_full_answer_has_a_shown_value', () => {
    for (const s of SECTIONS) {
      for (const i of pack(s).items) {
        const meta = itemsOf(s).find((m) => m.key === i.key);
        if (meta?.kind === 'served') expect([i.key, i.shown !== null, i.notMeasured]).toEqual([i.key, true, null]);
        else expect([i.key, i.shown, i.notMeasured !== null]).toEqual([i.key, null, true]);
      }
    }
  });

  it('Test_accounts_left_out_is_stated', () => {
    expect(misToAiText(misFixture({ excludedTestAccounts: 0 }), 'quality')).toContain('No test accounts are set up to be left out, so test phones are counted.');
    expect(misToAiText(misFixture({ excludedTestAccounts: 0 }), 'quality')).not.toContain('left out: 0');
    expect(misToAiText(misFixture(), 'quality')).toContain('Test accounts left out: 3.');
    expect(pack('quality', misFixture({ excludedTestAccounts: 7 })).testAccountsLeftOut).toBe(7);
  });
});
