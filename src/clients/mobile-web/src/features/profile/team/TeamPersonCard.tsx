/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TeamPersonCard — one person let into the farm, on ONE card (design ported from the approved
 * preview, plr-d1a `multiuser/MuTeam.tsx` PersonCard): name, role chip in the role's colour, the
 * last four digits of the account phone (M-7), how the person came in (M-8), ONE line of what they
 * may do, a paused note with the owner's reason; "बदला" opens the two choices (काम सांगणे / काम +
 * हजेरी), the real हजेरी व पक्कं switch, and — folded under "आणखी" — pause / restore / remove with a
 * reason.
 *
 * lane 2b (MU design §2, §11.1): when the server sends the person's authorities and says the caller
 * may set them (`canEditAuthorities`), the card shows ONE switch per enforced responsibility
 * (`AuthoritySwitches`) in place of the old हजेरी व पक्कं switch and the co-owner confirm switch; an
 * older server keeps the old switches.
 *
 * lane MU-4: one row, "प्लॉट: सर्व प्लॉट ›", opens the owner's plot choice (`PlotScopePicker`) for a let-in person.
 *
 * Real data only (spec: plr-d7-m1-multiuser-2026-10-26, step 2, MU-10). NOT here on purpose (P5,
 * plan §4, founder D-22 / D-24 of 26 Oct): any permission switch (money,
 * planning — no switch until the step whose server rule it would control exists), the family /
 * co-owner choice (proposed step 2b). Only the PRIMARY owner decides about people; no control is
 * drawn on the registrant or on yourself — the server refuses both.
 */
import React, { useState } from 'react';
import { Pause, Play, Smartphone, Trash2, User } from 'lucide-react';
import { Chip, Tap } from '../../../shared/components/ui/placeUi';
import type { LabourPermission } from '../data/labourPermissionsClient';
import type { ApprovePreset } from '../data/membershipAdminClient';
import { LabourAccessControl, type LabourAccessView } from '../components/LabourAccessControl';
import { ConfirmAccessControl, type ConfirmAccessView } from './ConfirmAccessControl';
import { AuthoritySwitches, type AuthorityAccessView } from './AuthoritySwitches';
import { PlotScopePicker } from './PlotScopePicker';
import type { PlotScopeChoice } from '../data/membershipAdminClient';
import type { FarmPlot } from './useFarmPlots';
import { PRESETS, arrivalLine, doLine, phoneLine, presetOf, roleTone, roleWord, type DecisionRights } from './teamModel';
import { ReasonStep } from './ReasonStep';
import { TEAM_COPY } from './teamCopy';

export interface TeamPersonCardProps {
    row: LabourPermission;
    name: string;
    isYou: boolean;
    rights: DecisionRights;
    busy: boolean;
    /**
     * The real labour-grant switch, passed ONLY when the caller may move it for this person (an
     * owner-tier caller, someone else, not owner tier). Owner tier carries it by role: their line
     * already says हजेरी · पक्कं करणे, and a switch that cannot move is never drawn (P5).
     */
    labourAccess?: LabourAccessView;
    /**
     * PLR-D10 I27 (founder D-44 §2) — the primary owner's switch for a CO-OWNER's responsibility to confirm
     * records, passed ONLY when the server says he may move it for this person.
     */
    confirmAccess?: ConfirmAccessView;
    /**
     * lane 2b — the primary owner's per-responsibility switches, passed ONLY when the server sent this
     * person's authorities and says the caller may set them. When present, the two older switches
     * above are not drawn.
     */
    authorityAccess?: AuthorityAccessView;
    /**
     * lane MU-4 — the primary owner's plot choice for this person ("प्लॉट: सर्व प्लॉट ›"), passed ONLY when he may set
     * it (the primary account holder, a let-in person who is not the primary owner, not himself).
     */
    plotAccess?: { value: PlotScopeChoice; farmPlots: readonly FarmPlot[]; onSave: (choice: PlotScopeChoice) => void };
    onChangePreset: (preset: ApprovePreset) => void;
    onSuspend: (reason: string) => void;
    onRestore: () => void;
    onRemove: (reason: string) => void;
}

type Step = null | 'pause' | 'remove';

