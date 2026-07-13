/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The CANONICAL labour data points + a lightweight client-side parser for the
 * UAT demo. A labour entry always has the SAME shape everywhere (attendance,
 * review, reflect, worker) — that shape is `LabourEntry` below.
 *
 * NOTE: this client parser is a UAT stand-in so the demo feels intelligent.
 * The real, reliable extraction (and "is this labour?" judgement) is the
 * server AI engine — this same `LabourEntry` shape is what it fills.
 */

export type LabourShift = 'full' | 'half' | 'night';

/** The canonical data points of one labour entry — identical across all screens. */
export interface LabourEntry {
    /** true if the speech is about labour at all; false → flag "not relevant to labour". */
    relevant: boolean;
    count: number | null;       // मजूर संख्या
    shift: LabourShift | null;  // पूर्ण / अर्धा / रात्रपाळी
    task: string | null;        // काम (छाटणी / फवारणी …)
    amount: number | null;      // मजुरी / उचल (₹), if specifically said
    names: string[];            // नावं (matched workers)
}

export const SHIFT_LABEL: Record<LabourShift, string> = {
    full: 'पूर्ण दिवस',
    half: 'अर्धा दिवस',
    night: 'रात्रपाळी',
};

const DIGITS = '०१२३४५६७८९';
const devToAscii = (s: string) => s.replace(/[०-९]/g, (ch) => String(DIGITS.indexOf(ch)));

const MR_NUM: Record<string, number> = {
    एक: 1, दोन: 2, तीन: 3, चार: 4, पाच: 5, सहा: 6, सात: 7, आठ: 8, नऊ: 9, दहा: 10,
    अकरा: 11, बारा: 12, तेरा: 13, चौदा: 14, पंधरा: 15, सोळा: 16, सतरा: 17, अठरा: 18, एकोणीस: 19, वीस: 20,
    एकवीस: 21, बावीस: 22, तेवीस: 23, चोवीस: 24, पंचवीस: 25, तीस: 30, पस्तीस: 35, चाळीस: 40, पन्नास: 50,
};
const MR_WORDS = Object.keys(MR_NUM).sort((a, b) => b.length - a.length);

/** Parse a single token ("दहा" or "१०" or "6") to a number. */
const parseToken = (tok: string): number | null => {
    const d = devToAscii(tok).match(/\d+/);
    if (d) { const n = parseInt(d[0], 10); return n > 0 ? n : null; }
    return MR_NUM[tok] ?? null;
};

/** First standalone number in the text (digits or Marathi word), for headcount. */
export const parseHeadcount = (text: string): number | null => {
    const d = devToAscii(text).match(/\d+/);
    if (d) { const n = parseInt(d[0], 10); if (n > 0 && n < 100000) return n; }
    for (const w of MR_WORDS) { if (text.includes(w)) return MR_NUM[w]; }
    return null;
};

const PEOPLE_RE = /(\S+)\s*(?:लोक|मजूर|मजुर|जण|गडी|बाई|बायका|माणस|कामगार)/;
const MONEY_KW = /₹|रुपये|रुपया|मजुरी|रोजंदारी|पगार|उचल|पैसे/;
const LABOUR_KW = ['लोक', 'मजूर', 'मजुर', 'कामगार', 'जण', 'गडी', 'बाई', 'बायका', 'शिफ्ट', 'दिवस', 'अर्ध', 'पूर्ण', 'रात्र', 'मजुरी', 'रोजंदारी', 'उचल', 'पगार', 'काम', 'हजेरी', 'हजर'];
const TASKS: Record<string, string> = {
    छाटणी: 'छाटणी', फवारणी: 'फवारणी', खुरपणी: 'खुरपणी', तण: 'तण काढणी', पाणी: 'पाणी देणे',
    लागवड: 'लागवड', काढणी: 'काढणी', बांधणी: 'बांधणी', खत: 'खत',
};

const parseAmount = (text: string): number | null => {
    if (!MONEY_KW.test(text)) return null;
    const m = devToAscii(text).match(/\d{2,}/); // amounts are usually 2+ digits
    if (m) return parseInt(m[0], 10);
    if (text.includes('पाचशे')) return 500;
    if (text.includes('दोनशे')) return 200;
    if (text.includes('तीनशे')) return 300;
    if (text.includes('हजार')) return 1000;
    return null;
};

/** Extract the canonical labour data points from a Marathi transcript. */
export const parseLabour = (text: string, roster: string[] = []): LabourEntry => {
    const names = roster.filter((n) => n && text.includes(n));
    const relevant = LABOUR_KW.some((k) => text.includes(k)) || names.length > 0;

    let count: number | null = null;
    const cm = text.match(PEOPLE_RE);
    if (cm) count = parseToken(cm[1]);
    if (count == null && /लोक|मजूर|मजुर|जण/.test(text)) count = parseHeadcount(text);

    let shift: LabourShift | null = null;
    if (/रात्र|नाईट/.test(text)) shift = 'night';
    else if (/अर्ध|हाफ/.test(text)) shift = 'half';
    else if (/पूर्ण|अख्खा|फुल|दिवसभर/.test(text)) shift = 'full';

    let task: string | null = null;
    for (const k of Object.keys(TASKS)) { if (text.includes(k)) { task = TASKS[k]; break; } }

    return { relevant, count, shift, task, amount: parseAmount(text), names };
};
