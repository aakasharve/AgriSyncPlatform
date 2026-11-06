/**
 * spec: plr-d10 lane RATE-1 part A — how a rate reads on screen. A rate is shown to the paisa it was set at (never rounded
 * into a different number, P4); a date in the screen's language; "per what" from the basis, or the unit he named.
 */
import type { FarmRateWords } from './farmRateWords';
import type { FarmRateRow } from './farmRateSchema';

export function rateRupees(amount: number): string {
    return `₹ ${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function rateDate(dateKey: string | null | undefined, language: string): string {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}/.test(dateKey)) return '';
    const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN-u-nu-latn', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(at);
}

export function rateMoment(isoUtc: string, language: string): string {
    const at = new Date(isoUtc);
    if (Number.isNaN(at.getTime())) return '';
    return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN-u-nu-latn', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    }).format(at);
}

/** "/ पोते" for an input, "दिवसाला" for work. */
export function perWhat(row: Pick<FarmRateRow, 'kind' | 'unit' | 'basis'>, words: FarmRateWords): string {
    return row.kind === 'Input' && row.unit ? `/ ${row.unit}` : words.basis[row.basis];
}
