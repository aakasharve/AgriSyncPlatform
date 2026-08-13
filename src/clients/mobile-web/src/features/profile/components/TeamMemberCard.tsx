/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TeamMemberCard — a farm-team member with a clear, accessible access panel.
 * Collapsed: avatar · name · role · "N/4 access" summary. Expanded: one big
 * labelled toggle per capability (bilingual, icon + one-line "what it means"),
 * plus Remove. Replaces the single hidden "Allow Log" toggle so an owner can
 * grant/revoke every access type per member.
 */
import React, { useState } from 'react';
import { ChevronDown, Trash2, ClipboardList, BarChart3, CheckCircle2, Users } from 'lucide-react';
import { OperatorCapability } from '../../../types';

interface Member {
    id: string;
    name: string;
    role: string;
    phone?: string;
    capabilities?: OperatorCapability[];
}

// The access types an owner can grant, in plain Marathi + English with a
// one-line "what it means". Maps 1:1 to real OperatorCapability values.
const ACCESS: { cap: OperatorCapability; icon: React.ReactNode; mr: string; en: string; desc: string }[] = [
    { cap: OperatorCapability.LOG_DATA, icon: <ClipboardList size={18} />, mr: 'रोजची नोंद', en: 'Log daily work', desc: 'मजुरी, पाणी, फवारणी नोंदवू शकतो' },
    { cap: OperatorCapability.VIEW_ALL, icon: <BarChart3 size={18} />, mr: 'अहवाल पाहणे', en: 'View reports', desc: 'पैसे व सारांश पाहू शकतो' },
    { cap: OperatorCapability.APPROVE_LOGS, icon: <CheckCircle2 size={18} />, mr: 'नोंदी मंजूर करणे', en: 'Approve entries', desc: 'कामगारांच्या नोंदी तपासू शकतो' },
    { cap: OperatorCapability.MANAGE_PEOPLE, icon: <Users size={18} />, mr: 'टीम सांभाळणे', en: 'Manage team', desc: 'सदस्य जोडू किंवा काढू शकतो' },
];

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
     * The EFFECTIVE answer. Never `hasExplicitGrant` — that is `false` for a
     * Mukadam who can in fact do everything, so rendering it would show "off"
     * beside someone with full authority.
     */
    canManage: boolean;
    /**
     * `false` for owner tier and Mukadam: the capability comes with the ROLE,
     * the server refuses the write (409), and the row must render as a static
     * state rather than as a switch. A switch that appears to move and does not
     * is precisely the defect being removed (`P5`).
     */
    isEditable: boolean;
    /** A write for this member is in flight. */
    saving: boolean;
    /** DESIRED state, not a toggle, so a retry on a bad line converges. */
    onChange: (next: boolean) => void;
}

interface TeamMemberCardProps {
    member: Member;
    onToggleCap: (cap: OperatorCapability) => void;
    onDelete: () => void;
    labourAccess?: LabourAccessView;
}

export const TeamMemberCard: React.FC<TeamMemberCardProps> = ({ member, onToggleCap, onDelete, labourAccess }) => {
    const [open, setOpen] = useState(false);
    const caps = member.capabilities || [];
    const granted = ACCESS.filter(a => caps.includes(a.cap)).length;
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
                            {isPartner ? 'भागीदार · Partner' : 'कामगार · Worker'}
                        </span>
                        <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${granted > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                            {granted}/{ACCESS.length} प्रवेश
                        </span>
                    </div>
                </div>
                {/* Chevron + label stacked in a compact right column so they
                    don't compete with the name for horizontal space. */}
                <div className="flex flex-shrink-0 flex-col items-center gap-1 pl-1">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${open ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                    <span className="whitespace-nowrap text-[9.5px] font-bold leading-none text-emerald-700">{open ? 'बंद करा' : 'प्रवेश ठरवा'}</span>
                </div>
            </button>

            {open && (
                <div className="animate-in fade-in slide-in-from-top-1 border-t border-slate-100 bg-slate-50/50 px-3 py-3 duration-200">
                    <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        हा सदस्य काय करू शकतो? · What can they do?
                    </p>
                    <div className="space-y-2">
                        {ACCESS.map(a => {
                            const on = caps.includes(a.cap);
                            return (
                                <button
                                    key={a.cap}
                                    type="button"
                                    onClick={() => onToggleCap(a.cap)}
                                    aria-pressed={on}
                                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98] ${on ? 'border-emerald-200 bg-emerald-50/70 shadow-sm shadow-emerald-100' : 'border-slate-200 bg-white'}`}
                                >
                                    <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                        {a.icon}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold text-slate-800">{a.mr} · {a.en}</span>
                                        <span className="block text-[11px] leading-snug text-slate-400">{a.desc}</span>
                                    </span>
                                    <span className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : ''}`} />
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* LABOUR_PHASE2 Phase 5 — the real one.

                        Rendered BELOW the four above and visually separated,
                        because they are not the same kind of control. Those
                        four are local state that the next pull OVERWRITES
                        (`profileAndCropsReconciler.ts:150` recomputes
                        capabilities from role via `capabilitiesForRole`); this
                        one is the server's own answer.

                        ENGLISH ONLY, by founder ruling — no approved Marathi
                        exists for these three labels and no agent may invent
                        farmer-facing Marathi. They are on the founder-copy list.

                        `isEditable: false` renders a STATIC state, not a
                        disabled switch: an owner-tier member or a Mukadam
                        carries this by role and the server refuses the write,
                        so anything switch-shaped would be a control that looks
                        functional and does nothing (`P5`). */}
                    {labourAccess && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                            {labourAccess.isEditable ? (
                                <button
                                    type="button"
                                    data-testid={`labour-access-${member.id}`}
                                    onClick={() => labourAccess.onChange(!labourAccess.canManage)}
                                    disabled={labourAccess.saving}
                                    aria-pressed={labourAccess.canManage}
                                    aria-busy={labourAccess.saving}
                                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${labourAccess.canManage ? 'border-emerald-200 bg-emerald-50/70 shadow-sm shadow-emerald-100' : 'border-slate-200 bg-white'}`}
                                >
                                    <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors ${labourAccess.canManage ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                        <ClipboardList size={18} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold text-slate-800">Fix labour records</span>
                                        <span className="block text-[11px] leading-snug text-slate-400">Can change attendance, hours and names</span>
                                    </span>
                                    <span className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${labourAccess.canManage ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                                        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${labourAccess.canManage ? 'translate-x-5' : ''}`} />
                                    </span>
                                </button>
                            ) : (
                                <div
                                    data-testid={`labour-access-${member.id}`}
                                    className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left"
                                >
                                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                                        <ClipboardList size={18} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-bold text-slate-800">Fix labour records</span>
                                        <span className="block text-[11px] leading-snug text-slate-400">Comes with their role</span>
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
