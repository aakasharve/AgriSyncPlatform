/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane 2b (MU farm-relationships design §2, §6, §11.1, §11.2; founder D-22 / D-26 / D-44) — the
 * PRIMARY owner's switches for one person's responsibilities on this farm, one per authority the
 * server ENFORCES (हजेरी, नोंदी पक्क्या करणे, पैशांच्या नोंदी, शेताची रचना, चाचण्या, वेळापत्रकाचे नमुने),
 * each "कायम" or "तारखेपर्यंत". See money, see wages, plan and assign get no switch until their
 * server rule exists (P5: MU-3 / L8).
 *
 * Server truth only: a switch shows what the server last said and sends the WHOLE desired set
 * (`authoritySwitchModel`); it moves when the server's row moves, never before. Drawn only when the
 * server says the caller may set this person's authorities (`canEditAuthorities`).
 */
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { SWITCHABLE_AUTHORITIES } from '../../../core/session/farmAuthorities';
import type { AuthorityGrant } from '../data/labourPermissionsClient';
import { expiryUtcForChip } from '../components/responsibilityDuration';
import { authorityCopy, authorityLabel } from './authorityCopy';
import { endOf, holds, throughDay, withAuthority, withoutAuthority } from './authoritySwitchModel';

export interface AuthorityAccessView {
    /** The server's list for this person (held now, each with its end). */
    authorities: readonly AuthorityGrant[];
    /** A write for this person is in flight. */
    saving: boolean;
    /** The WHOLE desired set. */
    onChange: (next: AuthorityGrant[]) => void;
}

export const AuthoritySwitches: React.FC<{ memberId: string; access: AuthorityAccessView }> = ({ memberId, access }) => {
    const language = useOptionalLanguage()?.language;
    const copy = authorityCopy(language);
    /** The switch whose duration is being chosen (tapped while OFF). */
    const [choosing, setChoosing] = useState<string | null>(null);
    const [pickedDate, setPickedDate] = useState('');

    const give = (name: string, expiresAtUtc: string | null) => {
        access.onChange(withAuthority(access.authorities, name, expiresAtUtc));
        setChoosing(null);
        setPickedDate('');
    };

    return (
        <section className="space-y-1.5" data-testid={`authority-switches-${memberId}`} aria-label={copy.title}>
            <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{copy.title}</p>
            <p className="m-0 text-[12px] font-semibold leading-snug text-stone-600">{copy.hint}</p>
            <ul className="m-0 space-y-1.5 p-0">
                {SWITCHABLE_AUTHORITIES.map(name => {
                    const on = holds(access.authorities, name);
                    const end = throughDay(endOf(access.authorities, name), language);
                    const note = copy.note[name];
                    return (
                        <li key={name} className="list-none">
                            <button type="button" data-testid={`authority-${name}-${memberId}`} data-on={on ? 'yes' : 'no'}
                                aria-pressed={on} aria-busy={access.saving} disabled={access.saving}
                                onClick={() => (on ? access.onChange(withoutAuthority(access.authorities, name)) : setChoosing(choosing === name ? null : name))}
                                className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all active:scale-[0.98] disabled:opacity-60 ${on ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-white'}`}>
                                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                    <ShieldCheck size={16} aria-hidden="true" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[13.5px] font-bold text-slate-800">{authorityLabel(copy, name)}</span>
                                    {on && <span className="block text-[11.5px] font-semibold text-slate-600" data-testid={`authority-${name}-end-${memberId}`}>{end ? copy.until(end) : copy.permanent}</span>}
                                    {note && <span className="block text-[11.5px] leading-snug text-slate-500">{note}</span>}
                                </span>
                                <span className="flex-shrink-0 text-[12px] font-extrabold text-slate-600">{on ? copy.on : copy.off}</span>
                            </button>
                            {choosing === name && !on && (
                                <div className="mt-1.5 space-y-2 rounded-xl border border-emerald-200 bg-white p-2.5" data-testid={`authority-${name}-choose-${memberId}`}>
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" disabled={access.saving} onClick={() => give(name, null)}
                                            data-testid={`authority-${name}-permanent-${memberId}`}
                                            className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-800 disabled:opacity-60">
                                            {copy.permanent}
                                        </button>
                                        <button type="button" onClick={() => setChoosing(null)}
                                            className="rounded-full px-3 py-1.5 text-[13px] font-bold text-stone-600 ring-1 ring-stone-300">
                                            {copy.cancel}
                                        </button>
                                    </div>
                                    <label className="block text-[12.5px] font-bold text-slate-700">
                                        {copy.untilDate} · {copy.pickDate}
                                        <input type="date" value={pickedDate} disabled={access.saving}
                                            data-testid={`authority-${name}-date-${memberId}`}
                                            onChange={(e) => {
                                                const iso = e.target.value;
                                                setPickedDate(iso);
                                                if (iso) give(name, expiryUtcForChip('date', new Date(), iso));
                                            }}
                                            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" />
                                    </label>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default AuthoritySwitches;
