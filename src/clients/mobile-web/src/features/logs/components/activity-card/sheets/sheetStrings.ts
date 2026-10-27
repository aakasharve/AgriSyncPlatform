/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-27, round 3) — the words of the detail
 * sheets the review / edit form opens (labour, water, machine, spray / fertiliser, work, expense, a problem, a
 * note or reminder). Same rule as activityCardStrings.ts: Marathi mode Marathi only, English mode English only.
 *   - English: each sheet's own English, word for word as it was (an English user sees no change) — except the
 *     labour sheet's hours label, which was Marathi in BOTH languages and is now English for an English user;
 *   - Marathi: APPROVED where read from the app's translations (`t(key, 'mr')`), else PROPOSED (Marathi), marked.
 * Every "Save …" / "Confirm Details" button reads the app's APPROVED "जतन करा" in Marathi.
 */
import { t } from '../../../../../i18n/translations';
import { useOptionalLanguage } from '../../../../../i18n/LanguageContext';
import type { Language } from '../../../../../i18n/language';
import type { BucketIssueSeverity, BucketIssueType } from '../../../../../domain/types/log.types';
import { valueIn } from '../activityCardStrings';

export interface SheetStrings {
    confirmDetails: string; saveInput: string; saveWork: string; saveExpense: string; saveIssue: string; add: string;
    value: (v: string | number | undefined | null) => string;
    // labour / water / machine sheet
    detailTitle: (type: 'labour' | 'irrigation' | 'machinery') => string;
    labourTab: (tab: 'HIRED' | 'CONTRACT' | 'SELF') => string;
    totalLabours: string; maleSplit: string; femaleSplit: string;
    splitMismatch: (split: number, total: number) => string;
    hoursWorked: string; totalPaidAuto: string; basedOnShift: string;
    unit: string; contractUnit: (unit: 'Tree' | 'Acre' | 'Row' | 'Lump Sum') => string;
    quantity: string; noOfTrees: string; qty: string; contractAmount: string;
    selfTitle: string; selfNoCost: string;
    hoursChip: (h: number) => string; source: string; selectMotor: string; method: string;
    usageHours: string; hoursMandatory: string; rentalCost: string; fuelCost: string;
    // spray / fertiliser sheet
    inputTitle: (spray: boolean) => string; carrierDetails: string; equipment: string; selectEquipment: string;
    machineOption: (name: string, capacity: number | string) => string; standardBlower: string; handTank: string;
    countLabel: (method: string) => string; countUnit: (method: string) => string;
    mixItems: string; addItem: string; productName: string; dose: string;
    doseUnit: (unit: 'ml/L' | 'g/L' | 'kg/ac' | 'L/ac') => string;
    linked: string; unlink: string; noProducts: string; reason: string; recommendedBy: string;
    // work sheet
    workTitle: string; youSaid: string; unsure: string; selectActivities: string; addOther: string;
    // expense sheet
    expenseTitle: string; expenseAlt: string; expenseReason: string; expenseReasonHint: string; totalAmount: string;
    notesOptional: string; notesHint: string; expenseDefault: string;
    // problem sheet
    issueTitle: string; whatWentWrong: string; impactLevel: string; description: string; descriptionHint: string;
    moreOptional: string; moreHint: string; describeFirst: string;
    issueType: (type: BucketIssueType) => string; severity: (level: BucketIssueSeverity) => string;
    // note / reminder sheet
    noteTitle: (reminder: boolean) => string; noteHint: (reminder: boolean) => string; noteSave: (reminder: boolean) => string; farm: string;
}

const EN_ISSUES: Record<BucketIssueType, string> = {
    MACHINERY: 'Machinery Breakdown', ELECTRICITY: 'No Electricity', WATER_SOURCE: 'Water Issue', LABOR_SHORTAGE: 'Labour Shortage',
    MATERIAL_SHORTAGE: 'Material Shortage', WEATHER: 'Weather Block', PEST: 'Pest Outbreak', DISEASE: 'Disease', OTHER: 'Other Issue',
};
const EN_SEVERITY: Record<BucketIssueSeverity, string> = {
    LOW: 'Minor - Work continued', MEDIUM: 'Major - Work impacted', HIGH: 'Critical - Work stopped',
};

