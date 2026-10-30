/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the words lane RF adds to आढावा: the day's work
 * (the feed), one recording at a glance, the plot's day sheet, the notes' link to their recording, and the money
 * section's "—" / "partial" lines. One language at a time: Marathi mode shows only Marathi, English mode only
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
    /** The day's work (the feed): its button, sheet and empty line follow the chosen day. */
    feedTitle: (isToday: boolean) => string;
    feedSubtitle: (isToday: boolean, day: string) => string;
    feedEmpty: (isToday: boolean) => string;
    feedHint: string;
    /** आज / काल / … or the weekday and date, in this language. */
    dayName: (date: Date, today?: Date) => string;
    understood: string;
    nothingUnderstood: string;
    /** The plot's day sheet. */
    dayWork: string;
    dayWorkHint: string;
    allRecordings: string;
    dayEmpty: string;
    addWork: string;
    /** How many times the plot's day was told (the sheet counts its own rows, nothing else). */
    timesTold: (n: number) => string;
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
    /** Review B006: the card's labour cell when labour was told in more than one recording (never summed). */
    labourSeveral: string;
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
    // REUSED for today (FEED_STR.title / subtitle / empty / hint); PROPOSED (Marathi) for any other day.
    feedTitle: (isToday: boolean) => (isToday ? FEED_STR.title : 'दिवसाचा आढावा'),
    feedSubtitle: (isToday: boolean, day: string) => (isToday ? FEED_STR.subtitle : `${day} — कोणी काय केलं ते पाहा`),
    feedEmpty: (isToday: boolean) => (isToday ? FEED_STR.empty : 'या दिवशी काहीही सांगितलं नाही'),
    feedHint: FEED_STR.hint,
    // REUSED — reflectDates.relLabel (आज / काल / परवा / उद्या, else "बुधवार, 21 ऑक्टो").
    dayName: (date: Date, today?: Date) => relLabel(date, today),
    // REUSED — RESULT_STR.addedTitle.
    understood: RESULT_STR.addedTitle,
    // PROPOSED (Marathi) — the same words ClipGlance shows for this case (its constant is not exported).
    nothingUnderstood: 'या बोलण्यातून अजून काही समजलं नाही',
    // PROPOSED (Marathi)
    dayWork: 'या दिवसाचं काम',
    // PROPOSED (Marathi) — the result screen's RESULT_STR.tapForHistory without "आधी".
    dayWorkHint: 'दाबा — कोणी, कधी काय सांगितलं ते दिसेल',
    // PROPOSED (Marathi) — "बोलणी" is the result screen's word for recordings (RESULT_STR.earlierTitle).
    allRecordings: 'या दिवसाची सगळी बोलणी — वेळेनुसार',
    // PROPOSED (Marathi)
    dayEmpty: 'या दिवशी इथे काहीही सांगितलं नाही',
    // PROPOSED (Marathi) — replaces the old drawer's English "Add Missing Entry".
    addWork: 'या दिवसाचं काम जोडा',
    // PROPOSED (Marathi) — built on RESULT_STR.times ("3 वेळा").
    timesTold: (n: number) => `${RESULT_STR.times(n)} सांगितलं`,
    // REUSED — the plot card's own words for a season day (plotDayModel dayLabelOf, "दिवस 25").
    seasonDay: (n: number) => `दिवस ${n}`,
    // PROPOSED (Marathi)
    noteSource: 'कुठून आलं ते पाहा',
    // PROPOSED (Marathi) — the feed card's existing words (ActivityFeedCard CARD_STR.attachments).
    photos: (n: number) => `जोडलेले फोटो ${n}`,
    // PROPOSED (Marathi) — founder D-22 "work access ≠ money access"; mayShowFarmMoney is the primary owner only.
    moneyHidden: 'पैशांचा हिशोब फक्त मुख्य मालकाला दिसतो',
    // PROPOSED (Marathi)
    partialTag: 'अपूर्ण',
    partialNotOnServer: 'अपूर्ण — काही पैसे अजून सर्व्हरच्या हिशोबात पोचलेले नाहीत',
    partialUnknownDirection: 'अपूर्ण — काही जुन्या रकमा आल्या की गेल्या ते सांगितलेलं नाही, त्या यात मोजल्या नाहीत',
    // PROPOSED (Marathi)
    partialUnchecked: 'अपूर्ण — या फोनने अजून सगळा हिशोब तपासलेला नाही',
    // PROPOSED (Marathi) — the card's old "हातात आलेलं उत्पन्न · या हंगामात"; "आतापर्यंत": the ledger cannot be cut to one season here.
    inHandLabel: 'हातात आलेलं उत्पन्न · आतापर्यंत',
    // PROPOSED (Marathi)
    labourSeveral: 'मजूर वेगवेगळ्या वेळी सांगितले — दिवस उघडा',
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
    feedTitle: (isToday: boolean) => (isToday ? "Today's work" : "The day's work"), // PROPOSED (English)
    feedSubtitle: (isToday: boolean, day: string) => (isToday ? 'See who did what today' : `${day} — see who did what`), // PROPOSED (English)
    feedEmpty: (isToday: boolean) => (isToday ? 'Nothing has been told today yet' : 'Nothing was told on this day'), // PROPOSED (English)
    feedHint: 'Press ▶ to hear it · press a card to see everything understood from it', // PROPOSED (English)
    dayName: (date: Date, today: Date = new Date()) => {
        const o = offsetOf(date, today);
        if (o === 0) return 'Today'; // PROPOSED (English)
        if (o === -1) return 'Yesterday'; // PROPOSED (English)
        if (o === 1) return 'Tomorrow'; // PROPOSED (English)
        return `${WEEKDAY_EN[date.getDay()]}, ${date.getDate()} ${MONTH_EN[date.getMonth()]}`;
    },
    understood: 'What was understood from it', // PROPOSED (English)
    nothingUnderstood: 'Nothing has been understood from this yet', // PROPOSED (English)
    dayWork: "This day's work", // PROPOSED (English)
    dayWorkHint: 'Press — see who told what, and when', // PROPOSED (English)
    allRecordings: 'Everything told this day — in time order', // PROPOSED (English)
    dayEmpty: 'Nothing was told here on this day', // PROPOSED (English)
    addWork: "Add this day's work", // PROPOSED (English)
    timesTold: (n: number) => `Told ${n} ${n === 1 ? 'time' : 'times'}`, // PROPOSED (English)
    seasonDay: (n: number) => `Day ${n}`, // PROPOSED (English)
    noteSource: 'See where it came from', // PROPOSED (English)
    photos: (n: number) => `Photos attached ${n}`, // PROPOSED (English)
    moneyHidden: 'Only the main owner sees the money', // PROPOSED (English)
    partialTag: 'partial', // PROPOSED (English)
    partialNotOnServer: 'Partial — some money has not reached the farm account on the server yet', // PROPOSED (English)
    partialUnknownDirection: 'Partial — some older amounts do not say whether money came in or went out; they are not counted here', // PROPOSED (English)
    partialUnchecked: 'Partial — this phone has not finished checking the whole account yet', // PROPOSED (English)
    inHandLabel: 'Income received · so far', // PROPOSED (English)
    labourSeveral: 'Labour told at different times — open the day', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function reflectCopy(language: string | null | undefined): ReflectCopy {
    return language === 'en' ? en : mr;
}
