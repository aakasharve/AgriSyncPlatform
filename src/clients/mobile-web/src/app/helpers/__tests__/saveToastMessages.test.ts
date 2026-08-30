/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The save sentences, tested without a React tree.
 *
 * These assertions used to require `renderHook`, a mocked `LogCommandService`,
 * a mocked DataSource, a mocked LanguageContext and a mocked sync service — five
 * fakes to find out what a string says. `useLogCommands.saveTruth.test.ts` still
 * owns the question these cannot answer (does the RIGHT sentence fire on the
 * right branch, and does the screen agree with the toast); what moved here is
 * the question that never needed a render.
 *
 * The composition is the property under test. The wording is pinned separately
 * in `i18n/__tests__/shramSathiVoice.test.ts`.
 */
import { describe, it, expect } from 'vitest';

import {
    buildEditSavedMessage,
    buildSkippedSyncToast,
    onPhoneClaim,
} from '../saveToastMessages';
import { t, tf, type Language } from '../../../i18n/translations';

const LANGUAGES: Language[] = ['mr', 'en'];

describe('buildSkippedSyncToast — the honest partial save', () => {
    it('says nothing at all when everything was queued', () => {
        // The happy path must stay byte-identical: `null` is the caller's
        // signal that its own success wording is legitimate.
        expect(buildSkippedSyncToast({ queuedLogIds: ['1'], skippedLogIds: [] }, 'mr'))
            .toBeNull();
    });

    it('says nothing when no enqueue was attempted at all (demo mode)', () => {
        // `null` outcome is not "everything failed" — it is no evidence in
        // either direction, and a claim either way would be fabricated (`P4`).
        expect(buildSkippedSyncToast(null, 'mr')).toBeNull();
    });

    for (const language of LANGUAGES) {
        it(`${language}: leads with the phone claim, so the farmer does not re-record`, () => {
            const toast = buildSkippedSyncToast(
                { queuedLogIds: [], skippedLogIds: ['1'] },
                language,
            );

            // Not "contains" — FIRST. A farmer scanning a coloured toast reads
            // the opening words; if the news lands before the reassurance they
            // read "gone" and record the day again (finding B4).
            expect(toast?.message.startsWith(onPhoneClaim(language))).toBe(true);
        });

        it(`${language}: the whole sentence is in one script`, () => {
            // The defect this module was extracted to fix: the tail used to be
            // a hardcoded English fragment, so a Marathi farmer read
            // `फोनवर सेव्ह ✓ — 3 of 3 cannot be sent.` — one sentence, two
            // scripts, and a half no translator could ever reach.
            const toast = buildSkippedSyncToast(
                { queuedLogIds: [], skippedLogIds: ['1'] },
                language,
            );
            const hasDevanagari = /[ऀ-ॿ]/.test(toast!.message);
            // Latin letters, ignoring the digits and the ✓ both scripts share.
            const hasLatinWords = /[A-Za-z]{2,}/.test(toast!.message);

            expect(hasDevanagari).toBe(language === 'mr');
            expect(hasLatinWords).toBe(language === 'en');
        });
    }

    it('reports the dropped count and never rounds it up', () => {
        const toast = buildSkippedSyncToast(
            { queuedLogIds: ['1'], skippedLogIds: ['2', '3'] },
            'en',
        );

        // 2 dropped out of 3 handled. Both numbers come off the outcome object,
        // never off the submitted set, so a partial save can never present
        // itself as a total one.
        expect(toast?.message).toContain('2 of 3');
        expect(toast?.message).not.toContain('3 of 3');
    });

    it('counts the TOTAL as queued + skipped, not as either alone', () => {
        const toast = buildSkippedSyncToast(
            { queuedLogIds: ['1', '2'], skippedLogIds: ['3'] },
            'en',
        );
        expect(toast?.message).toContain('1 of 3');
    });

    it('the Marathi sentence reports the same two numbers, in Marathi order', () => {
        const toast = buildSkippedSyncToast(
            { queuedLogIds: ['1'], skippedLogIds: ['2', '3'] },
            'mr',
        );
        // `X पैकी Y` = "Y out of X" — total first. Reversing these would tell a
        // farmer who dropped 2 of 3 that he dropped 3 of 2.
        expect(toast?.message).toContain('3 पैकी 2');
    });

    it('is amber, not red — nothing failed, some of it has nowhere to go', () => {
        // A red panel with an X is read before its words are. `'partial'` also
        // buys the sentence its reading time: ActionToast gives it 7000ms where
        // `'error'` gets 3000.
        const toast = buildSkippedSyncToast({ queuedLogIds: [], skippedLogIds: ['1'] }, 'mr');
        expect(toast?.type).toBe('partial');
    });

    it('never tells the farmer to go and check', () => {
        // There is nowhere to check: a skipped log reaches no queue, so no
        // worker retries it and the drawer cannot list it (finding B3).
        for (const language of LANGUAGES) {
            const toast = buildSkippedSyncToast({ queuedLogIds: [], skippedLogIds: ['1'] }, language);
            expect(toast!.message).not.toContain('तपासा');
            expect(toast!.message.toLowerCase()).not.toContain('check');
        }
    });
});

