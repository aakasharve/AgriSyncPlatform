/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourAccessControl — the ONE owner switch for a person's labour records (हजेरी व पक्कं करणे,
 * `can_manage_labour_records`), the one control on a team card with a server behind it since
 * LABOUR_PHASE2 Phase 5. Moved verbatim out of the old `TeamMemberCard` (spec:
 * plr-d7-m1-multiuser-2026-10-26, step 2) so the new team screen's person card uses the SAME
 * switch, words and duration chips — never a second copy that could drift.
 *
 * COPY: the D5 approved set, verbatim (master review 2026-09-02). No permission vocabulary.
 *
 * `isEditable: false` renders a STATIC state, not a disabled switch: an owner-tier member carries
 * this with ownership and the server refuses the write, so anything switch-shaped would be a
 * control that looks functional and does nothing (`P5`).
 */
import React, { useState } from 'react';
import { CheckCircle2, ClipboardList } from 'lucide-react';
import { DURATION_CHIPS, expiryUtcForChip, responsibilityEndLine } from './responsibilityDuration';

export interface LabourAccessView {
    /**
     * The EFFECTIVE answer, clock-evaluated by the server — an expired जबाबदारी reads `false`
     * here even though the stored decision survives.
     */
    canManage: boolean;
    /** `false` for owner tier ONLY (D5, 2026-09-02): rendered as a static state. */
    isEditable: boolean;
    /** A write for this member is in flight. */
    saving: boolean;
    /** The UTC instant the जबाबदारी ends, or null = कायम (no end). Server truth. */
    expiresAtUtc: string | null;
    /** DESIRED state, not a toggle, so a retry on a bad line converges. `expiresAtUtc` null = कायम. */
    onChange: (next: boolean, expiresAtUtc: string | null) => void;
}

export const LabourAccessControl: React.FC<{ memberId: string; memberName: string; access: LabourAccessView }> = ({
    memberId, memberName, access,
}) => {
    /** The जबाबदारी द्या flow is mid-choice: the door was tapped, a duration chip was not. */
    const [choosingDuration, setChoosingDuration] = useState(false);
    const [pickedDate, setPickedDate] = useState('');

    if (!access.isEditable) {
        // Owner-tier — permanently on, non-interactive (P5).
        return (
            <div data-testid={`labour-access-${memberId}`}
                className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <ClipboardList size={18} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800">कामगारांची जबाबदारी आहे</span>
                </span>
                <span className="flex-shrink-0 text-emerald-600"><CheckCircle2 size={22} /></span>
            </div>
        );
    }

    if (access.canManage) {
        // ON — the responsibility is stated, with its end. Tapping revokes: PUT(false).
        const endLine = responsibilityEndLine(access.expiresAtUtc);
        return (
            <button type="button" data-testid={`labour-access-${memberId}`}
                onClick={() => access.onChange(false, null)}
                disabled={access.saving} aria-pressed={true} aria-busy={access.saving}
                className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left shadow-sm shadow-emerald-100 transition-all active:scale-[0.98] disabled:opacity-60">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <ClipboardList size={18} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800">माणसांची जबाबदारी आहे</span>
                    {endLine !== '' && <span className="block text-[11px] leading-snug text-slate-500">{endLine}</span>}
                </span>
                <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-emerald-500">
                    <span className="absolute left-0.5 top-0.5 h-5 w-5 translate-x-5 rounded-full bg-white shadow-sm" />
                </span>
            </button>
        );
    }

    if (choosingDuration) {
        // Duration chips — the D5 flow: pick the person (this card), pick the duration, done.
        return (
            <div data-testid={`labour-access-${memberId}`} className="rounded-xl border border-emerald-200 bg-white p-3">
                <p className="mb-2 text-sm font-bold text-slate-800">{`${memberName}ला किती दिवस?`}</p>
                <div className="flex flex-wrap gap-2">
                    {DURATION_CHIPS.map(({ chip, label }) => (
                        <button key={chip} type="button" disabled={access.saving}
                            onClick={() => {
                                if (chip === 'date') return; // the input below submits
                                access.onChange(true, expiryUtcForChip(chip, new Date()));
                                setChoosingDuration(false);
                            }}
                            className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-800 transition-all active:scale-95 disabled:opacity-60">
                            {label}
                        </button>
                    ))}
                </div>
                <input type="date" aria-label="तारीख" value={pickedDate}
                    onChange={(e) => {
                        const iso = e.target.value;
                        setPickedDate(iso);
                        if (iso) {
                            access.onChange(true, expiryUtcForChip('date', new Date(), iso));
                            setChoosingDuration(false);
                        }
                    }}
                    className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm" />
            </div>
        );
    }

    // OFF — the door: जबाबदारी द्या.
    return (
        <button type="button" data-testid={`labour-access-${memberId}`}
            onClick={() => setChoosingDuration(true)}
            disabled={access.saving} aria-pressed={false} aria-busy={access.saving}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                <ClipboardList size={18} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-800">जबाबदारी द्या</span>
            </span>
            <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-slate-300">
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm" />
            </span>
        </button>
    );
};

export default LabourAccessControl;
