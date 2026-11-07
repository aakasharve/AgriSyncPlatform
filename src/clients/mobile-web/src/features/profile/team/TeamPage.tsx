/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TeamPage — "माझी टीम", the owner's team screen, opened from सेट-अप केंद्र → माणसं → माझी टीम.
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2, MU-7 / MU-8 / MU-10). The approved look of the
 * PLR-D7 preview (plr-d1a `multiuser/MuTeam.tsx`) over TODAY's real data:
 *   1. the farm's permanent code, big, and the farm QR (the existing `FarmInviteQrSheet`);
 *   2. "X आत येऊ इच्छितात" — waiting requests the PRIMARY owner answers in one tap (or नको);
 *   3. one card per person let in (role, phone tail, how he came in, what he may do, paused +
 *      reason), with बदला (the two choices, the हजेरी व पक्कं switch) / आणखी — and one honest line
 *      that every phone still receives all the farm's records, money included (until step 4a);
 *   4. the farm's named workers (no login) — the existing `FarmWorkersCard`, unchanged.
 * Everything comes from the owner-tier server roster; every decision adopts the row the server
 * returns. Founder D-22 (26 Oct): only the PRIMARY owner decides about people — a co-owner sees the
 * roster but no request to answer and no choice, pause or removal. Founder D-44 §2 (spec I27): only the
 * PRIMARY owner moves a switch — the हजेरी व पक्कं switch on a worker or मुकादम, and, on a co-owner, the switch
 * for confirming records (his labour edits stay with his role). Not here (later steps, P5): role band, plot chips, any permission switch, the
 * family / co-owner choice (proposed step 2b), invite builder.
 *
 * lane 2b (founder D-22 / D-26): the roster, the farm QR and every switch are the PRIMARY account
 * holder's alone — the server now refuses a सहमालक all three, so a सहमालक sees the same view-only list
 * a मुकादम sees. Each let-in person's card carries one switch per enforced responsibility.
 */
