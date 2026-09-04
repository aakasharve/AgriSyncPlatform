/**
 * जबाबदारी द्या — duration chips and their end instants (founder master review
 * 2026-09-02, D5). Approved copy, verbatim: आज · 2 दिवस · 3 दिवस · तारीख ·
 * कायम; ON-state "कामगारांची जबाबदारी आहे"; end-line pattern
 * "4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल".
 *
 * NO PERMISSION VOCABULARY, EVER — not permission, grant, role, claim, policy,
 * access — in any string this module produces.
 *
 * Durations count the FARMER'S local days and include today: आज ends at
 * tonight's local midnight; "2 दिवस" at the midnight after tomorrow; a picked
 * तारीख runs THROUGH that date (ends at the following local midnight); कायम
 * has no end. The server stores and compares the UTC instant (strict
 * now < expiresAt).
 */
import { MARATHI_MONTHS_FULL, parseIsoDate } from '../../labour/marathiDate';

export type ResponsibilityDurationChip = 'today' | 'twoDays' | 'threeDays' | 'date' | 'permanent';

export const DURATION_CHIPS: ReadonlyArray<{ chip: ResponsibilityDurationChip; label: string }> = [
    { chip: 'today', label: 'आज' },
    { chip: 'twoDays', label: '2 दिवस' },
    { chip: 'threeDays', label: '3 दिवस' },
    { chip: 'date', label: 'तारीख' },
    { chip: 'permanent', label: 'कायम' },
];

const localMidnightPlusDays = (from: Date, days: number): Date =>
    new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);

/**
 * The UTC instant a chip's responsibility ends, or null for कायम.
 * THROWS on a missing/unparseable picked date rather than returning null —
 * null MEANS कायम, and a bad date must never silently become "forever".
 */
export function expiryUtcForChip(
    chip: ResponsibilityDurationChip,
    now: Date,
    pickedIsoDate?: string,
): string | null {
    switch (chip) {
        case 'today': return localMidnightPlusDays(now, 1).toISOString();
        case 'twoDays': return localMidnightPlusDays(now, 2).toISOString();
        case 'threeDays': return localMidnightPlusDays(now, 3).toISOString();
        case 'date': {
            const picked = pickedIsoDate ? parseIsoDate(pickedIsoDate) : null;
            if (!picked) {
                throw new Error('a तारीख chip needs a valid picked date — null here would mean कायम');
            }
            return localMidnightPlusDays(picked, 1).toISOString();
        }
        case 'permanent': return null;
    }
}

/**
 * "4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल" — names the day the
 * responsibility runs THROUGH (the expiry instant is the following local
 * midnight, so the named day is expiry − 1 day). Latin digits for the day
 * number, exactly as the founder's own line writes "4" (numerals convention).
 * Returns '' for कायम — no end, no line — and '' for an unparseable instant
 * rather than a fabricated date.
 */
export function responsibilityEndLine(expiresAtUtc: string | null): string {
    if (!expiresAtUtc) return '';
    const expiry = new Date(expiresAtUtc);
    if (Number.isNaN(expiry.getTime())) return '';
    const through = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate() - 1);
    return `${through.getDate()} ${MARATHI_MONTHS_FULL[through.getMonth()]}पर्यंत · नंतर जबाबदारी आपोआप संपेल`;
}
