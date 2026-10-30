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
 */
import React from 'react';
import type { FarmOperator } from '../../../types';
import { Chip, SANS, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import { isPhoneLocalOnlyMember } from '../helpers/teamRoster';
import { FarmWorkersCard } from '../components/FarmWorkersCard';
import type { UseLabourPermissionsResult } from '../hooks/useLabourPermissions';
import { useMembershipDecisions } from '../hooks/useMembershipDecisions';
import { FarmCodeCard } from './FarmCodeCard';
import { JoinRequestCard } from './JoinRequestCard';
import { TeamPersonCard } from './TeamPersonCard';
import { TEAM_COPY } from './teamCopy';
import {
    isOwnerTier, isPrimaryOwner, nameFor, rightsOver, roleTone, roleWord, serverRoleOf, splitRoster,
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
    const ownerTier = isOwnerTier(callerRole);
    // The roster's own row for the caller says whether he is the farm's registrant — the primary
    // owner for now (verifier SEC-MU2-6); a seat-less registrant has no row and reads by role.
    const callerIsRegistrant = roster.rows?.find(r => r.userId === callerUserId)?.isRegistrant;
    const caller = { userId: callerUserId, role: callerRole, isRegistrant: callerIsRegistrant };
    const decidesPeople = isPrimaryOwner(callerRole) && callerIsRegistrant !== false;
    const grantsSwitches = isPrimaryOwner(callerRole);
    const decisions = useMembershipDecisions(farmId, roster.adoptRow, roster.reload);
    const { requests, people } = splitRoster(roster.rows);
    const busy = (userId: string) => decisions.busyUserId === userId || roster.savingUserId === userId;

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
                    <ul className="m-0 space-y-2.5 p-0">
                        {requests.map(row => (
                            <JoinRequestCard key={row.userId} row={row} name={nameFor(row, operators)} busy={busy(row.userId)}
                                onApprove={preset => void decisions.approve(row.userId, preset)}
                                onDecline={reason => void decisions.decline(row.userId, reason)} />
                        ))}
                    </ul>
                </section>
            )}

            {ownerTier && roster.rows && (
                <section className="space-y-2" data-testid="team-people">
                    <SectionHead title={TEAM_COPY.peopleTitle} />
                    <p className="m-0 rounded-2xl bg-amber-50 px-3 py-2 text-[13px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid="team-all-records-note">
                        {TEAM_COPY.allRecordsNote}
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

            {/* Named workers (no login): owner / co-owner only, as told by the server-sent role. */}
            {ownerTier && farmId && <FarmWorkersCard farmId={farmId} />}
        </div>
    );
};

export default TeamPage;