const EN: SheetStrings = {
    confirmDetails: 'Confirm Details', saveInput: 'Save Input Application', saveWork: 'Save Work Details', saveExpense: 'Save Expense',
    saveIssue: 'Save Issue Report', add: 'Add', value: valueIn('en'),
    detailTitle: type => (type === 'labour' ? 'Labour Details' : type === 'irrigation' ? 'Daily Irrigation' : 'Machinery Usage'),
    labourTab: tab => (tab === 'HIRED' ? 'Daily Wage' : tab === 'CONTRACT' ? 'Contract' : 'Self'),
    totalLabours: 'Total Labours', maleSplit: 'Male Split', femaleSplit: 'Female Split',
    splitMismatch: (split, total) => `Split (${split}) doesn't match Total (${total})`,
    hoursWorked: 'Hours worked', totalPaidAuto: 'Total Paid (Auto)', basedOnShift: 'Based on shift rates',
    unit: 'Unit', contractUnit: unit => (unit === 'Lump Sum' ? 'Lump Sum' : `Per ${unit}`),
    quantity: 'Quantity', noOfTrees: 'No. of Trees', qty: 'Qty', contractAmount: 'Total Contract Amount (₹)',
    selfTitle: 'Self / Family Labour', selfNoCost: 'No cost will be recorded for this activity.',
    hoursChip: h => `${h}h`, source: 'Source', selectMotor: 'Select Motor', method: 'Method',
    usageHours: 'Usage (Hrs)', hoursMandatory: 'Hours mandatory for owned', rentalCost: 'Rental Cost (₹)', fuelCost: 'Fuel Cost (₹)',
    inputTitle: spray => (spray ? 'Spray Application' : 'Nutrition & Fertigation'), carrierDetails: 'Carrier Details',
    equipment: 'Equipment', selectEquipment: 'Select Blower/Tank...',
    machineOption: (name, cap) => `${name} (${cap}L)`, standardBlower: 'Standard Blower (600L)', handTank: 'Hand Tank (20L)',
    countLabel: m => (m === 'Drip' ? 'Hours' : 'Count'), countUnit: m => (m === 'Drip' ? 'Hrs' : m === 'Soil' ? 'Pati' : 'Qty'),
    mixItems: 'Mix Items', addItem: 'Add Item', productName: 'Product Name', dose: 'Dose', doseUnit: unit => unit,
    linked: 'Linked to Inventory', unlink: 'Unlink', noProducts: 'No products added.', reason: 'Reason',
    recommendedBy: 'Recommended By (e.g. Dealer Name)',
    workTitle: 'Work Done', youSaid: 'YOU SAID:', unsure: t('voice.unverifiedSourceLabel', 'en'),
    selectActivities: 'Select activities performed today:', addOther: 'Add other activity...',
    expenseTitle: 'Add Expense', expenseAlt: 'Expense', expenseReason: 'Expense Reason', expenseReasonHint: 'e.g. Nylon Rope, Tea, Transport',
    totalAmount: 'Total Amount (₹)', notesOptional: 'Notes (Optional)', notesHint: 'Additional details...', expenseDefault: 'Expense',
    issueTitle: 'Report Issue', whatWentWrong: 'What went wrong?', impactLevel: 'Impact Level', description: 'Description',
    descriptionHint: 'e.g. Pump burned out due to voltage', moreOptional: 'Additional Check (Optional)', moreHint: 'More details...',
    describeFirst: 'Please describe the issue',
    issueType: type => EN_ISSUES[type], severity: level => EN_SEVERITY[level],
    noteTitle: r => `Add ${r ? 'Reminder' : 'Observation'}`,
    noteHint: r => (r ? 'What do you need to be reminded of?' : 'Record crop growth, noticeable issues, or general log notes...'),
    noteSave: r => `Save ${r ? 'Reminder' : 'Observation'}`, farm: 'Farm',
};

