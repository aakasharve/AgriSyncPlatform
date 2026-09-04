/**
 * Marathi calendar primitives, shared. These lived privately inside
 * `reviewDetailDate.ts` until the window range needed the same month names
 * and the same digits; a second private copy would have been two spellings
 * of ऑगस्ट waiting to disagree on one screen.
 *
 * THE MONTH NAMES ARE NOT NEW COPY. They are the abbreviated set already
 * shipping on review cards ("१९ जुलै"), moved here verbatim. Adding a month
 * spelling, or expanding these to their full forms, is a founder decision.
 */

/** Abbreviated Marathi months, जानेवारी-first, indexed by `Date.getMonth()`. */
export const MARATHI_MONTHS = [
    'जाने', 'फेब्रु', 'मार्च', 'एप्रिल', 'मे', 'जून',
    'जुलै', 'ऑग', 'सप्टें', 'ऑक्टो', 'नोव्हें', 'डिसें',
];

/**
 * Weekday letters for the हजेरी वही column heads, indexed by `Date.getDay()`
 * so index 0 is Sunday. NOT new copy: these are the same seven letters the
 * labour mock has always rendered (`labourMock.ts`), moved somewhere the live
 * register can reach them.
 */
export const MARATHI_WEEKDAY_LETTERS = ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'];

/**
 * A ledger column head. The server sends ISO dates — a machine date must never
 * reach a farmer, and it would not fit a 26px column anyway.
 *
 * Anything that is not an ISO date is returned UNCHANGED, which is what keeps
 * the preview/mock fixtures (already Marathi letters) rendering as they always
 * have. Never blank: a column with no head would silently shift every cell
 * under it against the wrong day.
 */
export function formatLedgerDayHead(day: string): string {
    const parsed = parseIsoDate(day);
    return parsed ? MARATHI_WEEKDAY_LETTERS[parsed.getDay()] : day;
}

/** ASCII digits to Devanagari. Non-digits pass through untouched. */
export const toMarathiDigits = (n: number): string =>
    String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-MM-dd` to a local-midnight Date, or null unless it is exactly that shape. */
export function parseIsoDate(value: string): Date | null {
    if (!ISO_DATE_RE.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The window's real boundaries as a readable Marathi range — "२४–३० ऑग",
 * or "२८ ऑग – ३ सप्टें" when it straddles a month, or "३१ ऑग" for one day.
 *
 * Returns '' when EITHER boundary is missing, and that is the honest answer,
 * not a gap: an unbounded window (आजपर्यंत) has no range to state, and a
 * half-open one has no range this can name without inventing the other end.
 * The caller renders nothing rather than a range it cannot stand behind.
 *
 * The boundaries MUST be the ones the server actually filtered on. A range
 * this client computed for itself could disagree with the numbers beside it,
 * which is the precise failure the window work exists to prevent.
 */
export function formatWindowRange(from: string, to: string): string {
    const start = parseIsoDate(from);
    const end = parseIsoDate(to);
    if (!start || !end || end < start) return '';

    const startDay = toMarathiDigits(start.getDate());
    const endDay = toMarathiDigits(end.getDate());
    const startMonth = MARATHI_MONTHS[start.getMonth()];
    const endMonth = MARATHI_MONTHS[end.getMonth()];

    if (start.getTime() === end.getTime()) return `${startDay} ${startMonth}`;
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
        return `${startDay}–${endDay} ${startMonth}`;
    }
    return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

/**
 * Full Marathi month forms, for sentence copy. The D5 confirmation line
 * ("4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल", founder master review
 * 2026-09-02) writes the month in full — सप्टेंबर is the founder's own
 * spelling; the other eleven are the standard dictionary full forms of the
 * months abbreviated above, surfaced at the Task 2.3 founder gate rather than
 * silently invented. The abbreviated set stays the register/date-header
 * vocabulary.
 */
export const MARATHI_MONTHS_FULL = [
    'जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून',
    'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर',
];
