/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TeamMemberCard — a farm-team member, and the access an owner can ACTUALLY
 * grant them. Collapsed: avatar · name · role. Expanded: the labour-records
 * control, which is the one thing here with a server behind it, plus Remove.
 *
 * FINAL REVIEW F-3 — this used to render four MORE switches, in the same visual
 * language, immediately above the real one, and to summarise them as "N/4
 * access" on the collapsed card. See the block below `Member` for what they
 * claimed and why none of it was true.
 */
import React, { useState } from 'react';
import { ChevronDown, Trash2, ClipboardList, CheckCircle2 } from 'lucide-react';
import { OperatorCapability } from '../../../types';
import { DURATION_CHIPS, expiryUtcForChip, responsibilityEndLine } from './responsibilityDuration';

interface Member {
    id: string;
    name: string;
    role: string;
    phone?: string;
    capabilities?: OperatorCapability[];
}

/*
 * DELETED — `ACCESS`, the four capability switches.
 *
 * They were pure theatre, in the same visual language as the one real control
 * and sitting immediately above it. Two of the labels were active false claims:
 * **"नोंदी मंजूर करणे · Approve entries"** granted nothing — approve/verify is
 * gated by `can_manage_labour_records` — and none of the four gates anything
 * anywhere. The ONLY readers of `capabilities` in this codebase are display
 * (`TeamMemberCard` itself and `IdentitySection.tsx:502`); no guard consults
 * them.
 *
 * And they could not persist even if something did read them:
 * `profileAndCropsReconciler.ts:150` recomputes `capabilities` from role via
 * `capabilitiesForRole`, so every pull discards whatever the owner set.
 * `onToggleCap` (`IdentitySection.tsx:501-509`) writes local profile state and
 * stops there.
 *
 * `labourAccess` below is the one control with a server behind it and a `409`
 * when the server refuses — which is why it renders as a static state rather
 * than a switch when it is not editable.
 */

/**
 * LABOUR_PHASE2 Phase 5 — the ONE capability on this card that reaches a
 * server.
 *
 * Absent means the roster has not loaded, or this member is not in it, and the
 * row is then not rendered at all. A switch with no server row behind it is the
 * mock this replaces.
 */
interface LabourAccessView {
    /**
     * The EFFECTIVE answer, clock-evaluated by the server — an expired
     * जबाबदारी reads `false` here even though the stored decision survives.
     */
    canManage: boolean;
    /**
     * `false` for owner tier ONLY (D5, 2026-09-02): the responsibility comes
     * with ownership, the server refuses the write (409), and the row must
     * render as a static state rather than as a switch. A switch that appears
     * to move and does not is precisely the defect being removed (`P5`).
     * A Mukadam is editable like anyone else — his authority is the owner's
     * switch now, not the role's.
     */
    isEditable: boolean;
    /** A write for this member is in flight. */
    saving: boolean;
    /**
     * The UTC instant the जबाबदारी ends, or null = कायम (no end).
     * Server truth — never computed locally for display.
     */
    expiresAtUtc: string | null;
    /**
     * DESIRED state, not a toggle, so a retry on a bad line converges.
     * `expiresAtUtc` null = कायम.
     */
    onChange: (next: boolean, expiresAtUtc: string | null) => void;
}

interface TeamMemberCardProps {
    member: Member;
    /**
     * @deprecated Wired to nothing. Kept so `IdentitySection` needs no change in
     * a `.tsx`-frozen round; delete the prop and its caller together.
     */
    onToggleCap?: (cap: OperatorCapability) => void;
    onDelete: () => void;
    labourAccess?: LabourAccessView;
}

