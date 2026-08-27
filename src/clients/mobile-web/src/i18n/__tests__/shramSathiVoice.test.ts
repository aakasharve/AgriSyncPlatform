/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Shram Sathi voice — the ONE place the farmer-facing wording is pinned.
 *
 * PROPOSED COPY, PENDING FOUNDER CONFIRMATION. Every Marathi string asserted
 * below comes from the CTO ruling of 2026-08-13 (`cto-rulings.md` §1.3). The
 * founder is the Marathi authority. If he revises a string, THIS is the file
 * that gets revised — deliberately, in one place, rather than by a dozen
 * behavioural tests failing for reasons that have nothing to do with behaviour.
 *
 * WHY THE COPY IS PINNED HERE AND NOWHERE ELSE
 * --------------------------------------------
 * The tests that exercise the save path assert the SHAPE of a sentence (phone
 * claim first, counts off the enqueue result, language selects the template) by
 * resolving the tail through i18n. That would be tautological if it were the
 * only assertion — a corrupted string would satisfy it perfectly. This file is
 * the independent oracle that makes the pair meaningful: literals here, shape
 * there.
 *
 * The three chip labels (`sync.onPhone` / `onServer` / `needsFix`) are pinned
 * in `features/sync/status/__tests__/syncHonestyState.test.ts` and stay there;
 * the wave that reframes them moves those literals, not these.
 */
import { describe, it, expect } from 'vitest';

import { t, tf, type Language } from '../translations';

const LANGUAGES: Language[] = ['en', 'mr'];

describe('the tails a save sentence ends in — approved wording', () => {
    it('renders the proposed Marathi', () => {
        expect(t('sync.notFiledCountTail', 'mr'))
            .toBe('{handled} पैकी {skipped} शेतनोंदीत जाणार नाहीत.');
        expect(t('sync.notFiledBadgeTail', 'mr'))
            .toBe('शेतनोंदीत जाणार नाही');
        expect(t('sync.correctionsFiledTailMany', 'mr'))
            .toBe('{count} दुरुस्त्या शेतनोंदीत गेल्या.');
        expect(t('sync.unsentEditTail', 'mr'))
            .toBe('बाकीचे बदल शेतनोंदीत जाणार नाहीत.');
    });

    it('renders the proposed English', () => {
        expect(t('sync.notFiledCountTail', 'en'))
            .toBe('{skipped} of {handled} will not reach your farm records.');
        expect(t('sync.notFiledBadgeTail', 'en'))
            .toBe('will not reach your farm records');
        expect(t('sync.correctionsFiledTailOne', 'en'))
            .toBe('{count} labour correction reached your farm records.');
        expect(t('sync.correctionsFiledTailMany', 'en'))
            .toBe('{count} labour corrections reached your farm records.');
        expect(t('sync.unsentEditTail', 'en'))
            .toBe('The rest of this edit will not reach your farm records.');
    });

    it('the unsent-edit tail reuses the approved clause, so only two words are new', () => {
        // FINAL REVIEW F-1. The Marathi verb phrase is lifted VERBATIM from the
        // approved `notFiledCountTail`; `बाकीचे बदल` is the only string in this
        // file no ruling has blessed yet, and it is on the founder-copy list.
        // If someone rewords the approved clause, this stops holding and says so.
        expect(t('sync.unsentEditTail', 'mr')).toContain('शेतनोंदीत जाणार नाहीत');
        expect(t('sync.notFiledCountTail', 'mr')).toContain('शेतनोंदीत जाणार नाहीत');
        expect(t('sync.unsentEditTail', 'en')).toContain('will not reach your farm records');
    });

    it('Marathi has ONE corrections form, because no singular was approved', () => {
        // The CTO supplied the plural clause only. Inflecting a singular from it
        // would be an agent inventing farmer-facing Marathi, which no
        // implementer in this phase has done and none may start doing. The
        // approved plural is used at every count and is on the founder-copy
        // list. If this assertion ever fails, someone invented a form.
        expect(t('sync.correctionsFiledTailOne', 'mr'))
            .toBe(t('sync.correctionsFiledTailMany', 'mr'));

        // English keeps the split the shipped code already had, so the two must
        // NOT be equal there — proving the single Marathi form is a deliberate
        // language-specific decision rather than a copy-paste slip.
        expect(t('sync.correctionsFiledTailOne', 'en'))
            .not.toBe(t('sync.correctionsFiledTailMany', 'en'));
    });
});

