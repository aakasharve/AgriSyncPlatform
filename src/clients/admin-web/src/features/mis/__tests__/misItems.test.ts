import { describe, expect, it } from 'vitest';
import { MIS_ITEMS, MIS_SLOTS, SERVED_FIELDS, itemByKey, reasonSentence } from '@/features/mis/misItems';
import { at, misFixture } from '@/test/misFixture';
import { PLAN_ITEMS, PLAN_REASONS, PLAN_UNKNOWN_REASON, PRINTS_SERVED_NUMBERS } from '@/test/misPlan';

/**
 * CR-2b Task 2 — the 73 items and the reason sentences, checked against the
 * plan's own table (an independent copy in `src/test/misPlan.ts`).
 */

const KIND: Record<string, 'S' | 'A' | 'O'> = { served: 'S', 'small-addition': 'A', 'outside-source': 'O' };
const EMOJI = /\p{Extended_Pictographic}/u;
const BANNED = [/\bAI\b/, /matview/i, /\bRLS\b/, /\bDTO\b/];

describe('the 73 items (CR-2b Task 2)', () => {
  // CR-2c E9 (plan CR-2c-mis-small-additions, binding): nine small additions became served, so the
  // console holds 47 served / 3 small-addition / 23 outside-source. Retired by name, citing that plan
  // (C7 pattern): Holds_73_items_38_served_12_small_23_outside, which pinned the nine as not built.
  it('Holds_73_items_47_served_3_small_23_outside', () => {
    expect(MIS_ITEMS).toHaveLength(73);
    expect(MIS_ITEMS.map((i) => i.n)).toEqual(Array.from({ length: 73 }, (_, k) => k + 1));
    const count = (k: string) => MIS_ITEMS.filter((i) => i.kind === k).length;
    expect(count('served')).toBe(47);
    expect(count('small-addition')).toBe(3);
    expect(count('outside-source')).toBe(23);
    // The three left as small additions are the district items #40, #58, #62 (CR-2c Task 2 Step 3).
    expect(MIS_ITEMS.filter((i) => i.kind === 'small-addition').map((i) => i.n)).toEqual([40, 58, 62]);
    // Item by item, the kind the plan gives it.
    for (const p of PLAN_ITEMS) expect([p.n, KIND[MIS_ITEMS[p.n - 1].kind]]).toEqual([p.n, p.kind]);
    // Keys are unique and look up their own item.
    expect(new Set(MIS_ITEMS.map((i) => i.key)).size).toBe(73);
    for (const i of MIS_ITEMS) expect(itemByKey(i.key)).toBe(i);
  });

  it('Pages_hold_14_11_7_10_11_9_11', () => {
    const per = (s: string) => MIS_ITEMS.filter((i) => i.section === s).length;
    expect([
      per('overview'), per('acquisition'), per('engagement'), per('retention'),
      per('quality'), per('farms'), per('operations'),
    ]).toEqual([14, 11, 7, 10, 11, 9, 11]);
    for (const p of PLAN_ITEMS) expect([p.n, MIS_ITEMS[p.n - 1].section]).toEqual([p.n, p.section]);
  });

  it('Every_served_field_exists_in_the_answer', () => {
    const d = misFixture();
    expect(SERVED_FIELDS.length).toBeGreaterThan(0);
    for (const f of SERVED_FIELDS) expect([f, at(d, f) !== undefined]).toEqual([f, true]);
    for (const i of MIS_ITEMS) for (const f of i.fields) expect([i.key, f, at(d, f) !== undefined]).toEqual([i.key, f, true]);
  });

  it('Served_items_name_only_the_fields_the_plan_gives_them', () => {
    for (const p of PLAN_ITEMS) {
      const item = MIS_ITEMS[p.n - 1];
      if (p.kind === 'S') expect([p.n, item.fields.length > 0]).toEqual([p.n, true]);
      for (const f of item.fields) expect([p.n, f, p.fields.includes(f)]).toEqual([p.n, f, true]);
    }
  });

  it('Every_unserved_item_says_why_in_plain_words', () => {
    for (const p of PLAN_ITEMS) {
      const item = MIS_ITEMS[p.n - 1];
      if (p.kind === 'S') continue;
      expect([p.n, typeof item.why === 'string' && item.why.trim().length > 0]).toEqual([p.n, true]);
      const why = item.why ?? '';
      for (const re of BANNED) expect([p.n, re.test(why)]).toEqual([p.n, false]);
      expect([p.n, EMOJI.test(why)]).toEqual([p.n, false]);
      // Shown verbatim (plan "The 73 items": "The reason sentence is shown verbatim").
      if (PRINTS_SERVED_NUMBERS.has(p.n)) expect(why).toContain(p.why!);
      else expect([p.n, why]).toEqual([p.n, p.why]);
    }
    for (const s of MIS_SLOTS) {
      expect(s.why.trim().length).toBeGreaterThan(0);
      for (const re of BANNED) expect(re.test(s.why)).toBe(false);
      expect(EMOJI.test(s.why)).toBe(false);
    }
    // B3: the only slot left is the "not in a producer organisation" row of item 60.
    expect(MIS_SLOTS).toHaveLength(1);
    expect(MIS_SLOTS[0].parent).toBe(MIS_ITEMS[59].key);
    // Labels carry no banned word either.
    for (const i of MIS_ITEMS) {
      for (const re of BANNED) expect([i.n, re.test(i.label)]).toEqual([i.n, false]);
      expect([i.n, EMOJI.test(i.label)]).toEqual([i.n, false]);
    }
  });

  it('Every_server_reason_has_one_sentence_and_unknown_fails_closed', () => {
    for (const [code, sentence] of Object.entries(PLAN_REASONS)) expect(reasonSentence(code)).toBe(sentence);
    expect(reasonSentence('something_new')).toBe(PLAN_UNKNOWN_REASON);
    expect(reasonSentence(null)).toBe(PLAN_UNKNOWN_REASON);
    expect(reasonSentence('toString')).toBe(PLAN_UNKNOWN_REASON);
    expect(reasonSentence('__proto__')).toBe(PLAN_UNKNOWN_REASON);
    // CR-2c E9: six reason codes (the plan's "answer additions" add `not_recorded`), each its own sentence.
    expect(Object.keys(PLAN_REASONS)).toHaveLength(6);
    expect(new Set(Object.keys(PLAN_REASONS).map(reasonSentence)).size).toBe(6);
  });
});
