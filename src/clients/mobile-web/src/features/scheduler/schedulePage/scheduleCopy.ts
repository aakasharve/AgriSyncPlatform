/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15) — every word the शेड्यूल page says, in one place.
 *
 * Where each word comes from:
 *   - FOUNDER / INVENTORY — quoted in PLR-D8 §1, §3a and the I15 inventory (S3, S5, S6, S10, S11):
 *     शेड्यूल, तुम्ही इथे आहात, झालं / आज / पुढे, आधी राहिलेलं काम, लिहिलेलं, जास्तीचं, मागे.
 *   - APP — already shipped: the four parts सिंचन / खत / फवारणी / कामे (`CATEGORY_LABEL_MR`).
 *   - PREVIEW — the words of the PLR-D8 preview the founder went through (`schedule/schedModel.ts` SC), reused
 *     verbatim; not separately approved (D8 decision F is open).
 *   - PROPOSED — written for this page; each carries a `// PROPOSED (Marathi)` comment and is listed in the
 *     I15 report for the founder.
 */
import type { ScheduleOwnerType } from '../scheduler.types';
import { stageNameMr as sharedStageNameMr } from '../../../shared/utils/stageNameMr';

export const SC = {
    // FOUNDER / INVENTORY
    title: 'शेड्यूल',
    here: 'तुम्ही इथे आहात',
    tabDone: 'झालं',
    tabToday: 'आज',
    tabAhead: 'पुढे',
    owedTitle: 'आधी राहिलेलं काम',
    typed: 'लिहिलेलं',
    extraWord: 'जास्तीचं',

    // PREVIEW (PLR-D8 SchedulePreview / schedModel SC)
    stage: 'स्टेज',
    dayNow: 'आजचा दिवस',
    dayTotal: 'एकूण दिवस',
    stageCount: 'स्टेज',
    progress: 'स्टेजची प्रगती',
    compareTitle: 'या स्टेजमध्ये शेड्यूल काय सांगतं आणि काय झालं',
    expectedWord: 'अपेक्षित',
    doneWord: 'झालं',
    missedWord: 'राहिलं',
    lastDays: 'मागचे दिवस',
    before: 'आधी काय झालं',
    showOlder: 'आणखी जुने दिवस दाखवा',
    today: 'आज',
    ahead: 'पुढचे दिवस',
    // The preview's words; its digits written as every other number on the page (Latin), V2-10.
    next3: '3 दिवस',
    next8: '8 दिवस',
    in8: '8 दिवसांत',
    owedSub: 'हे अजून झालेलं नाही',
    nothingOwed: 'आधीचं काहीही राहिलेलं नाही',
    tomorrow: 'उद्या',
    seeAhead: 'पुढचे सगळे दिवस पाहा',
    leftCount: (n: number) => `राहिलं ${n}`,
    owedCount: (n: number) => `राहिलेलं ${n}`,
    expectsToday: 'या शेड्यूलनुसार या दिवशी हे करणं अपेक्षित आहे',
    voiceTalk: 'त्या दिवशीचं बोलणं',
    vsTitle: 'शेड्यूल आणि प्रत्यक्ष',
    nothingToday: 'आज यात काही नाही',
    dayN: (d: number) => `दिवस ${d}`,
    dayOf: (d: number, total: number) => `दिवस ${d} / ${total}`,

    // PROPOSED (Marathi) — everything below was written for this page.
    thisPhoneClips: 'फक्त या फोनवरचं रेकॉर्डिंग दिसतं', // PROPOSED (Marathi)
    noClipsOnPhone: 'या फोनवर त्या दिवशीचं रेकॉर्डिंग नाही', // PROPOSED (Marathi)
    typedEntries: 'लिहिलेल्या नोंदी', // PROPOSED (Marathi)
    nothingRecorded: 'त्या दिवशी या प्लॉटची नोंद नाही', // PROPOSED (Marathi)
    noExpectation: 'या दिवशी शेड्यूलमध्ये काही नव्हतं', // PROPOSED (Marathi)
    nothingAhead: 'पुढच्या दिवसांत शेड्यूलमध्ये काही नाही', // PROPOSED (Marathi)
    noPastDays: 'अजून मागचे दिवस नाहीत', // PROPOSED (Marathi)
    since: (d: number) => `दिवस ${d} पासून`, // PROPOSED (Marathi)
    times: (n: number) => `${n} वेळा`, // PROPOSED (Marathi)
    notStarted: (n: number) => `शेड्यूल ${n} दिवसांनी सुरू होईल`, // PROPOSED (Marathi)
    clipsCount: (n: number) => `${n} रेकॉर्डिंग`, // PROPOSED (Marathi)
    noCrops: 'अजून एकही पीक नाही', // PROPOSED (Marathi)
    // Said to everyone who opens the page (owner, worker, मुकादम…), so it names no one who must add them.
    noCropsHint: 'पीक आणि प्लॉट जोडल्यावर इथे शेड्यूल दिसेल.', // PROPOSED (Marathi)
    noPlots: 'या पिकात अजून प्लॉट नाही', // PROPOSED (Marathi)
    noSchedule: 'या पिकासाठी अजून शेड्यूल नाही', // PROPOSED (Marathi)
    noScheduleHint: 'लायब्ररीतून शेड्यूल निवडा. तोपर्यंत इथे कोणतंही काम अपेक्षित दाखवलं जात नाही.', // PROPOSED (Marathi)
    cropPick: 'पीक', // PROPOSED (Marathi)
    plotPick: 'प्लॉट', // PROPOSED (Marathi)
    madeBy: 'कोणी बनवलं', // PROPOSED (Marathi)
    behind: (n: number) => `शेड्यूल ${n} दिवस मागे चाललं आहे`, // PROPOSED (Marathi)
    behindLine: (calendar: string, plant: string) => `कॅलेंडरप्रमाणे दिवस ${calendar} · पिकासाठी दिवस ${plant}`, // PROPOSED (Marathi)
    toolsTitle: 'आजचं आणि बाकीचं', // PROPOSED (Marathi)
    lastSpray: 'शेवटची फवारणी', // PROPOSED (Marathi)
    lastWater: 'शेवटचं पाणी', // PROPOSED (Marathi)
    noRecordYet: 'अजून नोंद नाही', // PROPOSED (Marathi)
    daysAgo: (n: number) => (n === 0 ? 'आज' : n === 1 ? 'काल' : `${n} दिवसांपूर्वी`), // PROPOSED (Marathi)
    todaySpend: 'आजचा खर्च', // PROPOSED (Marathi)
    riskTitle: 'काम मागे पडतंय', // PROPOSED (Marathi)
    pendingToday: (n: number) => `आज ${n} कामं बाकी`, // existing app line ("आज N कामं बाकी", oneAllClearSurface)
    // The farmer's own to-do tasks still open (the to-do page is "करायची कामे", reflect/todoModel).
    tasksOpen: (n: number) => `करायच्या यादीत ${n} कामं बाकी`, // PROPOSED (Marathi)
    sprayGap: (n: number) => `फवारणी करून ${n} दिवस झाले`, // PROPOSED (Marathi)
    waterGap: (n: number) => `पाणी देऊन ${n} दिवस झाले`, // PROPOSED (Marathi)
    // Shortened from the app's own close-day line "दिवस पूर्ण करण्यासाठी क्लिक करा" (dfesTranslations clickToClose).
    closeDay: 'दिवस पूर्ण करा', // PROPOSED (Marathi)
    // spec: plr-d10 lane L8b-2 - said only when a choice could not be sent to the server yet (the plot's crop season has not
    // reached it). The choice is shown as made; it goes to the other phones once the season is there.
    choiceNotSent: 'या प्लॉटचा हंगाम अजून सर्व्हरवर नाही, म्हणून ही निवड फक्त या फोनवर आहे. हंगाम सर्व्हरवर पोचल्यावर पुन्हा निवडा.', // PROPOSED (Marathi) (B009: it promises no later send; none happens)
    library: 'शेड्यूल लायब्ररी', // PROPOSED (Marathi)
    libraryLine: (n: number) => `तुमच्या पिकांसाठी ${n} शेड्यूल`, // PROPOSED (Marathi)
    editor: 'शेड्यूल बदला', // PROPOSED (Marathi)
    editorLine: 'कोणतं शेड्यूल आणि पहिल्या दिवसाची तारीख', // PROPOSED (Marathi)
    grid: 'दिवसवार तक्ता', // PROPOSED (Marathi)
    gridLine: 'प्रत्येक दिवस: सिंचन, खत, फवारणी, कामे', // PROPOSED (Marathi)
    adoptConfirm: (crop: string) => `${crop} साठी हे शेड्यूल वापरायचं?`, // PROPOSED (Marathi)
    once: 'एकदाच', // PROPOSED (Marathi) — the old "Milestone" tag
    prep: 'तयारी', // PROPOSED (Marathi) — the old grid's "PREP" (days before day 0)
    ended: 'या शेड्यूलचे सगळे दिवस संपले', // PROPOSED (Marathi)
    defaultSchedule: 'हे ॲपमधलं मूळ शेड्यूल आहे. तुम्ही अजून शेड्यूल निवडलेलं नाही.', // PROPOSED (Marathi)
    chooseSchedule: 'लायब्ररीतून शेड्यूल निवडा', // PROPOSED (Marathi)

    // the editor ("शेड्यूल बदला") — PROPOSED (Marathi) unless marked
    edPlot: 'कोणत्या प्लॉटचं शेड्यूल', // PROPOSED (Marathi)
    edSchedule: 'कोणतं शेड्यूल पाळायचं', // PROPOSED (Marathi)
    edPicked: 'निवडलं', // PROPOSED (Marathi)
    edNone: 'या पिकासाठी अजून एकही शेड्यूल आलेलं नाही. इंटरनेट चालू असताना ॲप उघडा.', // PROPOSED (Marathi) — same line as the library's
    // spec: plr-d10 lane L8b-2 (founder C2) - the editor's choice is for this plot only; the library is the door for the whole crop.
    edThisPlotOnly: 'हे शेड्यूल फक्त या प्लॉटसाठी लागू होईल. सगळ्या प्लॉटसाठी लायब्ररीतून निवडा.', // PROPOSED (Marathi)
    edDayZero: 'दिवस 0', // preview word ("दिवस")
    edTodayIs: (d: number) => `म्हणजे आज दिवस ${d}`, // PROPOSED (Marathi)
    edSave: 'जतन करा', // app word (translations `save`)
    edMeta: (days: number | null, stages: number) => `एकूण दिवस ${days ?? '—'} · स्टेज ${stages}`, // preview words
} as const;

