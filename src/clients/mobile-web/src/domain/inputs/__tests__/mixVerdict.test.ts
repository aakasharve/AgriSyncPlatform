/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 3) — tank combinations and the
 * sourced mixing verdict.
 *
 * The verdict cases live ONCE in `sync-contract/reference/inputs/verdict-cases.json`; the server's
 * `MixVerdictTests` runs the same file. They are judged against the case file's own rules, marked
 * reviewed HERE (a test fixture), never by editing the data — so these tests keep passing after the
 * founder fills `reviewedBy`/`reviewedOn` in the live file.
 * Doctrine P4: red only from a sourced, reviewed rule, and only when the record says the products
 * shared a tank. Review Focus 5: an unknown member is never green.
 */
import { describe, it, expect } from 'vitest';
import verdictCases from '../../../../../../../sync-contract/reference/inputs/verdict-cases.json';
import referenceRules from '../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import type { InputEvent } from '../../types/log.types';
import {
    SHIPPABLE_RULES,
    combinationsOf,
    isShippable,
    judgeMix,
    judgeProducts,
    tankMethodOf,
    type Combination,
    type TankMethod,
} from '../mixVerdict';
import type { MixRule } from '../mixRules';

interface VerdictCase {
    name: string;
    method: string | null;
    items: Array<{ productId: string | null }>;
    expect: 'red' | 'green' | 'grey';
    ruleId: string | null;
    pairProductIds: string[];
}

const cases = verdictCases as VerdictCase[];

/** The case file's rules, marked reviewed in the test only. */
const reviewed = (rules: readonly MixRule[]): MixRule[] =>
    rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));
const CASE_RULES = reviewed((referenceRules as { rules: MixRule[] }).rules);

const SOURCE = { title: 'Test source', publisher: 'Test', url: 'https://example.org/source', retrievedOn: '2026-11-06' };
const text = { mr: 'चाचणी', en: 'test' };
const fixture = (over: Partial<MixRule>): MixRule => ({
    id: 'T-NEVER',
    verdict: 'never',
    a: { tag: 'calcium-source' },
    b: { tag: 'phosphate-source' },
    why: text,
    nowDo: text,
    nextTime: text,
    sources: [SOURCE],
    reviewedBy: 'test-fixture',
    reviewedOn: '2026-11-06',
    appliesTo: ['fertigation', 'spray'],
    ...over,
});

/** A minimal InputEvent: only what the combination reads. */
const ev = (id: string, names: Array<[string, string?]>, mixId?: string): InputEvent => ({
    id,
    mixId,
    mix: names.map(([productName, npkGrade], i) => ({ id: `${id}_${i}`, productName, npkGrade })),
}) as InputEvent;

/** A drip tank (fertigation) holding these items. */
const tank = (...names: Array<[string, string?]>): Combination => tankBy('fertigation', ...names);

const tankBy = (method: TankMethod | null, ...names: Array<[string, string?]>): Combination => ({
    method,
    items: names.map(([spokenName, npkGrade], i) => ({
        inputEventId: 'e1',
        mixIndex: i,
        spokenName,
        npkGrade: npkGrade ?? null,
    })),
});

describe('judgeProducts — shared cases (verdict-cases.json, case rules marked reviewed in the test)', () => {
    it.each(cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
        const r = judgeProducts(c.items.map(i => i.productId), c.method, CASE_RULES);
        expect(r.state).toBe(c.expect);
        expect(r.ruleId).toBe(c.ruleId);
        expect(r.pairProductIds).toEqual(c.pairProductIds);
        if (c.expect === 'red') {
            expect(r.why?.mr.length).toBeGreaterThan(0);
            expect(r.nowDo?.en.length).toBeGreaterThan(0);
            expect(r.nextTime?.mr.length).toBeGreaterThan(0);
            expect(r.sources.length).toBeGreaterThan(0);
        } else {
            expect(r.why).toBeNull();
            expect(r.sources).toEqual([]);
        }
    });
});

describe('combinationsOf', () => {
    it('CombinationsOf_SameEventMix_IsOneCombination', () => {
        const combos = combinationsOf([ev('e1', [['calcium nitrate'], ['19:19:19', '19:19:19']])]);
        expect(combos).toHaveLength(1);
        expect(combos[0].method).toBeNull();
        expect(combos[0].items).toEqual([
            { inputEventId: 'e1', mixIndex: 0, spokenName: 'calcium nitrate', npkGrade: null },
            { inputEventId: 'e1', mixIndex: 1, spokenName: '19:19:19', npkGrade: '19:19:19' },
        ]);
    });

    it('CombinationsOf_SharedMixIdAcrossEvents_IsOneCombination', () => {
        const combos = combinationsOf([
            ev('e1', [['calcium nitrate']], 'm1'),
            ev('e2', [['contof plus']]),
            ev('e3', [['19:19:19']], 'm1'),
        ]);
        expect(combos).toHaveLength(1);
        expect(combos[0].items.map(i => [i.inputEventId, i.mixIndex, i.spokenName])).toEqual([
            ['e1', 0, 'calcium nitrate'],
            ['e3', 0, '19:19:19'],
        ]);
    });

    it('CombinationsOf_SameDayDifferentEventsNoMixId_IsNone', () => {
        expect(combinationsOf([ev('e1', [['calcium nitrate']]), ev('e2', [['19:19:19']])])).toEqual([]);
        // A blank mixId groups nothing.
        expect(combinationsOf([ev('e1', [['calcium nitrate']], '  '), ev('e2', [['19:19:19']], '  ')])).toEqual([]);
    });

    it('a single product is no combination; missing or odd input is no combination', () => {
        expect(combinationsOf([ev('e1', [['calcium nitrate']])])).toEqual([]);
        expect(combinationsOf([])).toEqual([]);
        expect(combinationsOf(undefined)).toEqual([]);
        expect(combinationsOf([{ id: 'e1' } as unknown as InputEvent])).toEqual([]);
    });
});

