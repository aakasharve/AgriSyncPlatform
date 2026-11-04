/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 screen 1, section 10). The three fields a
 * named worker needs besides his name — his home PIN (one tap on "शेताचाच पिन" when the farm has a PIN on record), a
 * phone number and whose phone it is — shared by the add form and the "यांचा फोन व पिन भरा" sheet. One decision per
 * row, big taps; a wrong PIN is a calm hint, never a red error. A number already on this farm is ONE gentle question
 * with two big answers, never a block (R4, screen 4).
 */
import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Phone } from 'lucide-react';
import { phoneWhoseIn } from '../../../shared/names/namesIn';
import { normalizeHomePin, normalizeIndianMobile } from './cardCode';
import { widText } from './widCopy';

export type PhoneWhose = 'Own' | 'Family' | 'Mukadam';
const WHOSE: readonly PhoneWhose[] = ['Own', 'Family', 'Mukadam'];

export interface IdentityValue {
    phone: string;
    whose: PhoneWhose;
    pin: string;
    farmPinToo: boolean;
}

export const EMPTY_IDENTITY: IdentityValue = { phone: '', whose: 'Own', pin: '', farmPinToo: false };

/** The valid parts, or null while anything is missing or half-typed. */
export function readIdentity(value: IdentityValue): { phone: string; phoneWhose: PhoneWhose; homePin: string; isFarmPinToo: boolean } | null {
    const phone = normalizeIndianMobile(value.phone);
    const homePin = normalizeHomePin(value.pin);
    return phone && homePin ? { phone, phoneWhose: value.whose, homePin, isFarmPinToo: value.farmPinToo } : null;
}

export interface SharedCheck {
    sameFarmNames: string[];
    verifiedHolderExists: boolean;
}

interface Props {
    value: IdentityValue;
    onChange: (next: IdentityValue) => void;
    farmPinCode?: string | null;
    language?: string | null;
    disabled?: boolean;
    /** Asked once the number is complete; null = could not ask (never a block). */
    onCheckPhone?: (phone: string) => Promise<SharedCheck | null>;
}

const INPUT = 'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-[18px] font-bold text-stone-800 placeholder:font-normal placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none disabled:bg-stone-100';
const LABEL = 'mb-1.5 ml-1 flex items-center gap-1.5 text-[13px] font-extrabold text-stone-500';
const CHIP = 'min-h-[44px] rounded-full border-2 px-3.5 text-[15px] font-extrabold transition-colors';
const ON = 'border-emerald-600 bg-emerald-50 text-emerald-700';
const OFF = 'border-stone-200 bg-white text-stone-600';

