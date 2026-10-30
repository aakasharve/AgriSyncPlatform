/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the Marathi of the ONE result screen.
 *
 * Three kinds of string live here, and each line says which:
 *   - APPROVED: read from the app's existing translations (`t(key, 'mr')`), never re-typed.
 *   - FOUNDER: quoted from his decision docs (PLR-D1 / PLR-D5) or the task that carries his words.
 *   - PROPOSED (Marathi): the preview's own wording or new wording, waiting for his review.
 * The word "नोंद" is not used on these screens (PLR-D5 :65); the waiting screen keeps its own quotes.
 *
 * KNOWN GAP (spec I18, language-strict): this screen is Marathi in BOTH languages (the preview it ports, the ring's
 * own words and the eight part names exist only in Marathi). An English-mode user sees Marathi here, beside the
 * few embedded pieces that follow his language (the not-queued badge, Sathi's question). Carried to I18, which
 * owns the one language-aware label helper; not patched here string by string.
 */
import { t } from '../../../../i18n/translations';

export const RESULT_STR = {
    // APPROVED — the phone-side claim (sync.onPhone), the server-acknowledged claim (sync.onServerFull) and
    // "needs a hand" (sync.needsFix). Only the second may name श्रम सफल, and only once the server said so.
    remembered: t('sync.onPhone', 'mr'),
    onServer: t('sync.onServerFull', 'mr'),
    needsFix: t('sync.needsFix', 'mr'),
    // APPROVED — the meter's existing lines (dfesTranslations).
    sathiLine: t('dfes.sathiSaidLine', 'mr'),
    meterPending: t('dfes.dayUnderstandingPending', 'mr'),
    noWorkDay: t('dfes.noWorkDayAcknowledged', 'mr'),
    // APPROVED — confirmation.edit / common.back.
    edit: t('confirmation.edit', 'mr'),
    back: t('common.back', 'mr'),
    // APPROVED — the review form's flag for an item the server could not find in his words (voice.unverifiedSourceLabel).
    unsure: t('voice.unverifiedSourceLabel', 'mr'),
    // FOUNDER — PLR-D5 :65 ("आणखी सांगा" replaces "आणखी नोंद करा").
    addAnother: 'आणखी सांगा',
    // FOUNDER — the ring's own label for a stoppage (understandingRing/categories.ts, founder 2026-10-25).
    blockers: 'अडथळे / अडचणी',
    // PROPOSED (Marathi) — the preview marks these three as proposed (UnderstandingHero "Proposed Marathi", model.ts
    // "PROPOSED wording"); PLR-D1 round 5 itself says "यातून काय जोडलं". They go to his Marathi review.
    ringHeading: 'श्रम साथीला किती समजले',
    addedTitle: 'यातून काय समजलं',
    confirm: 'पक्कं आहे',
    // PROPOSED (Marathi) — from the founder-approved design preview (postVoiceResult/model.ts STR), still unreviewed.
    justNow: 'आत्ताचं बोलणं',
    todayCount: (n: number) => `आज ${n} वेळा सांगितलं`,
    firstToday: 'आज पहिल्यांदा सांगितलं',
    confirmedBadge: 'पक्कं केलं',
    notConfirmed: 'पक्कं नाही',
    dayTitle: 'आजचं आतापर्यंत',
    tapForHistory: 'दाबा — आधी काय सांगितलं ते दिसेल',
    noneYet: 'सांगितलं नाही',
    tellMore: 'दाबा आणि बोला',
    earlierTitle: 'आधीची बोलणी',
    listenAndConfirm: 'ऐका आणि पक्कं करा',
    // FOUNDER — D-44 ("confirming … by reading = 'वाचा आणि पक्कं करा'"). The lock ("आधी तुमचं बोलणं ऐका") is gone (I27).
    readAndConfirm: 'वाचा आणि पक्कं करा',
    confirmedDone: 'तुम्ही पक्कं केलं',
    play: 'ऐका',
    stop: 'थांबवा',
    you: 'तुम्ही',
    unknownPerson: 'अज्ञात',
    todayWho: 'आज कोणी सांगितलं',
    times: (n: number) => `${n} वेळा`,
    foot: 'आधीची बोलणी तशीच राहतात. नवीन बोललेलं त्यात जोडलं जातं.',
    linksSub: 'एखादा भाग दाबा — कोणत्या शब्दांतून समजले ते दिसेल',
    wrote: 'श्रम साथीने लिहिले',
    newTag: 'नवीन',
    // PROPOSED (Marathi) — the preview's tag for an entry filled in by hand (TypedLog.tsx TYPED_STR.tag).
    typedTag: 'लिहिलेलं',
    // PROPOSED (Marathi) — the line under a confirmed recording. Claims only his WORDS (the transcript on the log):
    // the clip row is processing_30d, so the preview's "तुमचं बोलणं आणि शब्द जपले आहेत" promised a recording kept
    // for good that is not.
    keptSafe: 'तुमचे शब्द जपले आहेत',
    // PROPOSED (Marathi) — new wording written for this screen.
    unclearTitle: 'हे साथीला नीट समजलं नाही',
    confirmFailed: 'आत्ता पक्कं करता आलं नाही — पुन्हा दाबा',
    wholeFarm: 'संपूर्ण शेत',
    // PROPOSED (Marathi) — a part he mentioned that the server could not find in his words: "not sure", never "not said".
    unsurePart: 'नक्की समजलं नाही',
} as const;
