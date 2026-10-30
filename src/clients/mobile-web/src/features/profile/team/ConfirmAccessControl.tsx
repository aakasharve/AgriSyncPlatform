/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-44 §2. The PRIMARY owner's switch for a
 * CO-OWNER's responsibility to confirm records ("मालकाकडून खात्री"). A co-owner's labour edits still come with his
 * role (the D-26 permission system decides those later), so his old labour line stays as it is; this switch is
 * only about confirming, and it says so.
 *
 * It renders the server's answer (`canConfirm`) and sends DESIRED state, never a toggle, on the existing
 * labour-permission route — so a retry on a bad line converges. Drawn only when the server says the caller may
 * move it (`isConfirmGrantEditable`), so it is never a control that does nothing (P5).
 */
import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { confirmAccessCopy } from './confirmAccessCopy';

export interface ConfirmAccessView {
    /** The server's answer: this co-owner may confirm records now. */
    canConfirm: boolean;
    /** A write for this member is in flight. */
    saving: boolean;
    /** DESIRED state. */
    onChange: (next: boolean) => void;
}

export const ConfirmAccessControl: React.FC<{ memberId: string; access: ConfirmAccessView }> = ({ memberId, access }) => {
    // No provider (a screen mounted on its own) reads Marathi, the app's default language.
    const language = useOptionalLanguage()?.language;
    const copy = confirmAccessCopy(language);
    const on = access.canConfirm;
    return (
        <div className="space-y-1">
            <button type="button" data-testid={`confirm-access-${memberId}`} data-on={on ? 'yes' : 'no'}
                onClick={() => access.onChange(!on)} disabled={access.saving} aria-pressed={on} aria-busy={access.saving}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60 ${on ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-white'}`}>
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <ShieldCheck size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-bold text-slate-800">{on ? copy.on : copy.off}</span>
                <span className={`relative h-6 w-11 flex-shrink-0 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ${on ? 'translate-x-5' : ''}`} />
                </span>
            </button>
            <p className="m-0 px-1 text-[12px] font-semibold leading-snug text-stone-600" data-testid={`confirm-access-hint-${memberId}`}>{copy.hint}</p>
        </div>
    );
};

export default ConfirmAccessControl;
