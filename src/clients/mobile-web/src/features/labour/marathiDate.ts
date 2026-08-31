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