// APPROVED — the no-work-day causes (dfes.noWorkReason.*) for the six problem kinds they share.
const reasonMr = (key: string): string => t(`dfes.noWorkReason.${key}`, 'mr');
const MR_ISSUES: Record<BucketIssueType, string> = {
    MACHINERY: reasonMr('machinery'), ELECTRICITY: reasonMr('electricity'), WATER_SOURCE: reasonMr('water'),
    LABOR_SHORTAGE: reasonMr('labour'), WEATHER: reasonMr('weather'), OTHER: reasonMr('other'),
    MATERIAL_SHORTAGE: 'माल कमी पडला', // PROPOSED (Marathi)
    PEST: 'कीड', // PROPOSED (Marathi)
    DISEASE: 'रोग', // PROPOSED (Marathi)
};
// PROPOSED (Marathi) — how much the problem stopped the work.
const MR_SEVERITY: Record<BucketIssueSeverity, string> = {
    LOW: 'थोडी अडचण — काम चालू राहिलं', MEDIUM: 'मोठी अडचण — कामावर परिणाम झाला', HIGH: 'गंभीर — काम थांबलं',
};
// PROPOSED (Marathi) — a contract's unit and a dose's unit.
const MR_CONTRACT: Record<'Tree' | 'Acre' | 'Row' | 'Lump Sum', string> = {
    Tree: 'प्रति झाड', Acre: `प्रति ${t('profile.acre', 'mr')}`, Row: 'प्रति ओळ', 'Lump Sum': 'एकरकमी',
};
const MR_DOSE: Record<'ml/L' | 'g/L' | 'kg/ac' | 'L/ac', string> = {
    'ml/L': 'मिली/लिटर', 'g/L': 'ग्रॅम/लिटर', 'kg/ac': 'किलो/एकर', 'L/ac': 'लिटर/एकर',
};
const SAVE_MR = t('confirmation.save', 'mr'); // APPROVED "जतन करा"
const AUTO = 'आपोआप मोजलं'; // FOUNDER — PLR-D1: a total the app worked out itself is labelled so.

