/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The phone's half of the card code, the phone number and
 * the home PIN — the same rules as the server's (ShramSafal.Domain.Identity): it only decides what may be SENT; the
 * server stays the judge.
 *
 *   - Card code (R6): 8 characters of Crockford's alphabet (no I, L, O, U), shown SS-XXXX-XXXX. The QR holds only
 *     https://shramsafal.in/w/<code> — never a name, a number or Aadhaar.
 *   - Phone: an Indian mobile, 10 digits starting 6-9 (a +91 / 0 prefix is dropped).
 *   - Home PIN (R11, section 10): exactly 6 digits, the first 1-9. Never an address.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CARD_URL_PREFIX = 'https://shramsafal.in/w/';

/** The 8-character body of a scanned or typed code (any form), or null when it is not a card code. */
export function normalizeCardCode(input: string | null | undefined): string | null {
    if (!input || !input.trim()) return null;
    let text = input.trim();
    const slash = text.toLowerCase().lastIndexOf('/w/');
    if (slash >= 0) text = text.slice(slash + 3);
    let body = '';
    for (const raw of text.toUpperCase()) {
        if (raw === ' ' || raw === '-' || raw === '.' || raw === '_' || raw === '/') continue;
        body += raw === 'O' ? '0' : raw === 'I' || raw === 'L' ? '1' : raw;
    }
    if (body.length === 10 && body.startsWith('SS')) body = body.slice(2);
    return body.length === 8 && [...body].every((c) => ALPHABET.includes(c)) ? body : null;
}

/** SS-XXXX-XXXX for a body or an already-displayed code. */
export function displayCardCode(code: string): string {
    const body = normalizeCardCode(code) ?? code;
    return body.length === 8 ? `SS-${body.slice(0, 4)}-${body.slice(4)}` : code;
}

/** What the QR holds — the card address only. */
export const cardQrPayload = (code: string): string => CARD_URL_PREFIX + displayCardCode(code);

/** Ten digits of an Indian mobile (6-9 first), or null. */
export function normalizeIndianMobile(input: string | null | undefined): string | null {
    let digits = (input ?? '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return digits.length === 10 && /^[6-9]/.test(digits) ? digits : null;
}

/** A 6-digit PIN code that does not start with 0, or null. */
export function normalizeHomePin(input: string | null | undefined): string | null {
    const digits = (input ?? '').replace(/\s/g, '');
    return /^[1-9]\d{5}$/.test(digits) ? digits : null;
}