describe('judgeMix', () => {
    it('Verdict_WithUnknownMember_IsGrey', () => {
        const r = judgeMix(tank(['Contof Plus'], ['प्रेम गोल्ड']), [fixture({})]);
        expect(r.state).toBe('grey');
        expect(r.ruleId).toBeNull();
        expect(r.pairProductIds).toEqual([]);
        // An ambiguous member is not known either.
        expect(judgeMix(tank(['Contof Plus'], ['ga3']), [fixture({})]).state).toBe('grey');
    });

    it('Verdict_UnknownThirdMember_KeepsTheRedPair (B004)', () => {
        const r = judgeMix(tank(['calcium nitrate'], ['प्रेम गोल्ड'], ['19:19:19', '19:19:19']), [fixture({})]);
        expect(r.state).toBe('red');
        expect(r.ruleId).toBe('T-NEVER');
        expect(r.pairProductIds).toEqual(['p-calcium-nitrate', 'p-npk-19-19-19']);
    });

    it('Verdict_AnyNeverPair_IsRed_EvenIfOtherPairsOk', () => {
        const okRule = fixture({ id: 'T-OK', verdict: 'ok', a: { productId: 'p-hexaconazole-5-sc' }, b: { tag: 'calcium-source' } });
        const neverRule = fixture({});
        const r = judgeProducts(['p-hexaconazole-5-sc', 'p-calcium-nitrate', 'p-npk-19-19-19'], 'Drip', [okRule, neverRule]);
        expect(r.state).toBe('red');
        expect(r.ruleId).toBe('T-NEVER');
        expect(r.pairProductIds).toEqual(['p-calcium-nitrate', 'p-npk-19-19-19']);
        // Green only when EVERY pair has an ok rule.
        const green = judgeProducts(['p-hexaconazole-5-sc', 'p-calcium-nitrate'], 'Drip', [okRule, neverRule]);
        expect(green.state).toBe('green');
        expect(green.pairProductIds).toEqual([]);
        expect(judgeProducts(['p-hexaconazole-5-sc', 'p-calcium-nitrate', 'p-gibberellic-acid-technical-90'], 'Drip', [okRule, neverRule]).state).toBe('grey');
        // An unknown member never lets a combination be green.
        expect(judgeProducts(['p-hexaconazole-5-sc', 'p-calcium-nitrate', null], 'Drip', [okRule, neverRule]).state).toBe('grey');
    });

    it('Verdict_UnreviewedRule_IsGrey (fixtures)', () => {
        const c = tank(['calcium nitrate'], ['19:19:19', '19:19:19']);
        expect(judgeMix(c, [fixture({ reviewedBy: null })]).state).toBe('grey');
        expect(judgeMix(c, [fixture({ reviewedOn: null })]).state).toBe('grey');
        expect(judgeMix(c, [fixture({ sources: [] })]).state).toBe('grey');
        expect(judgeMix(c, [fixture({})])).toMatchObject({ state: 'red', ruleId: 'T-NEVER' });
    });

    it.skipIf(SHIPPABLE_RULES.length > 0)(
        'live mix-rules.json: unreviewed R1/R2 give grey through the default judgeMix '
            + '(SKIPPED once the founder reviews a rule — then red is expected and this pin no longer applies)',
        () => {
            expect(judgeMix(tank(['calcium nitrate'], ['19:19:19', '19:19:19'])).state).toBe('grey');
            expect(judgeProducts(['p-calcium-nitrate', 'p-magnesium-sulphate'], 'Drip').state).toBe('grey');
        },
    );

    it('matches through his words: calcium nitrate + magnesium sulphate is R2', () => {
        expect(judgeMix(tank(['कॅल्शियम नायट्रेट'], ['Magnesium Sulphate']), CASE_RULES).ruleId).toBe('R2');
    });

    it('Judge_IsPure_DoesNotMutateInput', () => {
        const inputs = [ev('e1', [['calcium nitrate'], ['19:19:19', '19:19:19']], 'm1')];
        const rules = [fixture({})];
        const before = JSON.stringify(inputs);
        const rulesBefore = JSON.stringify(rules);
        const combos = combinationsOf(inputs);
        const comboBefore = JSON.stringify(combos);
        const first = judgeMix(combos[0], rules);
        const second = judgeMix(combos[0], rules);
        expect(JSON.stringify(inputs)).toBe(before);
        expect(JSON.stringify(combos)).toBe(comboBefore);
        expect(JSON.stringify(rules)).toBe(rulesBefore);
        expect(second).toEqual(first);
    });
});

