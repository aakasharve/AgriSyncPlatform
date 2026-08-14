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
 * NOTHING CHANGED IN THE MOVE ITSELF. Every key and value arrived here
 * byte-identical to what `translations.ts` held immediately before the split;
 * `__tests__/shramSathiVoice.test.ts` and
 * `features/sync/status/__tests__/syncHonestyState.test.ts` pin the values
 * against hand-written literals, independently of this file.
 *
 * SINCE THEN, FOUNDER REVISION (2026-08-14) — FIVE VALUES AND ONE NEW KEY.
 * `sync.onPhone` and `sync.needsFix` were reworded in both languages,
 * `sync.onPhoneFull` was replaced with the founder's own sentence, and
 * `sync.onServerFull` was added carrying the other one. His ruling:
 *
 *   *"Shram Sathi is a helper person but don't force that as a hard rule —
 *   just make it readable enough that Shram Safal is the system and Shram
 *   Sathi is the helper."*
 *
 * That RELAXES the rule this file used to enforce (Sathi speaks in the first
 * person, so every `mr` claim opened with `मी`) and REPLACES it with a
 * weaker, sharper one: **श्रम सफल is the system, श्रम साथी is the helper.**
 * The name of the system may appear only where the system genuinely holds
 * the record. `syncHonestyState.test.ts` now pins that property instead of
 * the `मी` prefix — his own `onPhoneFull` sentence names Sathi in the third
 * person and would have failed the old test.
 *
 * The chip forms are SHORTENED FROM HIS OWN SENTENCES, not invented:
 * `लक्षात ठेवलं ✓` is the tail of `…व लक्षात ठेवले`, and `मदत कराल का?` is his
 * phrase verbatim. `sync.onServer` (`शेतनोंदीत जमा ✓`) is untouched — it was
 * approved, it is already shipping, and it is the one claim backed by an
 * acknowledgement.
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
     * The FULL form of the ON_PHONE claim, in the founder's own sentence:
     * `श्रम साथी ने समजले व लक्षात ठेवले` — "Shram Sathi understood it and
     * kept it in mind."
     *
     * IT NAMES THE HELPER AND NOT THE SYSTEM, WHICH IS THE WHOLE POINT. At
     * this instant a person has the record and the system does not, so the
     * sentence says exactly that. The earlier draft — *"Shram Sathi
     * understood and kept in our farm records"* — was two facts at two
     * different times: "understood" is true the moment the record reaches
     * `db.logs`, "kept in our farm records" is a DURABILITY promise and is
     * true only once the server has acknowledged it. `onServerFull` is now
     * the key that carries the second half, and it is the only one allowed
     * to say श्रम सफल.
     *
     * NO SURFACE TODAY, and that is deliberate. It was drafted for the
     * post-save headline; L5b measured the short `onPhone` form there at
     * 190.42px on one line — 34px narrower than the string it replaced, 0px
     * fold movement — and the long form was not authorised. Kept as correct
     * copy awaiting a surface. At 33 code points it does not fit the 72px
     * chip (~13-16) nor the drawer's 34-point split header, which hard-clips.
     */
    onPhoneFull: string;

    /**
     * The FULL form of the ON_SERVER claim, in the founder's own sentence:
     * `श्रम सफल मध्ये साठवून ठेवले` — "stored in Shram Safal."
     *
     * THE ONLY STRING IN THIS FILE THAT MAY NAME THE SYSTEM. It asserts the
     * record is inside श्रम सफल, so it may appear only on the state a server
     * acknowledgement backs — ON_SERVER, and never ON_PHONE. Putting it on
     * the on-phone state would tell a farmer his work is in the system when
     * it is only on his handset: the exact false promise this phase exists
     * to remove (`B5`).
     *
     * NO SURFACE TODAY, the same standing as `onPhoneFull` and for the same
     * reason — 27 code points against a chip that fits ~13-16, which is why
     * the chip keeps the short `onServer` (`शेतनोंदीत जमा ✓`). It is defined
     * so the sentence is already right the day a roomier surface asks for
     * it; `core/navigation/mainViewComponents.tsx` refers to this key by
     * name and, until now, referred to one that did not exist.
     */
    onServerFull: string;

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
        needsFix: 'Can you help?',
        onPhoneFull: 'Shram Sathi understood and remembered it',
        onServerFull: 'Stored in Shram Safal',
        notFiledCountTail: '{skipped} of {handled} will not reach your farm records.',
        notFiledBadgeTail: 'will not reach your farm records',
        correctionsFiledTailOne: '{count} labour correction reached your farm records.',
        correctionsFiledTailMany: '{count} labour corrections reached your farm records.',
        unsentEditTail: 'The rest of this edit will not reach your farm records.',
    },
    mr: {
        onPhone: 'लक्षात ठेवलं ✓',
        onServer: 'शेतनोंदीत जमा ✓',
        needsFix: 'मदत कराल का?',
        onPhoneFull: 'श्रम साथी ने समजले व लक्षात ठेवले',
        onServerFull: 'श्रम सफल मध्ये साठवून ठेवले',
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