export const IdentityFields: React.FC<Props> = ({ value, onChange, farmPinCode, language, disabled, onCheckPhone }) => {
    const [typingPin, setTypingPin] = useState(!farmPinCode || (value.pin !== '' && value.pin !== farmPinCode));
    const [shared, setShared] = useState<SharedCheck | null>(null);
    const set = (patch: Partial<IdentityValue>) => onChange({ ...value, ...patch });
    const phone = normalizeIndianMobile(value.phone);
    const pinShown = typingPin && value.pin.length > 0 && normalizeHomePin(value.pin) === null;

    // Asked once per complete number (the caller's function may change identity on every render).
    const checkRef = useRef(onCheckPhone);
    checkRef.current = onCheckPhone;
    useEffect(() => {
        setShared(null);
        const check = checkRef.current;
        if (!phone || !check) return;
        let cancelled = false;
        void check(phone).then((answer) => {
            if (!cancelled) setShared(answer);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, [phone]);

    const usingFarmPin = Boolean(farmPinCode) && !typingPin && value.pin === farmPinCode;
    const sharedNames = shared?.sameFarmNames ?? [];

    return (
        <div className="space-y-4">
            <div>
                <div className={LABEL}><MapPin size={14} aria-hidden /> {widText('pinLabel', language)} *</div>
                <div className="flex flex-wrap gap-2">
                    {farmPinCode && (
                        <button type="button" data-testid="add-worker-pin-chip" disabled={disabled} aria-pressed={usingFarmPin}
                            onClick={() => { setTypingPin(false); set({ pin: farmPinCode, farmPinToo: false }); }}
                            className={`${CHIP} ${usingFarmPin ? ON : OFF}`}>
                            {widText('farmPinChip', language)} — {farmPinCode}
                        </button>
                    )}
                    {farmPinCode && (
                        <button type="button" data-testid="add-worker-pin-other" disabled={disabled} aria-pressed={typingPin}
                            onClick={() => { setTypingPin(true); set({ pin: '' }); }}
                            className={`${CHIP} ${typingPin ? ON : OFF}`}>
                            {widText('otherPin', language)}
                        </button>
                    )}
                </div>
                {typingPin && (
                    <input data-testid="add-worker-pin" inputMode="numeric" maxLength={6} disabled={disabled}
                        value={value.pin} aria-label={widText('pinLabel', language)} placeholder="413304"
                        onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                        className={`${INPUT} mt-2 tracking-[0.2em]`} />
                )}
                {pinShown && (
                    <p data-testid="add-worker-pin-hint" className="ml-1 mt-1 text-[13px] font-semibold text-amber-700">{widText('pinHint', language)}</p>
                )}
                <p className="ml-1 mt-1 text-[12.5px] font-semibold text-stone-500">{widText('pinNote', language)}</p>
                {!farmPinCode && normalizeHomePin(value.pin) && (
                    <label className="mt-2 flex min-h-[44px] items-center gap-2 rounded-xl px-1 text-[14px] font-bold text-stone-600">
                        <input type="checkbox" data-testid="add-worker-farm-pin-too" checked={value.farmPinToo} disabled={disabled}
                            onChange={(e) => set({ farmPinToo: e.target.checked })} className="h-5 w-5 accent-emerald-600" />
                        {widText('farmPinToo', language)}
                    </label>
                )}
            </div>

            <div>
                <div className={LABEL}><Phone size={14} aria-hidden /> {widText('phoneLabel', language)} *</div>
                <input data-testid="add-worker-phone" inputMode="tel" maxLength={16} disabled={disabled}
                    value={value.phone} aria-label={widText('phoneLabel', language)} placeholder="98xxx xx412"
                    onChange={(e) => set({ phone: e.target.value })}
                    className={INPUT} />
                <p className="ml-1 mt-1 text-[12.5px] font-semibold text-stone-500">{widText('phoneNote', language)}</p>
            </div>

            {shared && sharedNames.length > 0 && (
                <div data-testid="add-worker-shared-question" className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3 text-[14.5px] font-bold leading-snug text-amber-900">
                    <p>{widText('sharedQuestion', language, { names: sharedNames.join(', ') })}</p>
                    <p className="mt-0.5">{widText('sharedAsk', language)}</p>
                    <div className="mt-2 flex gap-2">
                        <button type="button" data-testid="add-worker-shared-family" disabled={disabled}
                            onClick={() => set({ whose: 'Family' })}
                            className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-3 text-[15px] font-extrabold text-white">
                            {widText('sharedYes', language)}
                        </button>
                        <button type="button" data-testid="add-worker-shared-change" disabled={disabled}
                            onClick={() => set({ phone: '' })}
                            className="min-h-[44px] flex-1 rounded-xl border border-stone-300 bg-white px-3 text-[15px] font-extrabold text-stone-700">
                            {widText('sharedChange', language)}
                        </button>
                    </div>
                </div>
            )}
            {shared?.verifiedHolderExists && sharedNames.length === 0 && (
                <p data-testid="add-worker-verified-elsewhere" className="rounded-xl bg-stone-50 p-3 text-[13.5px] font-semibold text-stone-600">
                    {widText('verifiedElsewhere', language)}
                </p>
            )}

            <div>
                <div className={LABEL}>{widText('whose', language)}</div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={widText('whose', language)}>
                    {WHOSE.map((w) => (
                        <button key={w} type="button" data-testid={`add-worker-whose-${w}`} disabled={disabled}
                            aria-pressed={value.whose === w} onClick={() => set({ whose: w })}
                            className={`${CHIP} ${value.whose === w ? ON : OFF}`}>
                            {phoneWhoseIn(w, language)}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
