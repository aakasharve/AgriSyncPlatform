/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Pins the three constraints `dataFreshnessTranslations.ts` exists to hold —
 * the founder's own ban on the word "sync", the fact-not-reassurance rule,
 * and the honest unknown — plus the Marathi provenance claims its header
 * makes, checked against the shipped strings they cite rather than against
 * a second copy of themselves.
 */
import { describe, it, expect } from 'vitest';

import {
    dataFreshnessTranslations,
    resolveDataFreshnessString,
    PENDING_FOUNDER_STRINGS,
    FOUNDER_REVIEW_WORDS,
    type DataFreshnessTranslations,
} from '../dataFreshnessTranslations';
import { oversightTranslations } from '../oversightTranslations';
import { translations } from '../translations';

const LANGUAGES = ['en', 'mr'] as const;
const KEYS = Object.keys(dataFreshnessTranslations.en) as (keyof DataFreshnessTranslations)[];

describe('dataFreshnessTranslations — the founder banned one word', () => {
    it('never says "sync", in either language, in any key', () => {
        // His constraint, verbatim: "last timing of the sync — NOT TO MENTION
        // SYNC AS A WORD". Asserted over the whole table rather than over the
        // two keys that exist today, so a key added later inherits the rule.
        for (const language of LANGUAGES) {
            for (const key of KEYS) {
                const value = dataFreshnessTranslations[language][key].toLowerCase();
                expect(value, `${language}.${key}`).not.toContain('sync');
                // The transliterations a Marathi reword would reach for.
                expect(value, `${language}.${key}`).not.toContain('सिंक');
                expect(value, `${language}.${key}`).not.toContain('सिन्क');
            }
        }
    });
});

describe('dataFreshnessTranslations — a fact, never a reassurance', () => {
    it('never claims everything is up to date', () => {
        // THIS IS THE CLAIM THE WHOLE CHIP EXISTS TO AVOID. "Everything is up
        // to date" is false the moment a sathi's record has not arrived yet,
        // which is the defect the oversight tray already has
        // (`oversightSelectors.ts` classifies "unseen" from each record's
        // CREATION time). A freshness line that reassures instead of stating
        // would make that defect worse, not visible.
        const en = dataFreshnessTranslations.en;
        for (const key of KEYS) {
            const value = en[key].toLowerCase();
            expect(value, `en.${key}`).not.toContain('up to date');
            expect(value, `en.${key}`).not.toContain('everything');
            expect(value, `en.${key}`).not.toContain('all your');
        }
        // The known form states a floor and names the instant it is a floor
        // for; it does not say what is NOT here, because nothing on this
        // screen knows that.
        expect(en.showingWorkUpTo).toContain('{when}');
        expect(en.showingWorkUpTo.startsWith('Showing work up to')).toBe(true);
    });

    it('the unknown form admits it cannot state a time, and still carries the hint', () => {
        // `lastSyncAt` is null both before the first Dexie read and on a
        // device that never completed a pull. Neither may borrow the known
        // form's `{when}`.
        expect(dataFreshnessTranslations.en.showingWorkUpToUnknown).not.toContain('{when}');
        expect(dataFreshnessTranslations.mr.showingWorkUpToUnknown).not.toContain('{when}');

        // The connectivity hint is the one actionable half of the line, so it
        // survives into the state where the rest of the sentence cannot be
        // said. Compared against the KNOWN form's own tail, not a literal, so
        // a reword of one that forgets the other trips here.
        for (const language of LANGUAGES) {
            const hint = dataFreshnessTranslations[language].showingWorkUpTo.split('. ')[1];
            expect(hint, `${language} hint`).toBeTruthy();
            expect(dataFreshnessTranslations[language].showingWorkUpToUnknown).toContain(hint);
        }
    });
});