describe('buildEditSavedMessage — two true things, and no more', () => {
    it('claims only the phone when nothing reached the server', () => {
        // The normal case: a farmer who fixed an irrigation figure sent nothing
        // because there was nothing labour-shaped to send. Announcing that
        // absence would be a nag on the correction path (`P9`), so the sentence
        // stops (`P4` cuts both ways — no claim beats a claim with no use).
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(0, language)).toBe(onPhoneClaim(language));
        }
    });

    it('treats a negative or missing count as no server claim', () => {
        // Defensive, and the honest direction: the caller passes
        // `result.persistedLabourCorrections ?? 0`, and a nonsense value must
        // never become a fabricated receipt.
        expect(buildEditSavedMessage(-1, 'en')).toBe(onPhoneClaim('en'));
    });

    it('names what the server accepted, beside the phone claim, when it did', () => {
        const message = buildEditSavedMessage(2, 'en');
        expect(message.startsWith(onPhoneClaim('en'))).toBe(true);
        expect(message).toContain(tf('sync.correctionsFiledTailMany', 'en', { count: 2 }));
    });

    it('one correction reads as one, not as "1 corrections", in English', () => {
        expect(buildEditSavedMessage(1, 'en')).toContain('1 labour correction reached');
        expect(buildEditSavedMessage(1, 'en')).not.toContain('corrections');
    });

    it('uses the approved Marathi clause at every count', () => {
        // No singular Marathi form was approved and no agent may inflect one,
        // so both counts render the approved plural. Listed for the founder.
        expect(buildEditSavedMessage(1, 'mr')).toContain(t('sync.correctionsFiledTailMany', 'mr').replace('{count}', '1'));
        expect(buildEditSavedMessage(3, 'mr')).toContain(t('sync.correctionsFiledTailMany', 'mr').replace('{count}', '3'));
    });

    it('R19 stays executed — no screen-only caveat comes back', () => {
        // The pre-Phase-4 sentence ("shown on screen only — not saved
        // anywhere") described a missing feature truthfully. `updateLog`
        // persists now, so reviving it would tell a farmer their saved
        // correction was not saved, teaching them to distrust a flow that works
        // and to re-enter it.
        for (const count of [0, 1, 2]) {
            for (const language of LANGUAGES) {
                const message = buildEditSavedMessage(count, language);
                expect(message.toLowerCase()).not.toContain('screen only');
                expect(message.toLowerCase()).not.toContain('not saved');
                expect(message).not.toContain('स्क्रीनवर');
            }
        }
    });

    it('never claims the server on the strength of a local write', () => {
        // `sync.onServer` is produced by a real acknowledgement and nothing
        // else. A local save is not one.
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(0, language)).not.toContain(t('sync.onServer', language));
        }
    });
});

