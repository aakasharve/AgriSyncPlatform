/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — founder change note of 2026-11-17 on the ten-box phone number
 * ("too unrealistic, make simple boxes that align with the UI"). Replaces PhoneDigitBoxes (lane UI-5, D-149 item 1).
 *
 * The phone number as ONE plain field, the same look as the password field under it, with +91 fixed at the left
 * inside the same box.
 * - typing, pasting (with or without +91 / 0, spaces, dashes) and Devanagari digits all end as at most 10 plain digits;
 * - a short amber note only when the first digit is not 6-9;
 * - no counter and no per-digit boxes.
 *
 * The caller gets ONE string of digits (`onChange`), exactly as the first single input gave it. The element id is on the
 * real input, so a label click, a password manager and the e2e helper's Playwright `fill()` work as before.
 */
import React from 'react';
import type { Language } from '../../i18n/language';

export const PHONE_LENGTH = 10;

/** Digits only (Devanagari digits are turned into 0-9), at most 10. Pure. */
export function sanitizePhoneDigits(raw: string): string {
    const ascii = raw.replace(/[०-९]/g, ch => String(ch.charCodeAt(0) - 0x0966));
    return ascii.replace(/\D+/g, '').slice(0, PHONE_LENGTH);
}

/** A typed or pasted number: drop a leading +91 / 91 / 0 when what is left is still a full number. */
export function phoneFromPaste(raw: string): string {
    const digits = raw.replace(/[०-९]/g, ch => String(ch.charCodeAt(0) - 0x0966)).replace(/\D+/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits.slice(0, PHONE_LENGTH);
}

const COPY: Record<Language, { prefix: string; start: string }> = {
    mr: {
        prefix: 'देशाचा कोड +91',
        start: 'भारतीय मोबाईल नंबर ६, ७, ८ किंवा ९ ने सुरू होतो.', // PROPOSED (Marathi)
    },
    en: {
        prefix: 'Country code +91',
        start: 'Indian mobile numbers start with 6, 7, 8 or 9.',
    },
};

export interface PhoneFieldProps {
    /** The digits typed so far (0 to 10 characters). */
    value: string;
    onChange: (digits: string) => void;
    /** Element id of the real input (the label's `htmlFor`, the e2e helper's selector). */
    id: string;
    disabled?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    /** The caller's browser autofill hint (the sign-in page passes "username" for the password manager). */
    autoComplete?: string;
    /** The chosen language (the caller already has it; no context lookup here). */
    language: Language;
    /** A taller field with larger digits for the one-job join screen. */
    large?: boolean;
}

const PhoneField: React.FC<PhoneFieldProps> = ({
    value, onChange, id, placeholder, disabled = false, autoFocus = false, autoComplete = 'tel-national', language, large = false,
}) => {
    const t = COPY[language];
    const digits = sanitizePhoneDigits(value);
    const badStart = digits.length > 0 && !/^[6-9]/.test(digits);

    return (
        <div className="space-y-1.5" data-testid="phone-field">
            <div
                dir="ltr"
                className={`flex w-full items-stretch overflow-hidden rounded-xl border border-stone-200 bg-white focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-200/60 ${disabled ? 'opacity-60' : ''}`}
            >
                <span
                    className={`flex shrink-0 select-none items-center border-r border-stone-200 bg-stone-50 px-3 font-bold text-stone-700 ${large ? 'text-lg' : 'text-sm'}`}
                    aria-label={t.prefix}
                    data-testid="phone-prefix"
                >
                    +91
                </span>
                <input
                    id={id}
                    type="tel"
                    inputMode="numeric"
                    autoComplete={autoComplete}
                    autoFocus={autoFocus}
                    value={digits}
                    placeholder={placeholder}
                    disabled={disabled}
                    maxLength={14}
                    onChange={e => onChange(phoneFromPaste(e.target.value))}
                    className={`min-w-0 flex-1 bg-transparent px-3 font-medium tracking-wide text-stone-900 outline-none placeholder:text-stone-400 ${large ? 'py-3 text-lg' : 'py-2.5 text-sm'}`}
                />
            </div>
            {badStart && (
                <p data-testid="phone-bad-start" role="status" className="text-xs font-semibold text-amber-700">
                    {t.start}
                </p>
            )}
        </div>
    );
};

export default PhoneField;