/** The day-0 date's name, by what the schedule counts from (`ScheduleReferenceType`). */
export const DAY_ZERO_LABEL: Readonly<Record<string, string>> = {
    PRUNING: 'छाटणीची तारीख', // PROPOSED (Marathi)
    PLANTING: 'लागवडीची तारीख', // PROPOSED (Marathi)
    TRANSPLANTING: 'पुनर्लागवडीची तारीख', // PROPOSED (Marathi)
    SOWING: 'पेरणीची तारीख', // PROPOSED (Marathi)
};

/** Who made the schedule (S15). Owner TYPE in Marathi; a real person's / body's name is shown as recorded. */
export const OWNER_LABEL: Readonly<Record<ScheduleOwnerType, string>> = {
    EXPERT: 'तज्ज्ञ', // PROPOSED (Marathi)
    INSTITUTION: 'संस्था', // PROPOSED (Marathi)
    // Not "तुमचं": a worker or मुकादम reading the owner's schedule did not make it.
    USER: 'शेतकऱ्याने स्वतः बनवलेलं', // PROPOSED (Marathi)
    SYSTEM_DEFAULT: 'ॲपमधलं मूळ शेड्यूल', // PROPOSED (Marathi)
};

/** The plan engine's operations (`ClientPlanEngine` OPS) in plain Marathi. An unknown one shows its part's name. */
const OP_NAME_MR: Readonly<Record<string, string>> = {
    op_irrig_drip: 'ठिबक सिंचन', // preview word
    op_irrig_flood: 'पाटाने पाणी', // PROPOSED (Marathi)
    op_fert_gen: 'विद्राव्य खत (ठिबकातून)', // preview word
    op_spray_gen: 'फवारणी', // app word
    op_weed_man: 'खुरपणी', // PROPOSED (Marathi)
    op_pruning: 'छाटणी', // PROPOSED (Marathi)
    op_thinning: 'विरळणी', // PROPOSED (Marathi)
    op_harvest: 'काढणी', // PROPOSED (Marathi)
    op_pest_scout: 'कीड पाहणी', // PROPOSED (Marathi)
    op_field_prep: 'शेत तयार करणे', // PROPOSED (Marathi)
    op_drainage_audit: 'पाण्याचा निचरा तपासणे', // PROPOSED (Marathi)
    op_gap_fill: 'नांगे भरणे', // PROPOSED (Marathi)
    op_earthing_up: 'भर देणे', // PROPOSED (Marathi)
    op_growth_check: 'वाढ तपासणे', // PROPOSED (Marathi)
    op_quality_check: 'प्रत तपासणे', // PROPOSED (Marathi)
    op_harvest_plan: 'काढणीचं नियोजन', // PROPOSED (Marathi)
    op_post_harvest_cleanup: 'काढणीनंतर साफसफाई', // PROPOSED (Marathi)
    op_phi_watch: 'फवारणीनंतरचे थांबायचे दिवस तपासणे', // PROPOSED (Marathi)
};

export const opNameMr = (opId: string): string | undefined => OP_NAME_MR[opId];

/**
 * The reference schedules' stage names in Marathi — spec I18: ONE table for the whole app (`shared/utils/stageNameMr`,
 * which now holds the words this file used to keep). A name it does not know is the schedule's own data and is
 * shown as it is.
 */
export const stageNameMr = (name: string): string => sharedStageNameMr(name) ?? name;

/** "दर 3 दिवसांनी" / "आठवड्यातून 2 वेळा" — the preview's own phrasing of how often. */
export const frequencyMr = (mode: string, value: number): string =>
    mode === 'PER_WEEK' ? `आठवड्यातून ${value} वेळा` : `दर ${value} दिवसांनी`;