export const TeamPersonCard: React.FC<TeamPersonCardProps> = ({
    row, name, isYou, rights, busy, labourAccess, confirmAccess, authorityAccess, plotAccess, onChangePreset, onSuspend, onRestore, onRemove,
}) => {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>(null);
    const paused = row.status === 'Suspended';
    const line = doLine(row);
    const phone = phoneLine(row);
    const arrival = arrivalLine(row);
    const current = presetOf(row.role);
    const hasChangeable = rights.canDecide || !!labourAccess?.isEditable || !!confirmAccess || !!authorityAccess;

    return (
        <li data-testid={`team-person-${row.userId}`} data-status={row.status}
            className={`list-none rounded-3xl border-2 bg-white p-3.5 ${paused ? 'border-amber-400 bg-amber-50/50' : 'border-stone-200'}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="m-0 text-[19px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{name}</h3>
                    {isYou && <p className="m-0 text-[13px] font-bold text-stone-600">{TEAM_COPY.you}</p>}
                    {row.isRegistrant && <p className="m-0 text-[13px] font-bold text-stone-600" data-testid="team-person-registrant">{TEAM_COPY.registrantNote}</p>}
                    {phone && (
                        <p className="m-0 flex items-center gap-1 text-[13.5px] font-bold text-stone-700" data-testid="team-person-phone">
                            <Smartphone size={14} aria-hidden="true" />{phone}
                        </p>
                    )}
                </div>
                <Chip tone={roleTone(row.role)}><User size={13} aria-hidden="true" />{roleWord(row.role)}</Chip>
            </div>
            {line && <p className="m-0 mt-1.5 text-[14px] font-bold leading-snug text-stone-900" data-testid="team-person-line">{line}</p>}
            {arrival && <p className="m-0 mt-0.5 text-[12.5px] font-semibold text-stone-500" data-testid="team-person-arrival">{arrival}</p>}
            {plotAccess && (
                <div className="mt-2">
                    <PlotScopePicker memberId={row.userId} value={plotAccess.value} farmPlots={plotAccess.farmPlots} busy={busy}
                        onSave={plotAccess.onSave} />
                </div>
            )}
            {paused && (
                <div className="mt-1 space-y-0.5" data-testid="team-person-paused">
                    <p className="m-0 text-[13px] font-extrabold text-amber-900">{TEAM_COPY.pausedNote}</p>
                    {row.statusReason && <p className="m-0 text-[13px] font-bold text-amber-900">{TEAM_COPY.reasonLine(row.statusReason)}</p>}
                </div>
            )}

            {hasChangeable && (
                <Tap onClick={() => { setOpen(o => !o); setStep(null); }} aria-expanded={open} data-testid={`team-change-${row.userId}`}
                    rippleColor="rgba(255,255,255,0.35)"
                    className="mt-2.5 min-h-[44px] rounded-full bg-[#1448E6] px-5 text-[14px] font-extrabold text-white">
                    {open ? TEAM_COPY.close : TEAM_COPY.change}
                </Tap>
            )}

            {open && (
                <div className="mt-3 space-y-2.5 rounded-2xl bg-stone-50 p-3" data-testid={`team-change-panel-${row.userId}`}>
                    {/* lane 2b fix 1 (orchestrator's live finding): ONE control per power. With the
                        server's per-authority switches the old "काम सांगणे / काम + हजेरी" chooser is not
                        drawn (it would be a second हजेरी control); the server keeps its old route for
                        installed APKs (P11). An older server (no authorities) keeps the chooser. */}
                    {rights.canChangeRole && !paused && !authorityAccess && (
                        <div className="space-y-1.5">
                            <p className="m-0 text-[13.5px] font-extrabold text-stone-700">{TEAM_COPY.quick}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {PRESETS.map(p => (
                                    <Tap key={p.id} disabled={busy || current === p.id} aria-pressed={current === p.id}
                                        onClick={() => onChangePreset(p.id)} data-testid={`team-preset-${p.id}-${row.userId}`}
                                        className={`min-h-[44px] rounded-full px-3.5 text-[14.5px] font-extrabold ${current === p.id ? 'bg-[#1448E6] text-white' : 'bg-white text-stone-700 ring-1 ring-stone-300'}`}>
                                        {p.label}
                                    </Tap>
                                ))}
                            </div>
                        </div>
                    )}
                    {authorityAccess
                        ? <AuthoritySwitches memberId={row.userId} access={authorityAccess} />
                        : (
                            <>
                                {labourAccess && <LabourAccessControl memberId={row.userId} memberName={name} access={labourAccess} />}
                                {confirmAccess && <ConfirmAccessControl memberId={row.userId} access={confirmAccess} />}
                            </>
                        )}

                    {rights.canDecide && (
                        <details className="pt-1" data-testid={`team-more-${row.userId}`}>
                            <summary className="cursor-pointer text-[13.5px] font-extrabold text-stone-600">{TEAM_COPY.more}</summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {paused ? (
                                    <Tap onClick={onRestore} disabled={busy} data-testid={`team-restore-${row.userId}`}
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-emerald-600 px-4 text-[14px] font-extrabold text-emerald-800 disabled:opacity-60">
                                        <Play size={16} aria-hidden="true" />{TEAM_COPY.resume}
                                    </Tap>
                                ) : (
                                    <Tap onClick={() => setStep('pause')} disabled={busy} data-testid={`team-pause-${row.userId}`}
                                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-amber-500 px-4 text-[14px] font-extrabold text-amber-900 disabled:opacity-60">
                                        <Pause size={16} aria-hidden="true" />{TEAM_COPY.pause}
                                    </Tap>
                                )}
                                <Tap onClick={() => setStep('remove')} disabled={busy} data-testid={`team-remove-${row.userId}`}
                                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-red-300 px-4 text-[14px] font-extrabold text-red-700 disabled:opacity-60">
                                    <Trash2 size={16} aria-hidden="true" />{TEAM_COPY.remove}
                                </Tap>
                            </div>
                            {step === 'pause' && (
                                <ReasonStep question={TEAM_COPY.pauseAsk} confirmLabel={TEAM_COPY.pause} reasonIsShown busy={busy}
                                    onConfirm={reason => { onSuspend(reason); setStep(null); }} onCancel={() => setStep(null)}
                                    testId={`pause-step-${row.userId}`} />
                            )}
                            {step === 'remove' && (
                                <ReasonStep question={TEAM_COPY.removeAsk} confirmLabel={TEAM_COPY.remove} busy={busy}
                                    onConfirm={reason => { onRemove(reason); setStep(null); }} onCancel={() => setStep(null)}
                                    testId={`remove-step-${row.userId}`} />
                            )}
                        </details>
                    )}
                </div>
            )}
        </li>
    );
};

export default TeamPersonCard;
