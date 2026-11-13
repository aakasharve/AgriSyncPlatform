/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132 Q4 = 1 with note, D-134)
 *
 * "बदलांची यादी": a CHANGE LIST, one line per change - what, when, who - worked out ON THE PHONE from the versions the pull carries
 * (previousVersionId chain). Not old versions to open. A pure function; the words are PROPOSED (the v3 page's own examples:
 * "सिंचन जोडलं — दिवस 10–40", "फवारणी काढली").
 */
import { describe, expect, it } from 'vitest';
import { buildOwnChains, parseOwnVersions } from '../ownScheduleModel';
import { changeEntries, diffVersions } from '../changeList';
import { OWNER, STAGES_A, TYPIST, WORKS_A, id, ownRow, type RawOwn } from './ownFixtures';

const chainOf = (...rows: RawOwn[]) => buildOwnChains(parseOwnVersions(rows.map(ownRow)))[0];
const names: Record<string, string> = { [OWNER]: 'संजय', [TYPIST]: 'सुनील' };
const nameOf = (userId: string | null): string | null => (userId ? names[userId] ?? null : null);
const texts = (chain: ReturnType<typeof chainOf>, language: 'mr' | 'en' = 'mr') => changeEntries(chain, { nameOf, language });

const v1: RawOwn = { id: id(1), stages: STAGES_A, activities: WORKS_A, madeAtUtc: '2026-11-04T05:00:00Z' };
const next = (n: number, over: Partial<RawOwn>): RawOwn => ({ id: id(n), version: n, previousVersionId: id(n - 1), stages: STAGES_A, activities: WORKS_A, madeAtUtc: `2026-11-0${3 + n}T05:00:00Z`, ...over });

describe('the first version', () => {
    it('First_version_with_works_was_copied_from_a_checked_schedule', () => {
        const [line] = texts(chainOf(v1));
        expect(line.text).toBe('तपासलेल्या शेड्यूलवरून बनवलं');
        expect(line.version).toBe(1);
    });
    it('First_version_with_no_work_was_built_from_blank', () => {
        const [line] = texts(chainOf({ id: id(1) }));
        expect(line.text).toBe('शेड्यूल बनवलं');
    });
    it('A_version_whose_previous_row_the_phone_does_not_hold_gives_no_line_not_a_made_up_one', () => {
        expect(texts(chainOf(next(5, { previousVersionId: id(4) })))).toEqual([]);
    });
});

describe('a later version: one line per change', () => {
    it('Work_added_names_the_work_and_its_days: "सिंचन जोडलं — दिवस 10–40"', () => {
        const chain = chainOf(
            { id: id(1), stages: [{ name: 'अ', startDay: 0, endDay: 60 }], activities: [{ name: 'घड विरळणी', startDay: 38, endDay: 38 }] },
            { id: id(2), version: 2, previousVersionId: id(1), stages: [{ name: 'अ', startDay: 0, endDay: 60 }], activities: [{ name: 'घड विरळणी', startDay: 38, endDay: 38 }, { name: 'सिंचन', part: 'Irrigation', startDay: 10, endDay: 40 }] },
        );
        expect(texts(chain)[0].text).toBe('सिंचन जोडलं — दिवस 10–40');
    });
    it('Work_added_that_repeats_also_says_how_often', () => {
        const chain = chainOf(
            { id: id(1), stages: STAGES_A, activities: [WORKS_A[2]] },
            next(2, { activities: [WORKS_A[2], WORKS_A[0]] }),
        );
        expect(texts(chain)[0].text).toBe('ठिबक सिंचन जोडलं — दिवस 31–60 · दर 5 दिवसांनी');
    });
    it('Work_removed: "फवारणी काढली" for a word that ends in ी, "काढलं" for the others', () => {
        const chain = chainOf(
            { id: id(1), stages: STAGES_A, activities: [{ name: 'फवारणी', part: 'Spray', startDay: 34, endDay: 55 }, { name: 'सिंचन', part: 'Irrigation', startDay: 31, endDay: 31 }] },
            next(2, { activities: [{ name: 'सिंचन', part: 'Irrigation', startDay: 31, endDay: 31 }] }),
            next(3, { activities: [] }),
        );
        const all = texts(chain).map(l => l.text);
        expect(all).toContain('फवारणी काढली');
        expect(all).toContain('सिंचन काढलं');
    });
    it('Work_changed_says_the_new_days_and_how_often_only_when_the_repeat_changed', () => {
        const base = { name: 'बुरशीनाशक फवारणी', part: 'Spray', startDay: 34, endDay: 55, frequencyMode: 'every_n_days' as const, intervalDays: 7 };
        const days = chainOf({ id: id(1), stages: STAGES_A, activities: [base] }, next(2, { activities: [{ ...base, endDay: 58 }] }));
        expect(texts(days)[0].text).toBe('बुरशीनाशक फवारणी बदलली — दिवस 34–58');
        const often = chainOf({ id: id(1), stages: STAGES_A, activities: [base] }, next(2, { activities: [{ ...base, intervalDays: 10 }] }));
        expect(texts(often)[0].text).toBe('बुरशीनाशक फवारणी बदलली — दिवस 34–55 · दर 10 दिवसांनी');
    });
    it('A_work_on_one_day_says_"दिवस N" and a weekly one says "आठवड्यातून N वेळा"', () => {
        const chain = chainOf(
            { id: id(1), stages: STAGES_A, activities: [WORKS_A[2]] },
            next(2, { activities: [WORKS_A[2], { name: 'तण काढणी', part: 'Work', startDay: 40, endDay: 50, frequencyMode: 'per_week', intervalDays: 2 }] }),
        );
        expect(texts(chain)[0].text).toBe('तण काढणी जोडली — दिवस 40–50 · आठवड्यातून 2 वेळा');
    });
    it('Stage_added_removed_and_changed_are_lines_of_their_own', () => {
        const chain = chainOf(
            { id: id(1), stages: STAGES_A, activities: WORKS_A },
            next(2, { stages: [...STAGES_A, { name: 'काढणी', startDay: 101, endDay: 120 }] }),
            next(3, { stages: [...STAGES_A.slice(0, 3), { name: 'फळवाढ', startDay: 61, endDay: 110 }, { name: 'काढणी', startDay: 101, endDay: 120 }] }),
            next(4, { stages: STAGES_A.slice(0, 3) }),
        );
        const t = texts(chain).map(l => l.text);
        expect(t).toContain('स्टेज जोडली — काढणी · दिवस 101–120');
        expect(t).toContain('स्टेज बदलली — फळवाढ · दिवस 61–110');
        expect(t).toContain('स्टेज काढली — फळवाढ');
    });
    it('A_rename_is_a_line', () => {
        const chain = chainOf(v1, next(2, { name: 'द्राक्ष — नाशिक' }));
        expect(texts(chain)[0].text).toBe('नाव बदललं: द्राक्ष — नाशिक');
    });
    it('Made_for_tag_set_changed_or_removed_is_a_line_with_the_list_label', () => {
        const chain = chainOf(
            { ...v1, soilType: 'black' },
            next(2, { soilType: 'red', variety: 'Thompson Seedless' }),
            next(3, { soilType: null, variety: 'Thompson Seedless' }),
        );
        const t = texts(chain).map(l => l.text);
        expect(t).toContain('यासाठी बनवलं: माती तांबडी');
        expect(t).toContain('यासाठी बनवलं: वाण Thompson Seedless');
        expect(t).toContain('यासाठी बनवलं: माती काढलं');
    });
    it('A_version_that_changed_nothing_gives_no_line', () => {
        expect(texts(chainOf(v1, next(2, {}))).filter(l => l.version === 2)).toEqual([]);
    });
});

