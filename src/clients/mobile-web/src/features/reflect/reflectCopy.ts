/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF, RF2) — the words lanes RF and RF2 add to आढावा: the
 * plot cards' chips line, the plot's day view (its buckets, its time chips, "आणखी सांगा"), the notes' link to their
 * recording, and the money section's "—" / "partial" lines. Lane RF2 retired the one-recording glance. Its fix pass
 * (founder 2026-10-30: "put it as it is, I asked you to rebuild the screen inside it") brought the "आजचा आढावा" button
 * back exactly as it was, and rebuilt only the screen inside it (one block per plot, time chips). One language at a time: Marathi mode shows only Marathi, English mode only
 * English (founder 2026-10-26). Each line says where it comes from:
 *   - REUSED: an existing app string, read from where it lives (never re-typed);
 *   - PROPOSED (Marathi) / PROPOSED (English): new wording, waiting for his review.
 * The word "नोंद" is kept off these surfaces (PLR-D5 :65): "काम" / "सांगितलं" instead.
 *
 * Known gap, inherited and not patched here: the result-screen parts this page reuses (`DayParts`, the part names
 * of `resultModel`, the time words of `formatFarmerLogTime`) are Marathi in both languages — spec I18 owns them.
 */
import { FEED_STR } from '../logs/components/TodayActivityFeed';
import { resultCopy } from '../logs/components/voiceResult/resultCopy';
import { RESULT_STR } from '../logs/components/voiceResult/resultStrings';
import { offsetOf, relLabel } from './overview/reflectDates';
import { ruleWithheldCopy } from '../../i18n/ruleWithheldTranslations';

