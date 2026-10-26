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
    // FOUNDER — the meter heading in his wording ("श्रम साथीला … समजले"), the screen's own words from PLR-D1/D5.
    ringHeading: 'श्रम साथीला किती समजले',
    addedTitle: 'यातून काय समजलं',
    confirm: 'पक्कं आहे',
    addAnother: 'आणखी सांगा',
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
    lockedLabel: 'आधी तुमचं बोलणं ऐका 🔊',
    unlockHint: 'ऐकल्यावर इथे दाबा',
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
    // PROPOSED (Marathi) — new wording written for this screen.
    unclearTitle: 'हे साथीला नीट समजलं नाही',
    confirmFailed: 'आत्ता पक्कं करता आलं नाही — पुन्हा दाबा',
    wholeFarm: 'संपूर्ण शेत',
    blockers: 'अडथळे / अडचणी',
} as const;
