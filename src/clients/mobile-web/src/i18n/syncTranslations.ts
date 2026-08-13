/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Shram Sathi voice: what the app is allowed to claim about a farmer's
 * records, and the sentences it says while claiming it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `check:file-sizes` caps mobile-web source at 800 lines, and this section's
 * documentation is long because every string in it is load-bearing: each one is
 * a claim about whether a farmer's work is safe, and the reasoning for the
 * exact wording is worth more than the wording. Carrying that inside
 * `translations.ts` took the file to 814. The DFES split earlier in this wave
 * cleared a pre-existing violation; adding a fresh one back would be a poor
 * trade, so this is the second split rather than a suppression.
 *
 * It is also the right seam on its own merits: `sync.*` and `shramSathi.*` are
 * the only copy in the app whose correctness is a TRUTH question rather than a
 * translation question, and they are revised together, by the founder, as one
 * decision.
 *
 * NOTHING HERE CHANGED IN THE MOVE. Every key and value is byte-identical to
 * what `translations.ts` held immediately before the split;
 * `__tests__/shramSathiVoice.test.ts` and
 * `features/sync/status/__tests__/syncHonestyState.test.ts` pin the values
 * against hand-written literals, independently of this file.
 */
import type { Language } from './language';

/**
 * Sync status chip — Labour Phase 2 / Phase 1 (honesty backstop), T1.
 *
 * Exactly three claims, each backed by evidence. See
 * `features/sync/status/syncHonestyState.ts` for what each one means and
 * what proves it. The chip is shared app-wide chrome, so these follow the
 * farmer's language preference rather than being hardcoded Marathi.
 */
export interface SyncTranslations {
    /** Captured on the handset. Claims nothing about the server. */
    onPhone: string;
    /** The server acknowledged it (`applied` or `duplicate`). */
    onServer: string;
    /** Rejected, past the retry cap, or never queued at all. */
    needsFix: string;
    /**
     * The FULL form of the ON_PHONE claim.
     *
     * The founder's sentence — *"Shram Sathi understood and kept in our
     * farm records"* — is TWO facts at two different times. "Understood" is
     * true the instant the record reaches `db.logs`; "kept in our farm
     * records" is a DURABILITY promise and is true only once the server has
     * acknowledged it. This key carries the FIRST half only.
     *
     * NO SURFACE TODAY, and that is deliberate. It was drafted for the
     * post-save headline; L5b measured the short `onPhone` form there at
     * 190.42px on one line — 34px narrower than the string it replaced, 0px
     * fold movement — and the long form was not authorised. Kept as correct
     * copy awaiting a surface, exactly like `onServerFull` (which is not
     * defined at all, because at every moment the app could say it there is
     * no acknowledgement in hand).
     */
    onPhoneFull: string;

    /*
     * ── The TAILS ────────────────────────────────────────────────────────
     *
     * PROPOSED COPY, PENDING FOUNDER CONFIRMATION. Wording taken from the
     * CTO ruling of 2026-08-13 (`cto-rulings.md` §1.3). The founder is the
     * Marathi authority; nothing here is a string any agent invented.
     *
     * These exist because the app was speaking half a sentence in each
     * language. `useLogCommands` composed a Marathi `sync.onPhone` with a
     * HARDCODED English tail — a farmer on the Marathi preference read
     * `फोनवर सेव्ह ✓ — 3 of 3 cannot be sent.`, one sentence, two scripts.
     * The claim was honest and the presentation was not.
     *
     * They are TAILS rather than whole sentences on purpose: the reassuring
     * half must come FIRST and must be the SAME string the chip uses
     * (T2/B4 — a farmer scanning a red toast who reads "gone" re-records,
     * and now the ledger holds the day twice). Composing
     * `${t(sync.onPhone)} — ${tail}` keeps `startsWith(onPhone)` true and
     * keeps ONE definition of the phone claim.
     */

    /**
     * "…of the records in this save, N will never reach the server."
     *
     * `{skipped}` and `{handled}` are read off the enqueue RESULT, never
     * off the submitted set, so the sentence cannot round a dropped record
     * up into a saved one.
     *
     * WORD ORDER IS NOT A TRANSLATION OF THE ENGLISH. Marathi `X पैकी Y`
     * means "Y out of X", so the TOTAL binds before `पैकी` and the SUBSET
     * after — the mirror of the English order. Verified against this file's
     * own precedent, `dfes.daysLoggedThisWeek`, which is
     * `'{logged} of {count} days'` in English and
     * `'{count} पैकी {logged} दिवस'` in Marathi. Getting this backwards
     * would report the wrong number in the language most farmers read.
     */
    notFiledCountTail: string;
    /**
     * The same fact with no counts, for the per-record badge on the
     * success card, where the count is already implied by the card itself.
     */
    notFiledBadgeTail: string;

