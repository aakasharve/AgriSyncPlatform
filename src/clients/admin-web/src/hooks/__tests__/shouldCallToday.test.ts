import { describe, expect, it } from 'vitest';
import { mergeCallList } from '../useShouldCallToday';
import type { SilentChurnItem, SufferingItem } from '../useFarms';

/**
 * THE UNION AND ITS ORDER, as a pure function.
 *
 * The rendered screen proves this too, and that proof is the one that matters —
 * but the ORDER is a product decision with an argument behind it, and an
 * argument is cheaper to break here than through five mounted hooks. This file
 * exists to make each of the three sort keys individually killable.
 *
 * THE DECISION IT ENCODES. `mis.farmer_suffering_watchlist.error_count` is a
 * bare `COUNT(*)` over three event types including `ai.invocation` in FULL —
 * successes and failures alike. Only the `HAVING` clause filters to failures.
 * So the figure the server orders by, and truncates its `LIMIT 50` by, counts
 * successful voice parses: ranking a CALL list on it puts the heaviest, happiest
 * users at the top. Task 16 renamed it to "Events counted" on its own screen and
 * stated the flaw; Home must not quietly undo that by sorting on it.
 */

function suffering(farmId: string, name: string, errorCount: number): SufferingItem {
  return {
    farmId,
    name,
    errorCount,
    syncErrors: 1,
    logErrors: 0,
    voiceErrors: 1,
    lastErrorAt: '2026-09-01T06:00:00.0000000Z',
  };
}

function churn(farmId: string, name: string, weeksSilent: number, lastLogAt: string | null = '2026-08-01T00:00:00.0000000Z'): SilentChurnItem {
  return { farmId, name, ownerPhone: '98******10', plan: 'trial', weeksSilent, lastLogAt };
}

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';

describe('one row per farm, carrying every reason', () => {
  it('does not list a farm twice when both watchlists flag it', () => {
    const rows = mergeCallList([suffering(A, 'Wagholi', 5)], [churn(A, 'Wagholi', 3)], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons.map((r) => r.kind)).toEqual(['failing', 'silent']);
    /* Both source rows are kept, so the screen can say what each feed reported
       without asking either endpoint a second time. */
    expect(rows[0].suffering).not.toBeNull();
    expect(rows[0].churn).not.toBeNull();
  });

  it('gives the reasons a fixed order, so two identically flagged farms read alike', () => {
    const rows = mergeCallList([suffering(A, 'Wagholi', 5)], [churn(A, 'Wagholi', 3)], []);
    const reversed = mergeCallList([], [churn(B, 'Ozar', 3)], []);
    expect(rows[0].reasons[0].kind).toBe('failing');
    expect(reversed[0].reasons[0].kind).toBe('silent');
  });

  it('keeps a held-out row apart and never calls it "never logged"', () => {
    /* Task 15: the feed CANNOT report a never-logged farm — an INNER JOIN drops
       it before the list is built. What is knowable is that this row arrived
       with no last log, and that is what the pill says. */
    const rows = mergeCallList([], [], [churn(C, 'Sinnar', 1, null)]);
    expect(rows[0].reasons[0].kind).toBe('no-last-log');
    expect(rows[0].reasons[0].label).toBe('No last log');
    expect(rows[0].reasons[0].label).not.toContain('Never');
    expect(rows[0].churn).toBeNull();
    expect(rows[0].heldOut).not.toBeNull();
  });

  it('pluralises the silence, so no row reads "Silent 1 full weeks"', () => {
    expect(mergeCallList([], [churn(A, 'One', 1)], [])[0].reasons[0].label).toBe(
      'Silent 1 full week',
    );
    expect(mergeCallList([], [churn(A, 'Many', 6)], [])[0].reasons[0].label).toBe(
      'Silent 6 full weeks',
    );
  });
});

describe('the order, one key at a time', () => {
  it('KEY 1 — a farm flagged twice outranks a farm flagged once, whatever the counts say', () => {
    /*
     * THE CENTRAL CLAIM. `C` holds nine hundred counted events and one reason;
     * `A` holds five and two reasons. An events-descending sort — which is what
     * the plan asked for and what the SERVER does — puts C first.
     */
    const rows = mergeCallList(
      [suffering(A, 'Wagholi', 5), suffering(C, 'Sinnar', 900)],
      [churn(A, 'Wagholi', 2)],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['Wagholi', 'Sinnar']);
    /* And the big number really is on the row that came second — otherwise the
       assertion above would pass for the wrong reason. */
    expect(rows[1].suffering?.errorCount).toBe(900);
  });

  it('KEY 2 — equal reasons break on the longest silence, descending', () => {
    const rows = mergeCallList([], [churn(A, 'Short', 2), churn(B, 'Long', 9)], []);
    expect(rows.map((r) => r.name)).toEqual(['Long', 'Short']);
  });

  it('KEY 2 — a farm with NO silence reading sorts below one that has one', () => {
    /* The missing-sorts-last rule the list component applies to every other
       column. "Not on the churn watchlist" is not "silent for zero weeks". */
    const rows = mergeCallList([suffering(C, 'NoReading', 400)], [churn(B, 'Measured', 1)], []);
    expect(rows.map((r) => r.name)).toEqual(['Measured', 'NoReading']);
  });

  it('KEY 3 — an exact tie falls back to the name, so the order is stable and explicable', () => {
    const rows = mergeCallList([], [churn(B, 'Zeta', 4), churn(A, 'Alpha', 4)], []);
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });
});
