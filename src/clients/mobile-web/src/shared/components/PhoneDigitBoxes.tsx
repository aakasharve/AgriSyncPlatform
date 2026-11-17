/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane UI-5 (founder D-149 item 1).
 *
 * The phone number as ten numbered boxes: one digit per box, the +91 as a fixed prefix.
 * - typing a digit moves to the next box; Backspace erases the digit and steps back;
 * - a whole number can be pasted (with or without +91 / 0, spaces, dashes);
 * - tapping a box puts the caret there, so one digit can be changed without retyping the rest;
 * - a calm "N अंक बाकी" line while fewer than 10 digits, a short note when the first digit is not 6-9.
 *
 * The caller still gets ONE string of digits (`onChange`), exactly as the old single input gave it.
 * A visually hidden real input carries the caller's element id (`#auth-phone`, `#join-phone`,
 * `#otp-phone`) and stays in sync, so a label click, a password manager and the e2e helper's
 * Playwright `fill()` keep working.
 */
import React, { useEffect, useRef } from 'react';
import type { Language } from '../../i18n/language';

export const PHONE_LENGTH = 10;

/** Digits only (Devanagari digits are turned into 0-9), at most 10. Pure; used by paste and typing. */
export function sanitizePhoneDigits(raw: string): string {
    const ascii = raw.replace(/[०-९]/g, ch => String(ch.charCodeAt(0) - 0x0966));
    return ascii.replace(/\D+/g, '').slice(0, PHONE_LENGTH);
}