import React, { useState } from 'react';
import type { FarmOperator } from '../../../types';
import { Chip, SANS, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import { isPhoneLocalOnlyMember } from '../helpers/teamRoster';
import { FarmWorkersCard } from '../components/FarmWorkersCard';
import type { UseLabourPermissionsResult } from '../hooks/useLabourPermissions';
import { useMembershipDecisions } from '../hooks/useMembershipDecisions';
import { FarmCodeCard } from './FarmCodeCard';
import { JoinRequestCard } from './JoinRequestCard';
import { TeamPersonCard } from './TeamPersonCard';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { TEAM_COPY, phonesGetNote } from './teamCopy';
import { useFarmPlots } from './useFarmPlots';
import { useFarmWorkers } from '../hooks/useFarmWorkers';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import { InviteBuilderSheet } from '../../invitations/InviteBuilderSheet';
import { SentInvitations } from '../../invitations/SentInvitations';
import { useInvitedFor } from '../../invitations/useInvitedFor';
import { invitationCopy } from '../../invitations/invitationCopy';
import {
    approveInvitationClaim, invitationRefusal, type InvitationRefusal, type PersonalInvitationView,
} from '../../invitations/personalInvitationClient';
import {
    isPrimaryOwner, nameFor, rightsOver, roleTone, roleWord, serverRoleOf, splitRoster,
} from './teamModel';

export interface TeamPageProps {
    /** The SERVER's farm id (from `/farms/mine`); null until it is known. */
    farmId: string | null;
    farmCode?: string | null;
    /** The caller's SERVER role on this farm. */
    callerRole: string | null;
    callerUserId: string | null;
    /** Names this phone already holds, keyed by the SAME server user id. */
    operators?: FarmOperator[];
    /** The owner-only roster, read once by the page that also shows the hub's request count. */
    roster: UseLabourPermissionsResult;
    onShowQr?: () => void;
}

export const TeamPage: React.FC<TeamPageProps> = ({ farmId, farmCode, callerRole, callerUserId, operators = [], roster, onShowQr }) => {
    // lane 2b: the roster and the farm QR are people and permissions — the primary account
    // holder's alone (D-26); the server refuses anyone else, so nobody else is shown them (P5).
    const ownerTier = isPrimaryOwner(callerRole);
    // The roster's own row for the caller says whether he is the farm's registrant — the primary
    // owner for now (verifier SEC-MU2-6); a seat-less registrant has no row and reads by role.
    const callerIsRegistrant = roster.rows?.find(r => r.userId === callerUserId)?.isRegistrant;
    const caller = { userId: callerUserId, role: callerRole, isRegistrant: callerIsRegistrant };
    const decidesPeople = isPrimaryOwner(callerRole) && callerIsRegistrant !== false;
    const grantsSwitches = isPrimaryOwner(callerRole);
    const decisions = useMembershipDecisions(farmId, roster.adoptRow, roster.reload);
    const { requests, people } = splitRoster(roster.rows);
    // lane MU-4 — the farm's plots for the owner's plot choice (his phone holds every plot of his farm).
    const farmPlots = useFarmPlots(decidesPeople ? farmId : null);
    const language = useOptionalLanguage()?.language;
    const busy = (userId: string) => decisions.busyUserId === userId || roster.savingUserId === userId;
    // spec: plr-d10 lane MU-2 — the invite builder (owner defines first, delivery second) and the invitations he sent.
    const [builderOpen, setBuilderOpen] = useState(false);
    const [showing, setShowing] = useState<PersonalInvitationView | null>(null);
    const [sentKey, setSentKey] = useState(0);
    const farmName = useOptionalFarmContext()?.currentFarm?.name ?? '';
    // lane MU-1 (MU-2 N-6): who an invitation was for, on the request card of whoever opened it.
    const invitedFor = useInvitedFor(decidesPeople ? farmId : null, sentKey);
    const builderWorkers = useFarmWorkers(builderOpen && decidesPeople ? farmId : null).workers;
    const invite = invitationCopy(language);
    // Fix round 1 (L-3): the one tap's refusal is said, in the server's own reason; the reload then shows what it holds.
    const [inviteRefusal, setInviteRefusal] = useState<InvitationRefusal | null>(null);
    const letInFromInvitation = async (invitationId: string) => {
        if (!farmId) return;
        setInviteRefusal(null);
        try {
            roster.adoptRow(await approveInvitationClaim(farmId, invitationId));
        } catch (error) {
            setInviteRefusal(invitationRefusal(error, 'owner'));
        }
        await roster.reload();
        setSentKey(k => k + 1);
    };
    // Fix round 1 (H-1): an invitation opened by someone other than the person it named is decided on that claimant's own
    // request card, which shows his name and his number.
    const openRequest = (claimantUserId: string) => {
        const card = document.querySelector<HTMLElement>(`[data-testid="join-request-${claimantUserId}"]`);
        card?.scrollIntoView({ block: 'center' });
        card?.focus();
    };

    return (
        <div className="space-y-3 pb-6" style={{ fontFamily: SANS }} data-testid="team-page">
            <FarmCodeCard code={farmCode} onShowQr={ownerTier ? onShowQr : undefined} />

            {(decisions.error || roster.error) && (
                <p role="alert" className="m-0 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-800" data-testid="team-error">
                    {decisions.error?.message ?? roster.error}
                </p>
            )}

            {ownerTier && roster.loadFailed && (
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3" data-testid="team-load-failed">
                    <p className="m-0 text-[14px] font-bold text-amber-900">{TEAM_COPY.loadFailed}</p>
                    <Tap onClick={() => void roster.reload()} className="min-h-[44px] rounded-full bg-white px-4 text-[14px] font-extrabold text-amber-900 ring-1 ring-amber-300">
                        {TEAM_COPY.retry}
                    </Tap>
                </div>
            )}

            {decidesPeople && requests.length > 0 && (
                <section className="space-y-2" data-testid="team-requests">
                    <SectionHead title={TEAM_COPY.requestsTitle(requests.length)} />
                    {inviteRefusal && (
                        <p role="alert" data-testid="team-invitation-refusal"
                            className="m-0 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] font-bold text-rose-800">
                            {invite.refusal[inviteRefusal]}
                        </p>
                    )}
                    <ul className="m-0 space-y-2.5 p-0">
                        {requests.map(row => (
                            <JoinRequestCard key={row.userId} row={row} name={nameFor(row, operators)} busy={busy(row.userId)}
                                farmPlots={farmPlots}
                                invitedFor={row.personalInvitationId ? invitedFor.get(row.personalInvitationId) : undefined}
                                onLetInFromInvitation={row.personalInvitationId
                                    ? () => void letInFromInvitation(row.personalInvitationId as string)
                                    : undefined}
                                onApprove={(preset, plots) => void decisions.approve(row.userId, preset, plots)}
                                onDecline={reason => void decisions.decline(row.userId, reason)} />
                        ))}
                    </ul>
                </section>
            )}

            {decidesPeople && farmId && (
                <section className="space-y-2" data-testid="team-invitations">
                    <button type="button" data-testid="team-invite-person" onClick={() => { setShowing(null); setBuilderOpen(true); }}
                        className="min-h-[56px] w-full rounded-2xl bg-emerald-600 text-[17px] font-extrabold text-white">
                        {invite.inviteButton}
                    </button>
                    <SentInvitations farmId={farmId} refreshKey={sentKey}
                        onShowAgain={row => { setShowing(row); setBuilderOpen(true); }}
                        onLetIn={() => void roster.reload()}
                        onOpenRequest={openRequest} />
                </section>
            )}

            {builderOpen && decidesPeople && farmId && (
                <InviteBuilderSheet farmId={farmId} farmName={farmName} farmPlots={farmPlots}
                    workers={(builderWorkers ?? []).filter(w => w.isActive).map(w => ({ id: w.id, displayName: w.displayName }))}
                    showing={showing}
                    onMade={() => setSentKey(k => k + 1)}
                    onClose={() => { setBuilderOpen(false); setShowing(null); setSentKey(k => k + 1); }} />
            )}

            {ownerTier && roster.rows && (
                <section className="space-y-2" data-testid="team-people">
                    <SectionHead title={TEAM_COPY.peopleTitle} />
                    <p className="m-0 rounded-2xl bg-stone-50 px-3 py-2 text-[13px] font-bold leading-snug text-stone-700 ring-1 ring-stone-200" data-testid="team-all-records-note">
                        {phonesGetNote(language)}
                    </p>
                    {people.length === 0 ? (
                        <p className="m-0 rounded-2xl bg-white px-3 py-3 text-[14px] font-bold text-stone-600 ring-1 ring-stone-200">{TEAM_COPY.noPeople}</p>
                    ) : (
                        <ul className="m-0 space-y-2.5 p-0">
                            {people.map(row => {
                                const rights = rightsOver(row, caller);
                                // PLR-D10 I27 (D-44 §2): the switches are the PRIMARY owner's to move; the server refuses
                                // anyone else, so nobody else is shown one (P5).
                                const mayGrant = grantsSwitches && row.isGrantEditable && row.userId !== callerUserId;
                                const mayGrantConfirm = grantsSwitches && row.isConfirmGrantEditable === true && row.userId !== callerUserId;
                                // lane 2b: one switch per enforced responsibility, when the server sent them.
                                const maySetAuthorities = grantsSwitches && row.canEditAuthorities === true
                                    && Array.isArray(row.authorities) && row.userId !== callerUserId;
                                // lane MU-4 — the plots: the primary account holder's choice, on a let-in person who is not
                                // the primary owner and not himself; only from a server that sends the scope.
                                const maySetPlots = decidesPeople && row.plotScope !== undefined && row.userId !== callerUserId
                                    && !row.isRegistrant && row.role !== 'PrimaryOwner'
                                    && (row.status === 'Active' || row.status === 'Suspended');
                                return (
                                    <TeamPersonCard key={row.userId} row={row} name={nameFor(row, operators)}
                                        isYou={row.userId === callerUserId} rights={rights} busy={busy(row.userId)}
                                        labourAccess={mayGrant ? {
                                            canManage: row.canManageLabourRecords,
                                            isEditable: row.isGrantEditable,
                                            saving: roster.savingUserId === row.userId,
                                            expiresAtUtc: row.labourGrantExpiresAtUtc,
                                            onChange: (next, expiresAtUtc) => void roster.setPermission(row.userId, next, expiresAtUtc),
                                        } : undefined}
                                        confirmAccess={mayGrantConfirm ? {
                                            canConfirm: row.canConfirmRecords === true,
                                            saving: roster.savingUserId === row.userId,
                                            onChange: next => void roster.setPermission(row.userId, next, null),
                                        } : undefined}
                                        authorityAccess={maySetAuthorities ? {
                                            authorities: row.authorities ?? [],
                                            notInForce: row.authoritiesNotInForce ?? [],
                                            plotsChosen: (row.effectivePlotScope ?? row.plotScope) === 'ChosenPlots',
                                            saving: roster.savingUserId === row.userId,
                                            onChange: next => void roster.setAuthorities(row.userId, next),
                                        } : undefined}
                                        plotAccess={maySetPlots ? {
                                            value: { plotScope: row.effectivePlotScope ?? row.plotScope ?? 'AllPlots', plotIds: row.plotIds ?? undefined },
                                            choices: row.plotScopeChoices ?? undefined,
                                            farmPlots,
                                            onSave: choice => void decisions.setPlots(row.userId, choice),
                                        } : undefined}
                                        onChangePreset={preset => void decisions.changePreset(row, preset)}
                                        onSuspend={reason => void decisions.suspend(row.userId, reason)}
                                        onRestore={() => void decisions.restore(row.userId)}
                                        onRemove={reason => void decisions.remove(row.userId, reason)} />
                                );
                            })}
                        </ul>
                    )}
                </section>
            )}

            {/* Not owner tier (a मुकादम): the people this phone already knows, to look at only — the
                roster and every decision are the owner's (preview HubPages non-owner team page). */}
            {!ownerTier && (
                <section className="space-y-2" data-testid="team-view-only">
                    <ul className="m-0 space-y-2 p-0">
                        {operators.filter(op => !isPhoneLocalOnlyMember(op) && op.id !== callerUserId && op.name?.trim()).map(op => {
                            const role = serverRoleOf(op.role);
                            return (
                                <li key={op.id} className="flex list-none items-center justify-between gap-2 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-stone-200">
                                    <span className="min-w-0 text-[16px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{op.name}</span>
                                    {role && <Chip tone={roleTone(role)}>{roleWord(role)}</Chip>}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="m-0 px-1 text-[13px] font-bold text-stone-500">{TEAM_COPY.ownerAddsOnly}</p>
                </section>
            )}

            {/* Named workers (no login): the primary account holder's team screen (lane 2b). */}
            {ownerTier && farmId && <FarmWorkersCard farmId={farmId} />}
        </div>
    );
};

export default TeamPage;
