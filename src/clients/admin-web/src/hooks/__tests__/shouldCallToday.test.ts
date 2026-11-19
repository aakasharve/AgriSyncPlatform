import { describe, expect, it } from 'vitest';
import { mergeCallList, useShouldCallToday } from '../useShouldCallToday';
import type { SilentFarm, SufferingItem } from '../useFarms';

/**
 * The call list (H9) pinned the OLD silent-churn and Suffering rows (weeks silent, `plan`, an events count, a
 * held-out row) and an order built on them. Both answers changed shape and the list is real now (C26): bands
 * 7-13 and 14-29 plus the Suffering 7-day list, merged by farm id, each row saying why it is listed.
 * The merge is proved through the screen in src/pages/__tests__/HomePage.callList.test.tsx. Retired, one line each:
 */
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "does not list a farm twice when both watchlists flag it" (covered by Home_call_list_merges_silent_and_repeated_problem_farms).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "gives the reasons a fixed order, so two identically flagged farms read alike" (old reason kinds failing/silent).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "keeps a held-out row apart and never calls it never logged" (the new answer names never-logged farms in band never, which are not on the call list).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "pluralises the silence, so no row reads Silent 1 full weeks" (silence is counted in days now).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 1 - a farm flagged twice outranks a farm flagged once, whatever the counts say".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 2 - equal reasons break on the longest silence, descending".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 2 - a farm with NO silence reading sorts below one that has one".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 3 - an exact tie falls back to the name, so the order is stable and explicable".
// The spec (C26) fixes no order for the list, so none is pinned here.

it('still has a call-list hook to mount', () => {
  expect(typeof useShouldCallToday).toBe('function');
});

/* CR-2e C28: real tests of the merge again. Expected values come from C26/C28, not from the code under test. */
const id = (n: number) => `aaaaaaaa-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const silent = (n: number, band: SilentFarm['band'], daysSilent: number | null, over: Partial<SilentFarm> = {}): SilentFarm => ({
  farmId: id(n), name: `Silent ${n}`, ownerPhone: `90000000${String(n).padStart(2, '0')}`, band, daysSilent,
  lastEntryUtc: null, planCode: null, planStatus: null, ...over,
});
const sick = (n: number): SufferingItem => ({
  farmId: id(n), problemCount: 5, syncProblems: 2, entryProblems: 1, voiceProblems: 1, otherProblems: 1,
  lastProblemAt: '2026-08-31T09:15:00Z',
} as SufferingItem);
const noContacts = { get: () => undefined };
const contactsOf = (m: Record<string, { name: string; ownerPhone: string | null }>) => ({ get: (k: string) => m[k] });

describe('mergeCallList (C26, C28)', () => {
  it('lists silent farms in the bands 7-13 and 14-29 only, each with its own days', () => {
    const rows = mergeCallList(
      [silent(1, '7-13', 9), silent(2, '14-29', 20), silent(3, '30+', 45), silent(4, 'never', null)],
      [],
      noContacts,
    );
    expect(rows.map((r) => r.farmId).sort()).toEqual([id(1), id(2)]);
    expect(rows.find((r) => r.farmId === id(1))!.reasons.map((x) => x.label).join(' ')).toMatch(/9 days/);
    expect(rows.find((r) => r.farmId === id(2))!.reasons.map((x) => x.label).join(' ')).toMatch(/20 days/);
  });

  it('a farm on both lists is one row with two reasons', () => {
    const rows = mergeCallList([silent(2, '14-29', 20)], [sick(2)], noContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons).toHaveLength(2);
    expect(rows[0].reasons.map((x) => x.kind).sort()).toEqual(['problems', 'silent']);
  });

  it('matches farm ids regardless of letter case', () => {
    const rows = mergeCallList([silent(2, '14-29', 20, { farmId: id(2).toUpperCase() })], [sick(2)], noContacts);
    expect(rows).toHaveLength(1);
  });

  it('a 30+ or never farm with repeated problems is listed once, named and phoned from the silent answer, with no contact needed', () => {
    const rows = mergeCallList(
      [silent(3, '30+', 45, { ownerPhone: '9000000003' }), silent(4, 'never', null, { ownerPhone: '9000000004' })],
      [sick(3), sick(4)],
      noContacts,
    );
    expect(rows).toHaveLength(2);
    const r3 = rows.find((r) => r.farmId === id(3))!;
    const r4 = rows.find((r) => r.farmId === id(4))!;
    expect(r3.name).toBe('Silent 3');
    expect(r3.ownerPhone).toBe('9000000003');
    expect(r3.phoneKnown).toBe(true);
    expect(r4.name).toBe('Silent 4');
    expect(r4.ownerPhone).toBe('9000000004');
    expect(r4.phoneKnown).toBe(true);
    for (const r of [r3, r4]) expect(r.reasons.map((x) => x.kind)).toEqual(['problems']);
  });

  it('a farm the silent answer does not name is named from contacts, and its silence is not invented', () => {
    const rows = mergeCallList([], [sick(5)], contactsOf({ [id(5)]: { name: 'Pawar Shet', ownerPhone: '9000000005' } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Pawar Shet');
    expect(rows[0].ownerPhone).toBe('9000000005');
    expect(rows[0].phoneKnown).toBe(true);
    expect(rows[0].reasons.map((x) => x.kind)).toEqual(['problems']);
  });

  it('a phone not yet fetched is not known; a fetched null phone is known and null', () => {
    const pending = mergeCallList([], [sick(5)], noContacts)[0];
    expect(pending.phoneKnown).toBe(false);
    expect(pending.ownerPhone).toBeNull();
    const real = mergeCallList([], [sick(5)], contactsOf({ [id(5)]: { name: 'Pawar Shet', ownerPhone: null } }))[0];
    expect(real.phoneKnown).toBe(true);
    expect(real.ownerPhone).toBeNull();
  });

  it('a silent farm with a real null phone is a known null', () => {
    const r = mergeCallList([silent(1, '7-13', 9, { ownerPhone: null })], [], noContacts)[0];
    expect(r.phoneKnown).toBe(true);
    expect(r.ownerPhone).toBeNull();
  });

  it('a missing days value is not measured, never 0 days', () => {
    const r = mergeCallList([silent(1, '7-13', null)], [], noContacts)[0];
    const words = r.reasons.map((x) => x.label).join(' ');
    expect(words).toMatch(/not measured/i);
    expect(words).not.toMatch(/\b0 days?\b/);
  });

  it('empty halves make an empty list', () => {
    expect(mergeCallList([], [], noContacts)).toEqual([]);
  });
});