describe('dataFreshnessTranslations — Marathi provenance is checked, not asserted', () => {
    it('पर्यन्त keeps the founder\'s spelling, never normalised to पर्यंत', () => {
        // His spelling, carried by `restState` and `unsendableRecordsLine`.
        // Normalising it is the exact "correction" a spell-checking agent
        // makes without noticing.
        expect(oversightTranslations.mr.restState).toContain('पर्यन्त');
        expect(dataFreshnessTranslations.mr.showingWorkUpTo).toContain('पर्यन्त');
        expect(dataFreshnessTranslations.mr.showingWorkUpTo).not.toContain('पर्यंत');
        expect(dataFreshnessTranslations.mr.showingWorkUpToUnknown).not.toContain('पर्यंत');
    });

    it('the work noun is the app\'s own कामे, and never नोंदी', () => {
        // `oversightTranslations.mr.entries` is the settled word for a
        // farmer's work in this feature. `नोंदी` is contested — see that
        // file's header on `failedSends` — so it stays out.
        expect(dataFreshnessTranslations.mr.showingWorkUpTo).toContain(oversightTranslations.mr.entries);
        expect(dataFreshnessTranslations.mr.showingWorkUpTo).not.toContain('नोंदी');
        expect(dataFreshnessTranslations.mr.showingWorkUpToUnknown).not.toContain('नोंदी');
    });

    it('the unknown form borrows the founder\'s own way of admitting it cannot say', () => {
        // Lifted from `unknownState` ('निश्चित सांगता येत नाही की सर्व कामे झाली'),
        // his words. If that string is ever reworded away from this clause,
        // this fails and the borrowing is re-decided rather than drifting.
        expect(oversightTranslations.mr.unknownState).toContain('सांगता येत नाही');
        expect(dataFreshnessTranslations.mr.showingWorkUpToUnknown).toContain('सांगता येत नाही');
    });

    it('the day labels are the shipped आज / काल, not a new pair', () => {
        expect(dataFreshnessTranslations.mr.dayToday).toBe(translations.mr.logPage.today);
        expect(dataFreshnessTranslations.mr.dayYesterday).toBe(translations.mr.logPage.yesterday);
        expect(dataFreshnessTranslations.en.dayToday).toBe(translations.en.logPage.today);
        expect(dataFreshnessTranslations.en.dayYesterday).toBe(translations.en.logPage.yesterday);
    });

    it('the connectivity hint borrows no decision verb', () => {
        // `खात्री करा` is the founder's phrase for "make sure" — and in this
        // app it is also `dfes.verify`'s entire label, i.e. VERIFYING A
        // RECORD. `oversightTranslations.ts` bans it from `seenControl` for
        // that reason. A connectivity hint reviews nothing, so it may not
        // carry a review verb.
        for (const key of KEYS) {
            expect(dataFreshnessTranslations.mr[key], `mr.${key}`).not.toContain('खात्री');
            expect(dataFreshnessTranslations.mr[key], `mr.${key}`).not.toContain('मंजूर');
        }
    });

    it('every word this module invented is declared for the founder, and none is silent', () => {
        // The point of `FOUNDER_REVIEW_WORDS` is that the founder is ASKED
        // rather than told. A listed word that no longer appears anywhere is
        // a stale question; an unlisted invention is a silent decision.
        expect(FOUNDER_REVIEW_WORDS.length).toBeGreaterThan(0);
        const allMarathi = KEYS.map((k) => dataFreshnessTranslations.mr[k]).join(' ');
        for (const word of FOUNDER_REVIEW_WORDS) {
            expect(allMarathi, word).toContain(word);
        }
        // `इंटरनेट` is the one with no precedent ANYWHERE under `src/clients/`
        // — named explicitly so a future reword cannot drop it off the list
        // while keeping it on screen.
        expect(FOUNDER_REVIEW_WORDS).toContain('इंटरनेट');
    });
});

describe('dataFreshnessTranslations — the module contract', () => {
    it('the en and mr blocks declare exactly the same key set', () => {
        expect(Object.keys(dataFreshnessTranslations.mr).sort()).toEqual([...KEYS].sort());
    });

    it('no key is hollow, and PENDING_FOUNDER_STRINGS says so', () => {
        const hollow = KEYS.filter((k) => dataFreshnessTranslations.mr[k] === '');
        expect(hollow).toEqual([...PENDING_FOUNDER_STRINGS]);
        expect(hollow).toEqual([]);
    });

    it('resolve never returns an empty string, in either language', () => {
        for (const language of LANGUAGES) {
            for (const key of KEYS) {
                expect(resolveDataFreshnessString(language, key), `${language}.${key}`).not.toBe('');
            }
        }
    });
});