describe('tank method (review B007)', () => {
    it('tankMethodOf maps the phone InputMethod and the content-document method strings', () => {
        expect(tankMethodOf('Drip')).toBe('fertigation');
        expect(tankMethodOf('fertigation')).toBe('fertigation');
        expect(tankMethodOf(' DRIP ')).toBe('fertigation');
        expect(tankMethodOf('Spray')).toBe('spray');
        expect(tankMethodOf('foliar')).toBe('spray');
        for (const m of ['Soil', 'Drenching', 'paste_manual', 'basal', '', null, undefined]) {
            expect(tankMethodOf(m), String(m)).toBeNull();
        }
    });

    it('a combination carries its events\' method; disagreement or silence is no method', () => {
        const agreed = combinationsOf([
            { ...ev('e1', [['calcium nitrate']], 'm1'), method: 'Drip' },
            { ...ev('e2', [['19:19:19']], 'm1'), method: 'fertigation' },
        ]);
        expect(agreed[0].method).toBe('fertigation');
        const disagree = combinationsOf([
            { ...ev('e1', [['calcium nitrate']], 'm1'), method: 'Drip' },
            { ...ev('e2', [['19:19:19']], 'm1'), method: 'Spray' },
        ]);
        expect(disagree[0].method).toBeNull();
        expect(judgeMix(disagree[0], [fixture({})]).state).toBe('grey');
        const oneSilent = combinationsOf([
            { ...ev('e1', [['calcium nitrate']], 'm1'), method: 'Drip' },
            ev('e2', [['19:19:19']], 'm1'),
        ]);
        expect(oneSilent[0].method).toBeNull();
    });

    it('Verdict_FiresOnlyForTankSolutions', () => {
        const names: Array<[string, string?]> = [['calcium nitrate'], ['19:19:19', '19:19:19']];
        const drip = judgeMix(tankBy('fertigation', ...names), [fixture({})]);
        expect(drip.state).toBe('red');
        expect(drip.pairProductIds).toEqual(['p-calcium-nitrate', 'p-npk-19-19-19']);
        expect(judgeMix(tankBy('spray', ...names), [fixture({})]).state).toBe('red');
        expect(judgeMix(tankBy(null, ...names), [fixture({})]).state).toBe('grey');
        expect(judgeProducts(['p-calcium-nitrate', 'p-npk-19-19-19'], 'Soil', [fixture({})]).state).toBe('grey');
        // A rule that names no method never fires.
        expect(judgeMix(tankBy('fertigation', ...names), [fixture({ appliesTo: undefined })]).state).toBe('grey');
        expect(judgeMix(tankBy('spray', ...names), [fixture({ appliesTo: ['fertigation'] })]).state).toBe('grey');
    });

    it('Verdict_SameProductTwice_IsNeverAPair', () => {
        // SSP carries calcium, phosphate and sulphate; two lines of it are still not a pair.
        expect(judgeProducts(['p-ssp', 'p-ssp'], 'Drip', [fixture({})]).state).toBe('grey');
        expect(judgeProducts(['p-polysulphate', 'p-polysulphate'], 'Drip', [fixture({})]).state).toBe('grey');
        expect(judgeProducts(['p-calcium-nitrate', 'p-calcium-nitrate'], 'Drip', [fixture({})]).state).toBe('grey');
        expect(judgeProducts(['p-ssp', 'p-dap-18-46-0'], 'Soil', [fixture({})]).state).toBe('grey');
    });
});

describe('isShippable', () => {
    it('needs reviewedBy, reviewedOn and one source with a title and a url', () => {
        expect(isShippable(fixture({}))).toBe(true);
        expect(isShippable(fixture({ reviewedBy: null }))).toBe(false);
        expect(isShippable(fixture({ reviewedOn: null }))).toBe(false);
        expect(isShippable(fixture({ reviewedBy: ' ' }))).toBe(false);
        expect(isShippable(fixture({ sources: [] }))).toBe(false);
        expect(isShippable(fixture({ sources: [{ ...SOURCE, title: ' ' }] }))).toBe(false);
        expect(isShippable(fixture({ sources: [{ ...SOURCE, url: '' }] }))).toBe(false);
        expect(isShippable(fixture({ sources: [{ ...SOURCE, url: '' }, SOURCE] }))).toBe(true);
    });

    it('every exported shippable rule passes isShippable', () => {
        for (const r of SHIPPABLE_RULES) expect(isShippable(r), r.id).toBe(true);
    });
});