const MR: SheetStrings = {
    confirmDetails: SAVE_MR, saveInput: SAVE_MR, saveWork: SAVE_MR, saveExpense: SAVE_MR, saveIssue: SAVE_MR,
    add: t('common.add', 'mr'), // APPROVED "जोडा"
    value: valueIn('mr'),
    // PROPOSED (Marathi) — the three sheet titles.
    detailTitle: type => (type === 'labour' ? 'मजुरीचा तपशील' : type === 'irrigation' ? 'आजचं पाणी' : 'यंत्राचा वापर'),
    labourTab: tab => (tab === 'HIRED' ? t('settings.dailyWage', 'mr') : tab === 'CONTRACT' ? 'उक्ते' : 'स्वतः'), // APPROVED / PROPOSED (Marathi)
    totalLabours: 'एकूण मजूर', // PROPOSED (Marathi)
    maleSplit: t('workSummary.maleWorkers', 'mr'), femaleSplit: t('workSummary.femaleWorkers', 'mr'), // APPROVED
    splitMismatch: (split, total) => `पुरुष + महिला (${split}) एकूण मजुरांशी (${total}) जुळत नाही`, // PROPOSED (Marathi)
    hoursWorked: 'कामाचे तास', // the label this sheet already had
    totalPaidAuto: `एकूण मजुरी (${AUTO})`, // PROPOSED (Marathi)
    basedOnShift: 'पाळीच्या दरानुसार', // PROPOSED (Marathi)
    unit: t('profile.unit', 'mr'), // APPROVED "एकक"
    contractUnit: unit => MR_CONTRACT[unit],
    quantity: 'प्रमाण', noOfTrees: 'झाडांची संख्या', qty: 'प्रमाण', // PROPOSED (Marathi)
    contractAmount: 'उक्त्याची एकूण रक्कम (₹)', // PROPOSED (Marathi)
    selfTitle: 'स्वतः / घरचे काम', selfNoCost: 'या कामाचा खर्च लिहिला जाणार नाही.', // PROPOSED (Marathi)
    hoursChip: h => `${h} तास`, // PROPOSED (Marathi)
    source: 'स्रोत', // PROPOSED (Marathi)
    selectMotor: t('profile.selectMotor', 'mr'), method: t('workSummary.method', 'mr'), // APPROVED
    usageHours: 'वापर (तास)', hoursMandatory: 'स्वतःच्या यंत्रासाठी तास लिहा', // PROPOSED (Marathi)
    rentalCost: `${t('workSummary.rentalCost', 'mr')} (₹)`, fuelCost: `${t('workSummary.fuelCost', 'mr')} (₹)`, // APPROVED
    // PROPOSED (Marathi) — the spray / fertiliser sheet.
    inputTitle: spray => (spray ? 'फवारणी' : 'खत आणि ठिबकमधून खत'),
    carrierDetails: 'कशातून दिलं', equipment: 'साधन', selectEquipment: 'ब्लोअर / टाकी निवडा...',
    machineOption: (name, cap) => `${name} (${cap} लिटर)`, standardBlower: 'नेहमीचा ब्लोअर (600 लिटर)', handTank: 'हातपंप (20 लिटर)',
    countLabel: m => (m === 'Drip' ? 'तास' : 'संख्या'), countUnit: m => (m === 'Drip' ? 'तास' : m === 'Soil' ? 'पाटी' : 'नग'),
    mixItems: 'मिश्रणातील औषधे / खते', addItem: 'औषध / खत जोडा', productName: 'औषध / खताचे नाव', dose: 'मात्रा',
    doseUnit: unit => MR_DOSE[unit],
    linked: 'खरेदीशी जोडलेलं', unlink: 'जोड काढा', noProducts: 'अजून काही जोडलेलं नाही.', reason: 'कारण',
    recommendedBy: 'कोणी सांगितलं (उदा. दुकानदाराचं नाव)',
    // PROPOSED (Marathi) — the work sheet (its title is the ring's FOUNDER label).
    workTitle: 'झालेली कामे', youSaid: 'तुम्ही म्हणालात:', unsure: t('voice.unverifiedSourceLabel', 'mr'), // APPROVED flag
    selectActivities: 'आज केलेली कामे निवडा:', addOther: 'दुसरं काम लिहा...',
    // PROPOSED (Marathi) — the expense sheet.
    expenseTitle: 'खर्च जोडा', expenseAlt: 'खर्च', expenseReason: 'कशासाठी खर्च', expenseReasonHint: 'उदा. नायलॉन दोरी, चहा, वाहतूक',
    totalAmount: 'एकूण रक्कम (₹)', notesOptional: 'टीप (हवी तर)', notesHint: 'आणखी तपशील...', expenseDefault: 'खर्च',
    // PROPOSED (Marathi) — the problem sheet.
    issueTitle: 'अडचण सांगा', whatWentWrong: 'काय झालं?', impactLevel: 'किती परिणाम झाला?', description: 'थोडक्यात',
    descriptionHint: 'उदा. व्होल्टेजमुळे पंप जळाला', moreOptional: 'आणखी माहिती (हवी तर)', moreHint: 'आणखी तपशील...',
    describeFirst: 'अडचण थोडक्यात लिहा',
    issueType: type => MR_ISSUES[type], severity: level => MR_SEVERITY[level],
    // PROPOSED (Marathi) — the note / reminder sheet.
    noteTitle: r => (r ? 'आठवण जोडा' : 'निरीक्षण जोडा'),
    noteHint: r => (r ? 'कशाची आठवण हवी आहे?' : 'पिकाची वाढ, दिसलेल्या अडचणी किंवा इतर काही लिहा...'),
    noteSave: () => SAVE_MR, farm: 'शेत',
};

export const sheetStrings = (language: Language): SheetStrings => (language === 'en' ? EN : MR);

/** The sheets' words in the chosen language. Outside the provider (tests, previews): the app's default, Marathi. */
export function useSheetStrings(): SheetStrings {
    return sheetStrings(useOptionalLanguage()?.language ?? 'mr');
}