export interface ReflectCopy {
    /** Who spoke it: the person holding this phone, or nobody recorded (never a guessed name). */
    you: string;
    unknownPerson: string;
    wholeFarm: string;
    /** The ONE status wording, everywhere on this page. */
    confirmed: string;
    notConfirmed: string;
    /** A record the server holds only as task lines (lane F1). */
    legacyPartial: string;
    back: string;
    edit: string;
    /** The day's work (the "आजचा आढावा" button): its button and screen follow the chosen day. */
    feedTitle: (isToday: boolean) => string;
    feedSubtitle: (isToday: boolean, day: string) => string;
    feedEmpty: (isToday: boolean) => string;
    /** आज / काल / … or the weekday and date, in this language. */
    dayName: (date: Date, today?: Date) => string;
    nothingUnderstood: string;
    /** Lane RF2 — a card or day view with nothing told ("आज अजून काही सांगितलं नाही"). */
    nothingTold: (isToday: boolean) => string;
    /** Lane RF2 — how many times the day was told ("आज 4 वेळा सांगितलं"): its own recordings counted, nothing else. */
    timesTold: (n: number, isToday: boolean) => string;
    /** Lane RF2 — the card's way into its day. */
    seeAll: string;
    /**
     * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; preview DFES-meter-and-names) - a plot card's "who told
     * it" line label, the one "tell more" line's label, and the mic button's word. Words only: no number, no bar.
     */
    toldBy: string;
    moreToTell: string;
    speak: string;
    /** Lane RF2 — the "संपूर्ण शेत" card's line. */
    farmCardLine: string;
    /** Lane RF2 — the plot's day view: the buckets' line, the time chips' title and key, "आणखी सांगा". */
    dayViewHint: (isToday: boolean) => string;
    timesTitle: string;
    timesKey: string;
    tellMore: string;
    /** A chip the server could not find in his words. */
    unsure: string;
    /** A stoppage chip with nothing more to say than that there was one. */
    stoppage: string;
    /** Lane RF2 fix pass (D5): the money chip says it is the accounts' figure, and a day with money but no words says so. */
    fromLedger: string;
    nothingSpoken: string;
    /** "दिवस 25" of the plot's season. */
    seasonDay: (n: number) => string;
    /** A note's link to the recording it came from. */
    noteSource: string;
    photos: (n: number) => string;
    /** Money the person holding this phone may not see. */
    moneyHidden: string;
    /** Money totals made from an incomplete set. */
    partialTag: string;
    partialNotOnServer: string;
    partialUnknownDirection: string;
    /** Review B003: the ledger is not read in full yet (or could not be). */
    partialUnchecked: string;
    /** Review B008: the in-hand card's label. */
    inHandLabel: string;
}

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const mr: ReflectCopy = {
    // REUSED — RESULT_STR.you / unknownPerson / wholeFarm (the result screen's own words).
    you: RESULT_STR.you,
    unknownPerson: RESULT_STR.unknownPerson,
    wholeFarm: RESULT_STR.wholeFarm,
    // REUSED — the result screen's status words (RESULT_STR.confirmedBadge / notConfirmed), with its ✔.
    confirmed: `✔ ${RESULT_STR.confirmedBadge}`,
    notConfirmed: RESULT_STR.notConfirmed,
    // REUSED — lane F1's line (resultCopy.legacyPartial), never re-typed.
    legacyPartial: resultCopy('mr').legacyPartial,
    // REUSED — RESULT_STR.back / edit (the app's approved common.back / confirmation.edit).
    back: RESULT_STR.back,
    edit: RESULT_STR.edit,
    // REUSED for today (FEED_STR.title / subtitle / empty); PROPOSED (Marathi) for any other day — lane RF's own words.
    feedTitle: (isToday: boolean) => (isToday ? FEED_STR.title : 'दिवसाचा आढावा'),
    feedSubtitle: (isToday: boolean, day: string) => (isToday ? FEED_STR.subtitle : `${day} — कोणी काय केलं ते पाहा`),
    feedEmpty: (isToday: boolean) => (isToday ? FEED_STR.empty : 'या दिवशी काहीही सांगितलं नाही'),
    // REUSED — reflectDates.relLabel (आज / काल / परवा / उद्या, else "बुधवार, 21 ऑक्टो").
    dayName: (date: Date, today?: Date) => relLabel(date, today),
    // PROPOSED (Marathi) — the same words ClipGlance shows for this case (its constant is not exported).
    nothingUnderstood: 'या बोलण्यातून अजून काही समजलं नाही',
    // PROPOSED (Marathi) — today's: the founder's screen 1 (and lane RF's card); another day's: new.
    nothingTold: (isToday: boolean) => (isToday ? 'आज अजून काही सांगितलं नाही' : 'या दिवशी काही सांगितलं नाही'),
    // REUSED for today (RESULT_STR.todayCount, the founder's screen 1); PROPOSED (Marathi) for another day.
    timesTold: (n: number, isToday: boolean) => (isToday ? RESULT_STR.todayCount(n) : `${RESULT_STR.times(n)} सांगितलं`),
    // PROPOSED (Marathi) — the founder's screen 1.
    seeAll: 'सगळं बघा',
    // The preview's own words (DFES-meter-and-names, screen 3): "सांगितलं:", "अजून सांगा:" and the mic's "बोला".
    toldBy: 'सांगितलं:',
    moreToTell: 'अजून सांगा:',
    speak: 'बोला',
    // PROPOSED (Marathi)
    farmCardLine: 'कोणत्याही एका प्लॉटचं नसलेलं काम',
    // PROPOSED (Marathi) — today's: the founder's screen 1; another day's: new.
    dayViewHint: (isToday: boolean) => (isToday ? 'आजचं सगळं काम — बोलल्याप्रमाणे विभागून' : 'या दिवसाचं सगळं काम — बोलल्याप्रमाणे विभागून'),
    // PROPOSED (Marathi) — the founder's screen 1.
    timesTitle: 'कोणत्या वेळी काय सांगितलं',
    timesKey: 'हिरवा ठिपका = पक्कं केलं · राखाडी = पक्कं नाही',
    // REUSED — RESULT_STR.addAnother ("आणखी सांगा", PLR-D5 :65).
    tellMore: RESULT_STR.addAnother,
    // REUSED — RESULT_STR.unsurePart.
    unsure: RESULT_STR.unsurePart,
    // REUSED — RESULT_STR.blockers (the ring's own word for a stoppage).
    stoppage: RESULT_STR.blockers,
    // PROPOSED (Marathi) — the orchestrator's call (RF2 fix pass D5).
    fromLedger: 'हिशोबातून',
    nothingSpoken: 'बोलून काही सांगितलं नाही',
    // REUSED — the plot card's own words for a season day (plotDayModel dayLabelOf, "दिवस 25").
    seasonDay: (n: number) => `दिवस ${n}`,
    // PROPOSED (Marathi)
    noteSource: 'कुठून आलं ते पाहा',
    // PROPOSED (Marathi) — the feed card's existing words (ActivityFeedCard CARD_STR.attachments).
    photos: (n: number) => `जोडलेले फोटो ${n}`,
    // Founder W2 (MU-3 fix 1, item 16) — founder D-22 "work access ≠ money access"; the server's see-money answer
    // decides (mayShowFarmMoney), and the line reads as ShramSafal's rule, never as the owner's distrust.
    moneyHidden: ruleWithheldCopy('mr').moneyAccounts,
    // PROPOSED (Marathi)
    partialTag: 'अपूर्ण',
    partialNotOnServer: 'अपूर्ण — काही पैसे अजून सर्व्हरच्या हिशोबात पोचलेले नाहीत',
    partialUnknownDirection: 'अपूर्ण — काही जुन्या रकमा आल्या की गेल्या ते सांगितलेलं नाही, त्या यात मोजल्या नाहीत',
    // PROPOSED (Marathi)
    partialUnchecked: 'अपूर्ण — या फोनने अजून सगळा हिशोब तपासलेला नाही',
    // PROPOSED (Marathi) — the card's old "हातात आलेलं उत्पन्न · या हंगामात"; "आतापर्यंत": the ledger cannot be cut to one season here.
    inHandLabel: 'हातात आलेलं उत्पन्न · आतापर्यंत',
};