export const TeamMemberCard: React.FC<TeamMemberCardProps> = ({ member, onDelete, labourAccess }) => {
    const [open, setOpen] = useState(false);
    /** The जबाबदारी द्या flow is mid-choice: the door was tapped, a duration chip was not. */
    const [choosingDuration, setChoosingDuration] = useState(false);
    const [pickedDate, setPickedDate] = useState('');
    const isPartner = member.role === 'SECONDARY_OWNER';

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 p-3.5 text-left transition-all active:scale-[0.99] active:bg-slate-50"
            >
                <div className={`mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-base font-black shadow-inner ${isPartner ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                    {member.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="truncate text-[15px] font-bold leading-tight text-slate-800">{member.name}</h4>
                    {/* Tags wrap to a second line on narrow phones so the access
                        summary can never clip off the right edge. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isPartner ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-orange-100 bg-orange-50 text-orange-700'}`}>
                            {isPartner ? 'भागीदार' : 'कामाला येणारे'}
                        </span>
                    </div>
                </div>
                {/* Chevron + label stacked in a compact right column so they
                    don't compete with the name for horizontal space. */}
                <div className="flex flex-shrink-0 flex-col items-center gap-1 pl-1">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${open ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                    {/* D5: no farmer-facing permission vocabulary — प्रवेश
                        ("access") violated that; ठरवा is retained, प्रवेश is
                        replaced with the founder's approved word. */}
                    <span className="whitespace-nowrap text-[9.5px] font-bold leading-none text-emerald-700">{open ? 'बंद करा' : 'जबाबदारी ठरवा'}</span>
                </div>
            </button>

            {open && (
                <div className="animate-in fade-in slide-in-from-top-1 border-t border-slate-100 bg-slate-50/50 px-3 py-3 duration-200">
                    {labourAccess && (
                        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                            याला काय करता येईल?
                        </p>
                    )}
                    {/* LABOUR_PHASE2 Phase 5 — the real one, and now the only one.

                        FINAL REVIEW F-3 deleted the four switches that used to
                        sit above this: local state the next pull overwrote
                        (`profileAndCropsReconciler.ts:150` recomputes
                        capabilities from role via `capabilitiesForRole`), and
                        gating nothing anywhere in the first place. The divider
                        that separated them from this control went with them.

                        COPY: the D5 approved set, verbatim (master review
                        2026-09-02). No permission vocabulary anywhere on this
                        surface.

                        `isEditable: false` renders a STATIC state, not a
                        disabled switch: an owner-tier member carries this with
                        ownership and the server refuses the write, so anything
                        switch-shaped would be a control that looks functional
                        and does nothing (`P5`). */}
                    {labourAccess && (
                        <div>
                            {labourAccess.isEditable ? (
                                labourAccess.canManage ? (
                                    /* ON — the responsibility is stated, with its end.
                                       Tapping revokes: PUT(false), no second control,
                                       no new copy needed. */
                                    <button
                                        type="button"
                                        data-testid={`labour-access-${member.id}`}
                                        onClick={() => labourAccess.onChange(false, null)}
                                        disabled={labourAccess.saving}
                                        aria-pressed={true}
                                        aria-busy={labourAccess.saving}
                                        className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left shadow-sm shadow-emerald-100 transition-all active:scale-[0.98] disabled:opacity-60"
                                    >
                                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                                            <ClipboardList size={18} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-bold text-slate-800">माणसांची जबाबदारी आहे</span>
                                            {responsibilityEndLine(labourAccess.expiresAtUtc) !== '' && (
                                                <span className="block text-[11px] leading-snug text-slate-500">
                                                    {responsibilityEndLine(labourAccess.expiresAtUtc)}
                                                </span>
                                            )}
                                        </span>
                                        <span className="relative h-6 w-11 flex-shrink-0 rounded-full bg-emerald-500">
                                            <span className="absolute left-0.5 top-0.5 h-5 w-5 translate-x-5 rounded-full bg-white shadow-sm" />
                                        </span>
                                    </button>
                                ) : choosingDuration ? (
                                    /* Duration chips — the D5 flow: pick the person is
                                       done (this card), pick the duration, done. */
                                    <div
                                        data-testid={`labour-access-${member.id}`}
                                        className="rounded-xl border border-emerald-200 bg-white p-3"
                                    >
                                        <p className="mb-2 text-sm font-bold text-slate-800">
                                            {`${member.name}ला किती दिवस?`}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {DURATION_CHIPS.map(({ chip, label }) => (
                                                <button
                                                    key={chip}
                                                    type="button"
                                                    disabled={labourAccess.saving}
                                                    onClick={() => {
                                                        if (chip === 'date') return; // the input below submits
                                                        labourAccess.onChange(true, expiryUtcForChip(chip, new Date()));
                                                        setChoosingDuration(false);
                                                    }}
                                                    className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-800 transition-all active:scale-95 disabled:opacity-60"
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            type="date"
                                            aria-label="तारीख"
                                            value={pickedDate}
                                            onChange={(e) => {
                                                const iso = e.target.value;
                                                setPickedDate(iso);
                                                if (iso) {
                                                    labourAccess.onChange(true, expiryUtcForChip('date', new Date(), iso));
                                                    setChoosingDuration(false);
                                                }
                                            }}
                                            className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm"
                                        />
                                    </div>
                                ) : (
                                    /* OFF — the door: जबाबदारी द्या. */
                                    <button
                                        type="button"
                                        data-testid={`labour-access-${member.id}`}
                                        onClick={() => setChoosingDuration(true)}
                                        disabled={labourAccess.saving}
                                        aria-pressed={false}
                                        aria-busy={labourAccess.saving}
                                        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60"
                                    >
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
                                )
                            ) : (
                                /* Owner-tier — permanently on, non-interactive (P5). */
                                <div
                                    data-testid={`labour-access-${member.id}`}
                                    className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left"
                                >
                                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                                        <ClipboardList size={18} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold text-slate-800">कामगारांची जबाबदारी आहे</span>
                                    </span>
                                    <span className="flex-shrink-0 text-emerald-600"><CheckCircle2 size={22} /></span>
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={onDelete}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-white py-2.5 text-sm font-bold text-red-500 transition-all hover:bg-red-50 active:scale-[0.98]"
                    >
                        <Trash2 size={16} /> टीममधून काढा · Remove
                    </button>
                </div>
            )}
        </div>
    );
};

export default TeamMemberCard;