describe('buildEditSavedMessage — the half no server call carried (final review F-1)', () => {
    it('says nothing extra when the whole edit was sent', () => {
        // The happy path stays byte-identical, in both branches. A caveat on
        // every edit would be a nag on the correction path (`P9`).
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(0, language, false)).toBe(buildEditSavedMessage(0, language));
            expect(buildEditSavedMessage(2, language, false)).toBe(buildEditSavedMessage(2, language));
        }
    });

    it('defaults to silence, so an unaware caller cannot confess by accident', () => {
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(1, language)).not.toContain(t('sync.unsentEditTail', language));
        }
    });

    it('names the unsent half beside the corrections that DID land', () => {
        // THE GUARD `R19` REMOVED. A farmer who fixed a headcount and an
        // irrigation figure in one submit had the labour correction announced
        // and the irrigation silently reverted by the pull that same correction
        // guaranteed.
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(1, language, true);

            expect(message.startsWith(onPhoneClaim(language))).toBe(true);
            expect(message).toContain(tf('sync.correctionsFiledTailOne', language, { count: 1 }));
            expect(message).toContain(t('sync.unsentEditTail', language));
            // Order: what landed, then what did not. The news the farmer can do
            // nothing about comes last.
            expect(message.indexOf(t('sync.unsentEditTail', language)))
                .toBeGreaterThan(message.indexOf(onPhoneClaim(language)));
        }
    });

    it('says it on an edit that sent NOTHING, which is where it matters most', () => {
        // An irrigation-only edit posts no correction at all, so the count
        // branch is silent and this tail is the ONLY thing standing between a
        // bare green tick and a farmer who thinks the change is filed.
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(0, language, true);

            expect(message.startsWith(onPhoneClaim(language))).toBe(true);
            expect(message).toContain(t('sync.unsentEditTail', language));
            expect(message).not.toBe(onPhoneClaim(language));
        }
    });

    it('keeps the whole sentence in one script', () => {
        // The defect this module was extracted to fix, re-checked on the branch
        // that adds a second tail.
        const mr = buildEditSavedMessage(1, 'mr', true);
        const en = buildEditSavedMessage(1, 'en', true);

        expect(/[A-Za-z]{2,}/.test(mr)).toBe(false);
        expect(/[ऀ-ॿ]/.test(en)).toBe(false);
    });

    it('is not the R19 sentence coming back', () => {
        // R19 struck "shown on screen only — not saved anywhere", which `repo.save`
        // made FALSE. This tail denies a SERVER write that does not happen, not a
        // LOCAL save that does. The distinction is the whole justification, so it
        // is asserted rather than argued.
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(1, language, true);
            expect(message.toLowerCase()).not.toContain('screen only');
            expect(message.toLowerCase()).not.toContain('not saved');
            expect(message).not.toContain('स्क्रीनवर');
        }
    });

    it('never sends the farmer somewhere to check, because there is nowhere', () => {
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(0, language, true);
            expect(message).not.toContain('तपासा');
            expect(message.toLowerCase()).not.toContain('check');
        }
    });
});

describe('buildEditSavedMessage — the phone claim is evidence, not a courtesy (V2 R1, Task 23)', () => {
    // THE DEFECT. Every branch above leads with `sync.onPhone` ("लक्षात ठेवलं ✓"),
    // and that claim is made on one thing: `repo.save` resolved. For an edit that
    // ADDED or REMOVED a labour engagement on an already-saved day, nothing in
    // this system can carry that to a server — so the next pull rebuilds the
    // day's labour from the server's own answer and the change is deleted from
    // the handset too (`UpdateLog.savedDayWorkerEdit.test.ts` proves the
    // deletion through real Dexie). Saying "remembered ✓" over it is a success
    // message for an operation that did not happen.
    //
    // NO NEW WORDS. The fix removes a false claim; it does not invent a
    // replacement sentence. `sync.unsentEditTail` is already approved copy and
    // already renders on this exact branch.

    it('drops the phone claim when the phone will not keep the edit', () => {
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(0, language, true, false);

            expect(message).not.toContain(onPhoneClaim(language));
            expect(message).toContain(t('sync.unsentEditTail', language));
        }
    });

    it('still names the corrections that DID land, beside what did not', () => {
        // A submit can correct a headcount AND add an engagement. The headcount
        // reached the server and comes back down; the added engagement does not.
        // Dropping the phone claim must not also swallow the true half.
        for (const language of LANGUAGES) {
            const message = buildEditSavedMessage(1, language, true, false);

            expect(message).not.toContain(onPhoneClaim(language));
            expect(message).toContain(tf('sync.correctionsFiledTailOne', language, { count: 1 }));
            expect(message).toContain(t('sync.unsentEditTail', language));
        }
    });

    it('never returns an empty toast, whatever the caller passes', () => {
        // A silent confirmation is its own dishonesty: the farmer taps जतन and
        // learns nothing. `!phoneClaimHolds` therefore implies the unsent tail
        // rather than merely permitting it.
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(0, language, false, false).trim()).not.toBe('');
        }
    });

    it('keeps the phone claim by default, so the happy path is byte-identical', () => {
        // The reassurance exists to stop a farmer re-recording a day the app
        // really does hold (see the module header). It is removed ONLY where the
        // app knows it is false — never widened by accident.
        for (const language of LANGUAGES) {
            expect(buildEditSavedMessage(0, language, true, true))
                .toBe(buildEditSavedMessage(0, language, true));
            expect(buildEditSavedMessage(2, language, false, true))
                .toBe(buildEditSavedMessage(2, language));
            expect(buildEditSavedMessage(1, language, true).startsWith(onPhoneClaim(language)))
                .toBe(true);
        }
    });

    it('keeps the whole sentence in one script', () => {
        expect(/[A-Za-z]{2,}/.test(buildEditSavedMessage(1, 'mr', true, false))).toBe(false);
        expect(/[ऀ-ॿ]/.test(buildEditSavedMessage(1, 'en', true, false))).toBe(false);
    });
});