describe('each line carries its date and the person\'s name', () => {
    it('Newest_first_with_the_date_of_that_version_and_the_name_that_typed_it', () => {
        const chain = chainOf(
            v1,
            next(2, { madeByUserId: TYPIST, madeAtUtc: '2026-11-07T05:00:00Z', activities: [...WORKS_A, { name: 'सिंचन', part: 'Irrigation', startDay: 10, endDay: 40 }] }),
        );
        const lines = texts(chain);
        expect(lines.map(l => l.version)).toEqual([2, 1]);
        expect(lines[0].byName).toBe('सुनील');
        expect(lines[0].dateLabel).toMatch(/^7 नोव्हें/);
        expect(lines[1].byName).toBe('संजय');
        expect(lines[1].dateLabel).toMatch(/^4 नोव्हें/);
    });
    it('A_person_the_phone_has_no_name_for_gives_no_name_never_an_id', () => {
        const chain = chainOf({ ...v1, madeByUserId: 'ffffffff-0000-4000-8000-00000000000f' });
        const [line] = texts(chain);
        expect(line.byName).toBeNull();
        expect(JSON.stringify(line)).not.toContain('ffffffff');
    });
    it('A_version_with_no_date_gives_no_date', () => {
        const [line] = texts(chainOf({ ...v1, madeAtUtc: null }));
        expect(line.dateLabel).toBeNull();
    });
    it('Only_the_first_line_of_a_version_says_the_version_number', () => {
        const chain = chainOf(
            v1,
            next(2, { activities: [], stages: STAGES_A }),
        );
        const v2 = texts(chain).filter(l => l.version === 2);
        expect(v2.length).toBeGreaterThan(1);
        expect(v2.map(l => l.showVersion)).toEqual([true, ...v2.slice(1).map(() => false)]);
    });
});

describe('English mode shows English only', () => {
    it('Lines_are_English_words_with_the_English_label_of_the_tag', () => {
        const chain = chainOf(
            { id: id(1), stages: STAGES_A, activities: [WORKS_A[2]], soilType: 'black' },
            next(2, { activities: [WORKS_A[2], WORKS_A[0]], soilType: 'red' }),
        );
        const t = texts(chain, 'en').map(l => l.text);
        expect(t).toContain('ठिबक सिंचन added — days 31–60 · every 5 days');
        expect(t).toContain('Made for: soil Red');
        expect(t.join(' ')).not.toMatch(/[ऀ-ॿ]{3,} (जोडलं|जोडली|काढलं|काढली)/);
    });
});

describe('diffVersions: structured, before any words', () => {
    it('Reports_kinds', () => {
        const [a, b] = chainOf(v1, next(2, { activities: WORKS_A.slice(0, 2), name: 'नवं' })).versions;
        expect(diffVersions(a, b).map(i => i.kind)).toEqual(['renamed', 'workRemoved']);
    });
});