    /**
     * "N labour corrections reached your farm records." — the ONE
     * server-evidenced claim the edit path is allowed to make
     * (`persistedLabourCorrections`, and `postLabourCorrection` throws on
     * any non-2xx).
     *
     * MARATHI HAS ONE FORM HERE, NOT TWO. The CTO's approved clause is the
     * plural `{count} दुरुस्त्या शेतनोंदीत गेल्या.`; no singular was
     * supplied and no agent may inflect one, so the approved plural is used
     * at every count and is listed for the founder. English keeps the
     * singular/plural split the shipped code already had.
     */
    correctionsFiledTailOne: string;
    correctionsFiledTailMany: string;

    /**
     * "The rest of this edit will not reach your farm records."
     *
     * THE CAVEAT `R19` DELETED, RESTORED ON A DIFFERENT AND TRUE BASIS. The
     * sentence R19 struck said the rest of an edit was *"shown on screen only —
     * not saved anywhere"*, and Phase 4 made that false: `updateLog` calls
     * `repo.save`, so it IS saved. What R19 then assumed — that no caveat was
     * needed at all — does not follow. `repo.save` makes the edit durable ON
     * THIS PHONE; it does not put it on a server. `UpdateLog` POSTs the labour
     * corrections and nothing else, and the edit path enqueues no mutation of
     * any kind, so nothing in this client will ever carry the rest.
     *
     * That is a different claim from the deleted one and must not be confused
     * with it: the old sentence denied a local save that happens, this one
     * denies a server write that does not. `saveToastMessages.test.ts` still
     * forbids the old wording verbatim.
     *
     * "WILL NOT", NOT "NOT YET" — the same tense, and the same reason, as
     * `notFiledCountTail`: there is no queue row, no worker and no retry behind
     * it. A promise of a later send is one this code cannot keep.
     *
     * MARATHI — the verb phrase `शेतनोंदीत जाणार नाहीत` is lifted VERBATIM from
     * the approved `notFiledCountTail`. The only new words are `बाकीचे बदल`
     * ("the rest of the changes"), which is on the founder-copy list with the
     * rest of this block and is the one string here no ruling has yet blessed.
     */
    unsentEditTail: string;
}

/**
 * Shram Sathi speaking in the FIRST person.
 *
 * Not a new rule — the repo's existing one, made explicit so it stops being
 * re-litigated. `WelcomeScreen.tsx:148` already ships
 * `मी श्रम साथी — तुमच्या रोजच्या शेतीकामाची घडी बसवायला मदत करतो`, and the
 * Understanding-Meter design states it verbatim: the subject of any gap is
 * Shram Sathi (मला / श्रम साथीला), never the farmer (तुम्ही).
 *
 * The ENGLISH column uses the NAME ("Shram Sathi is…") rather than "I am…".
 * In English a bare first person from an unnamed app reads as the app, not
 * as the character; Marathi carries the persona in the verb ending. The
 * asymmetry is deliberate.
 */
export interface ShramSathiTranslations {
    /** The processing screen, while the clip is being understood. */
    understanding: string;
}

export const syncTranslations: Record<Language, SyncTranslations> = {
    en: {
        onPhone: 'Shram Sathi has it',
        onServer: 'In your farm records',
        needsFix: 'Stuck — check',
        onPhoneFull: 'Shram Sathi understood — the record is with me',
        notFiledCountTail: '{skipped} of {handled} will not reach your farm records.',
        notFiledBadgeTail: 'will not reach your farm records',
        correctionsFiledTailOne: '{count} labour correction reached your farm records.',
        correctionsFiledTailMany: '{count} labour corrections reached your farm records.',
        unsentEditTail: 'The rest of this edit will not reach your farm records.',
    },
    mr: {
        onPhone: 'मी लिहून घेतलं ✓',
        onServer: 'शेतनोंदीत जमा ✓',
        needsFix: 'अडकलं — तपासा',
        onPhoneFull: 'मी समजून घेतलं — नोंद माझ्याकडे आहे',
        notFiledCountTail: '{handled} पैकी {skipped} शेतनोंदीत जाणार नाहीत.',
        notFiledBadgeTail: 'शेतनोंदीत जाणार नाही',
        correctionsFiledTailOne: '{count} दुरुस्त्या शेतनोंदीत गेल्या.',
        correctionsFiledTailMany: '{count} दुरुस्त्या शेतनोंदीत गेल्या.',
        unsentEditTail: 'बाकीचे बदल शेतनोंदीत जाणार नाहीत.',
    },
};

export const shramSathiTranslations: Record<Language, ShramSathiTranslations> = {
    en: {
        understanding: 'Shram Sathi is understanding today\'s work…',
    },
    mr: {
        understanding: 'मी आजचं काम समजून घेतोय…',
    },
};