describe('word order — the defect a translation review would have shipped', () => {
    /**
     * Marathi `X पैकी Y` means "Y out of X": the TOTAL binds before `पैकी` and
     * the SUBSET after — the mirror of English "Y of X".
     *
     * The proposed copy illustrated this clause at `३ पैकी ३`, where 3 of 3
     * makes the order invisible. Transcribing it as `{skipped} पैकी {handled}`
     * compiles, reads like Marathi, passes every shape test, and tells a farmer
     * who dropped 2 of 3 records that he dropped 3 of 2.
     *
     * The order asserted here is not an opinion: it is this file's own
     * precedent. `dfes.daysLoggedThisWeek` ships as
     *   en `'You logged {logged} of {count} days this week'`
     *   mr `'या आठवड्यात {count} पैकी {logged} दिवस नोंद'`
     * — total before `पैकी`, subset after.
     */
    it('Marathi puts the TOTAL before पैकी and the SUBSET after', () => {
        const mr = t('sync.notFiledCountTail', 'mr');
        expect(mr.indexOf('{handled}')).toBeLessThan(mr.indexOf('{skipped}'));
        expect(mr).toContain('पैकी');
    });

    it('English puts them the other way round, as English does', () => {
        const en = t('sync.notFiledCountTail', 'en');
        expect(en.indexOf('{skipped}')).toBeLessThan(en.indexOf('{handled}'));
    });

    it('agrees with the precedent already shipped in this file', () => {
        // If someone "fixes" daysLoggedThisWeek to match English order, the
        // reasoning above stops being true and this test says so.
        const mr = t('dfes.daysLoggedThisWeek', 'mr');
        expect(mr.indexOf('{count}')).toBeLessThan(mr.indexOf('{logged}'));
    });

    it('a real 2-of-3 partial save reads as 2 dropped, not 3', () => {
        // The end-to-end form of the same guard, with numbers a human can check.
        expect(tf('sync.notFiledCountTail', 'mr', { skipped: 2, handled: 3 }))
            .toBe('3 पैकी 2 शेतनोंदीत जाणार नाहीत.');
        expect(tf('sync.notFiledCountTail', 'en', { skipped: 2, handled: 3 }))
            .toBe('2 of 3 will not reach your farm records.');
    });
});

describe('what these sentences are forbidden to say', () => {
    const tails = [
        'sync.notFiledCountTail',
        'sync.notFiledBadgeTail',
        'sync.correctionsFiledTailOne',
        'sync.correctionsFiledTailMany',
        'sync.unsentEditTail',
    ];

    it('a record that will never be sent is never promised a "yet"', () => {
        // Finding B3. A skipped log `continue`s before any queue row is written,
        // so no worker will ever pick it up and no drawer can list it. "not yet"
        // is a promise the code cannot keep.
        //
        // `unsentEditTail` joins them (final review F-1) on the same evidence:
        // `updateLog` POSTs labour corrections and enqueues nothing, so the rest
        // of an edit has no queue row, no worker and no retry either.
        for (const key of ['sync.notFiledCountTail', 'sync.notFiledBadgeTail', 'sync.unsentEditTail']) {
            expect(t(key, 'en').toLowerCase()).not.toContain('yet');
            expect(t(key, 'mr')).not.toContain('अजून');
            expect(t(key, 'en').toLowerCase()).toContain('will not');
        }
    });

    it('never sends the farmer somewhere to check, because there is nowhere', () => {
        for (const key of tails) {
            expect(t(key, 'mr')).not.toContain('तपासा');
            expect(t(key, 'en').toLowerCase()).not.toContain('check');
        }
    });

    it('the not-filed tails claim nothing about the server', () => {
        for (const key of ['sync.notFiledCountTail', 'sync.notFiledBadgeTail']) {
            expect(t(key, 'mr')).not.toContain('पाठवलं');
            expect(t(key, 'en').toLowerCase()).not.toContain('sent');
        }
    });

    it('every Marathi tail is actually in Devanagari', () => {
        for (const key of tails) {
            expect(/[ऀ-ॿ]/.test(t(key, 'mr'))).toBe(true);
        }
    });

    it('no tail resolves to its own key in either language', () => {
        // `t()` returns the KEY on a miss, so a typo renders
        // `sync.notFiledCountTail` inside a toast rather than throwing.
        for (const key of tails) {
            for (const language of LANGUAGES) {
                expect(t(key, language)).not.toBe(key);
            }
        }
    });
});

describe('tf — placeholder substitution', () => {
    it('fills every placeholder it is given', () => {
        expect(tf('sync.correctionsFiledTailMany', 'en', { count: 4 }))
            .toBe('4 labour corrections reached your farm records.');
    });

    it('leaves an unknown placeholder STANDING rather than blanking it', () => {
        // Blanking would turn "3 of 5 will not reach…" into "3 of will not
        // reach…" — a sentence that still reads like a sentence while having
        // lost a number. A visible `{handled}` is a bug report; a silent gap is
        // a wrong statement to a farmer (`P4`).
        expect(tf('sync.notFiledCountTail', 'en', { skipped: 3 }))
            .toBe('3 of {handled} will not reach your farm records.');
    });

    it('substitutes nothing when given nothing, and does not throw', () => {
        expect(tf('sync.notFiledCountTail', 'en'))
            .toBe('{skipped} of {handled} will not reach your farm records.');
    });

    it('leaves a string with no placeholders untouched', () => {
        expect(tf('sync.notFiledBadgeTail', 'mr')).toBe(t('sync.notFiledBadgeTail', 'mr'));
    });

    it('substitutes the same placeholder everywhere it appears', () => {
        // Guards the `g` flag: a template that names one variable twice must not
        // fill only the first.
        expect(tf('dfes.updated', 'en', { field: 'workers', oldValue: '8', newValue: '6' }))
            .toBe('Updated: workers was 8, now 6');
    });

    it('falls back to English when no language is given, like t()', () => {
        expect(tf('sync.notFiledBadgeTail')).toBe(t('sync.notFiledBadgeTail', 'en'));
    });
});