/** A pasted number: drop a leading +91 / 91 / 0 when what is left is still a full number. */
export function phoneFromPaste(raw: string): string {
    const digits = raw.replace(/[०-९]/g, ch => String(ch.charCodeAt(0) - 0x0966)).replace(/\D+/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits.slice(0, PHONE_LENGTH);
}

const COPY: Record<Language, {
    prefix: string;
    left: (n: number) => string;
    ready: string;
    start: string;
    box: (n: number) => string;
}> = {
    mr: {
        prefix: 'देशाचा कोड +91',
        left: n => `${n} अंक बाकी`, // PROPOSED (Marathi)
        ready: 'नंबर पूर्ण झाला', // PROPOSED (Marathi)
        start: 'भारतीय मोबाईल नंबर ६, ७, ८ किंवा ९ ने सुरू होतो.', // PROPOSED (Marathi)
        box: n => `अंक ${n}`,
    },
    en: {
        prefix: 'Country code +91',
        left: n => `${n} ${n === 1 ? 'digit' : 'digits'} left`,
        ready: 'Number complete',
        start: 'Indian mobile numbers start with 6, 7, 8 or 9.',
        box: n => `Digit ${n}`,
    },
};

export interface PhoneDigitBoxesProps {
    /** The digits typed so far (0 to 10 characters). */
    value: string;
    onChange: (digits: string) => void;
    /** Element id of the hidden real input (the label's `htmlFor`, the e2e helper's selector). */
    id: string;
    disabled?: boolean;
    /** Placeholder of the hidden real input (kept so older lookups by placeholder still find it). */
    placeholder?: string;
    autoFocus?: boolean;
    /** The chosen language (the caller already has it; no context lookup here). */
    language: Language;
    /** Larger boxes for the one-job join screen. */
    large?: boolean;
}

const PhoneDigitBoxes: React.FC<PhoneDigitBoxesProps> = ({
    value, onChange, id, placeholder, disabled = false, autoFocus = false, language, large = false,
}) => {
    const t = COPY[language];
    const digits = sanitizePhoneDigits(value);
    const refs = useRef<Array<HTMLInputElement | null>>([]);
    const hiddenRef = useRef<HTMLInputElement | null>(null);

    const focusBox = (i: number) => {
        const box = refs.current[Math.max(0, Math.min(PHONE_LENGTH - 1, i))];
        if (box) {
            box.focus();
            box.select();
        }
    };

    useEffect(() => {
        if (autoFocus) focusBox(Math.min(digits.length, PHONE_LENGTH - 1));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const setAt = (index: number, digit: string): string => {
        const chars = Array.from({ length: PHONE_LENGTH }, (_, i) => digits[i] ?? ' ');
        chars[index] = digit;
        // Keep the value a plain run of digits: a gap collapses (the caller must always get digits only).
        return chars.join('').replace(/ /g, '');
    };

    const handleChange = (index: number, raw: string) => {
        const clean = sanitizePhoneDigits(raw);
        if (clean === '') return; // a non-digit key: nothing changes
        if (clean.length > 1) {
            // Several digits landed in one box (autofill, a keyboard suggestion): spread them out from here.
            const next = (digits.slice(0, index) + clean).slice(0, PHONE_LENGTH);
            onChange(next);
            focusBox(Math.min(next.length, PHONE_LENGTH - 1));
            return;
        }
        // One digit: put it in this box. Boxes are filled left to right, so a digit typed past the end appends.
        const next = index >= digits.length ? digits + clean : setAt(index, clean);
        onChange(next);
        focusBox(index + 1);
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (index < digits.length) {
                // Erase this digit; the ones after it move up one so no hole is left.
                onChange(digits.slice(0, index) + digits.slice(index + 1));
                if (index > 0) focusBox(index - 1);
            } else if (index > 0) {
                onChange(digits.slice(0, index - 1) + digits.slice(index));
                focusBox(index - 1);
            }
        } else if (e.key === 'Delete') {
            e.preventDefault();
            if (index < digits.length) onChange(digits.slice(0, index) + digits.slice(index + 1));
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            focusBox(index - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            focusBox(index + 1);
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pasted = phoneFromPaste(e.clipboardData.getData('text'));
        if (!pasted) return;
        onChange(pasted);
        focusBox(Math.min(pasted.length, PHONE_LENGTH - 1));
    };

    const left = PHONE_LENGTH - digits.length;
    const badStart = digits.length > 0 && !/^[6-9]/.test(digits);
    const size = large ? 'h-12 w-0 min-w-0 flex-1 text-xl' : 'h-11 w-0 min-w-0 flex-1 text-lg';

    return (
        <div className="space-y-2" data-testid="phone-digit-boxes">
            {/* The real input: out of sight, still in the page, kept in step with the boxes. */}
            <input
                ref={hiddenRef}
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={digits}
                placeholder={placeholder}
                disabled={disabled}
                tabIndex={-1}
                onChange={e => onChange(phoneFromPaste(e.target.value))}
                onFocus={() => focusBox(Math.min(digits.length, PHONE_LENGTH - 1))}
                className="sr-only"
            />

            <div className="flex items-start gap-1" dir="ltr">
                <span
                    className="mt-0.5 flex h-11 shrink-0 select-none items-center rounded-lg bg-stone-100 px-1.5 text-sm font-bold text-stone-700"
                    aria-label={t.prefix}
                >
                    +91
                </span>
                <div className="flex min-w-0 flex-1 gap-[3px]" role="group" aria-label={t.prefix}>
                    {Array.from({ length: PHONE_LENGTH }, (_, i) => (
                        <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
                            <input
                                ref={el => { refs.current[i] = el; }}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                aria-label={t.box(i + 1)}
                                data-testid={`phone-box-${i + 1}`}
                                value={digits[i] ?? ''}
                                disabled={disabled}
                                maxLength={2}
                                onChange={e => handleChange(i, e.target.value)}
                                onKeyDown={e => handleKeyDown(i, e)}
                                onPaste={handlePaste}
                                onFocus={e => e.currentTarget.select()}
                                className={`${size} min-w-[26px] rounded-lg border-2 bg-white text-center font-mono font-black text-stone-900 outline-none transition-colors ${
                                    digits[i] ? 'border-emerald-300' : 'border-stone-200'
                                } focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200/70 disabled:opacity-60`}
                            />
                            <span className="mt-0.5 text-[10px] font-semibold leading-none text-stone-400" aria-hidden="true">
                                {i + 1}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <p
                data-testid="phone-digits-left"
                aria-live="polite"
                className={`text-center text-xs font-semibold ${left === 0 ? 'text-emerald-700' : 'text-sky-700'}`}
            >
                {left === 0 ? t.ready : t.left(left)}
            </p>
            {badStart && (
                <p data-testid="phone-bad-start" role="status" className="text-center text-xs font-semibold text-amber-700">
                    {t.start}
                </p>
            )}
        </div>
    );
};

export default PhoneDigitBoxes;