const en: ReflectCopy = {
    you: 'You', // PROPOSED (English)
    unknownPerson: 'Unknown', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English)
    confirmed: '✔ Confirmed', // PROPOSED (English)
    notConfirmed: 'Not confirmed', // PROPOSED (English)
    // REUSED — lane F1's English line (resultCopy('en').legacyPartial).
    legacyPartial: resultCopy('en').legacyPartial,
    back: 'Back', // PROPOSED (English)
    edit: 'Change', // PROPOSED (English)
    dayName: (date: Date, today: Date = new Date()) => {
        const o = offsetOf(date, today);
        if (o === 0) return 'Today'; // PROPOSED (English)
        if (o === -1) return 'Yesterday'; // PROPOSED (English)
        if (o === 1) return 'Tomorrow'; // PROPOSED (English)
        return `${WEEKDAY_EN[date.getDay()]}, ${date.getDate()} ${MONTH_EN[date.getMonth()]}`;
    },
    feedTitle: (isToday: boolean) => (isToday ? "Today's work" : "The day's work"), // PROPOSED (English)
    feedSubtitle: (isToday: boolean, day: string) => (isToday ? 'See who did what today' : `${day} — see who did what`), // PROPOSED (English)
    feedEmpty: (isToday: boolean) => (isToday ? 'Nothing has been told today yet' : 'Nothing was told on this day'), // PROPOSED (English)
    nothingUnderstood: 'Nothing has been understood from this yet', // PROPOSED (English)
    nothingTold: (isToday: boolean) => (isToday ? 'Nothing told yet today' : 'Nothing told on this day'), // PROPOSED (English)
    timesTold: (n: number, isToday: boolean) => `Told ${n} ${n === 1 ? 'time' : 'times'}${isToday ? ' today' : ''}`, // PROPOSED (English)
    seeAll: 'See all', // PROPOSED (English)
    toldBy: 'Told by:', // PROPOSED (English)
    moreToTell: 'Tell more:', // PROPOSED (English)
    speak: 'Speak', // PROPOSED (English)
    farmCardLine: 'Work not for any one plot', // PROPOSED (English)
    dayViewHint: (isToday: boolean) => (isToday ? "All of today's work — sorted as it was told" : "All of this day's work — sorted as it was told"), // PROPOSED (English)
    timesTitle: 'What was told when', // PROPOSED (English)
    timesKey: 'Green dot = confirmed · grey = not confirmed', // PROPOSED (English)
    tellMore: 'Tell more', // PROPOSED (English)
    unsure: 'Not sure', // PROPOSED (English)
    stoppage: 'Stoppage', // PROPOSED (English)
    fromLedger: 'from the accounts', // PROPOSED (English)
    nothingSpoken: 'Nothing was said', // PROPOSED (English)
    seasonDay: (n: number) => `Day ${n}`, // PROPOSED (English)
    noteSource: 'See where it came from', // PROPOSED (English)
    photos: (n: number) => `Photos attached ${n}`, // PROPOSED (English)
    moneyHidden: ruleWithheldCopy('en').moneyAccounts, // Founder W2 (MU-3 fix 1, item 16)
    partialTag: 'partial', // PROPOSED (English)
    partialNotOnServer: 'Partial — some money has not reached the farm account on the server yet', // PROPOSED (English)
    partialUnknownDirection: 'Partial — some older amounts do not say whether money came in or went out; they are not counted here', // PROPOSED (English)
    partialUnchecked: 'Partial — this phone has not finished checking the whole account yet', // PROPOSED (English)
    inHandLabel: 'Income received · so far', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function reflectCopy(language: string | null | undefined): ReflectCopy {
    return language === 'en' ? en : mr;
}
