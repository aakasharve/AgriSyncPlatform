/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the team screen's reading of the SERVER roster
 * (`GET farms/{farmId}/labour-permissions`, owner tier only). Pure: no I/O, so every rule here is
 * tested without a screen.
 *
 * Nothing is invented: a person is listed under the name the server's directory sent (or the name
 * this phone already holds for that SAME server user id), otherwise "—" (doctrine P4); what a person
 * may do is read from the server's answers (role, the labour grant), never guessed.
 *
 * Founder D-22 (answered 26 Oct 2026): ONLY the primary owner decides about people. In step 2 he
 * lets a person in as one of two choices — काम सांगणे (Worker) or काम + हजेरी (Mukadam + the
 * existing हजेरी व पक्कं grant). A co-owner / family choice with visible switches is PROPOSED for
 * step 2b; nothing here offers it.
 */
import type { FarmOperator } from '../../../types';
import type { LabourPermission } from '../data/labourPermissionsClient';
import type { ApprovePreset } from '../data/membershipAdminClient';
import { getOperatorRoleLabel } from '../../../shared/roles/roleLabels';
import type { Tone } from '../../../shared/components/ui/placeUi';
import { DO_WORDS, TEAM_COPY } from './teamCopy';

/** The status of a request still waiting for the owner's answer. */
const WAITING = 'PendingApproval';
/**
 * Never listed: an ended seat, and an invitation nobody has claimed yet (`PendingOtpClaim` — no
 * path writes one today; the server cannot approve it, so a request card for it would offer
 * buttons that only fail, P5 — verifier SEC-MU2-4).
 */
const UNLISTED = new Set(['Revoked', 'Exited', 'PendingOtpClaim']);

export interface TeamSplit {
    /** Waiting requests, oldest first (the owner answers them in the order they came). */
    requests: LabourPermission[];
    /** People let in: Active and paused, owner tier first. */
    people: LabourPermission[];
}

const ROLE_RANK: Record<string, number> = { PrimaryOwner: 0, SecondaryOwner: 1, Mukadam: 2, Worker: 3 };

export function splitRoster(rows: readonly LabourPermission[] | null | undefined): TeamSplit {
    const live = (rows ?? []).filter(r => !UNLISTED.has(r.status));
    const requests = live
        .filter(r => r.status === WAITING)
        .sort((a, b) => (a.requestedAtUtc ?? '').localeCompare(b.requestedAtUtc ?? ''));
    const people = live
        .filter(r => r.status !== WAITING)
        .sort((a, b) => Number(b.isRegistrant ?? false) - Number(a.isRegistrant ?? false)
            || (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9));
    return { requests, people };
}

/** The name to show: the server directory's, else this phone's for the SAME server id, else "—". */
export function nameFor(row: LabourPermission, operators: readonly FarmOperator[] = []): string {
    const fromServer = row.displayName?.trim();
    if (fromServer) return fromServer;
    const fromPhone = operators.find(op => op.id === row.userId)?.name?.trim();
    return fromPhone || TEAM_COPY.nameUnknown;
}

/** M-7 — "मोबाईल …4321" from the server's last four digits; '' when the server sent none. */
export function phoneLine(row: LabourPermission): string {
    const tail = row.phoneLast4?.trim();
    return tail && /^\d{4}$/.test(tail) ? TEAM_COPY.phoneTail(tail) : '';
}

/**
 * M-8 — how a person let in came to the farm, from the server's own facts: asked by typing the farm
 * code and an owner approved; asked by the farm QR (after being stopped) and an owner approved; or
 * came straight in by the farm QR. '' for anything else (never a guess).
 */
export function arrivalLine(row: LabourPermission): string {
    if (row.approvedByOwner) {
        if (row.joinedVia === 'SelfJoin') return TEAM_COPY.cameByCodeApproved;
        if (row.joinedVia === 'QrScan') return TEAM_COPY.cameByQrApproved;
        return '';
    }
    return row.joinedVia === 'QrScan' ? TEAM_COPY.cameByQrDirect : '';
}

/** The phone's operator role ("PRIMARY_OWNER", …) in the server's words ("PrimaryOwner", …). */
export function serverRoleOf(role: string | null | undefined): string {
    switch (role) {
        case 'PRIMARY_OWNER': return 'PrimaryOwner';
        case 'SECONDARY_OWNER': return 'SecondaryOwner';
        case 'MUKADAM': return 'Mukadam';
        case 'WORKER': return 'Worker';
        case 'UNKNOWN': return '';
        default: return role ?? '';
    }
}

export const isOwnerTier = (role: string | null | undefined): boolean =>
    role === 'PrimaryOwner' || role === 'SecondaryOwner';

/**
 * The role word on a person's chip. A co-owner seat that already exists keeps its plain label
 * (the app's existing "सहमालक"); nothing on this screen offers the role (D-22, step 2b).
 */
export function roleWord(role: string): string {
    switch (role) {
        case 'PrimaryOwner': return 'मालक';
        case 'Mukadam': return 'मुकादम';
        case 'Worker': return 'कामगार';
        default: return getOperatorRoleLabel(role).mr;
    }
}

/** The role's own colour (preview ROLE_TONE), in the shared look kit's tones. */
export function roleTone(role: string): Tone {
    switch (role) {
        case 'PrimaryOwner': return 'green';
        case 'SecondaryOwner': return 'blue';
        case 'Mukadam': return 'amber';
        default: return 'stone';
    }
}

/**
 * ONE line of what this person may do, from the server's rules only:
 *  - every Active person tells his work and records a purchase (the server lets every Active
 *    member record one — alignment M-5);
 *  - हजेरी · पक्कं करणे only with the labour grant (or the owner tier, which carries it by role);
 *  - माणसं बोलावणे only for the owner tier (the farm QR route is owner tier).
 * Seeing money and planning work are left out on purpose: no phone is narrowed by them until later
 * steps (role-scoped download 4a; D-24 tasks), so either word would be untrue today (P5).
 */
export function doLine(row: LabourPermission): string {
    if (row.status !== 'Active') return '';
    const words: string[] = [DO_WORDS.tellWork, DO_WORDS.addCost];
    if (row.canManageLabourRecords) words.push(DO_WORDS.attendance, DO_WORDS.verify);
    if (isOwnerTier(row.role)) words.push(DO_WORDS.invite);
    return words.join(' · ');
}

/** Which of the two step-2 choices a let-in person currently sits on (by role); null otherwise. */
export function presetOf(role: string): ApprovePreset | null {
    switch (role) {
        case 'Worker': return 'work';
        case 'Mukadam': return 'crew';
        default: return null;
    }
}

export const PRESETS: readonly { id: ApprovePreset; label: string; hint: string }[] = [
    { id: 'work', label: TEAM_COPY.presetWork, hint: TEAM_COPY.presetWorkHint },
    { id: 'crew', label: TEAM_COPY.presetCrew, hint: TEAM_COPY.presetCrewHint },
];

/**
 * What the caller may decide about this person — mirrors the server's guards so the screen never
 * draws a control the server would refuse (P5). The server still checks every one.
 *  - only the PRIMARY owner decides at all (founder D-22; a co-owner gets 403 for every decision),
 *    and for now the primary owner is the farm's registrant: a caller the roster names as NOT the
 *    registrant decides nothing (verifier SEC-MU2-6). An older server sends no `isRegistrant`;
 *    then the role alone is read, as before;
 *  - never yourself, never the farm's registrant;
 *  - a primary owner keeps his role (it is never handed out or taken by a choice).
 */
export interface DecisionRights {
    canDecide: boolean;
    /** May pick one of the two choices for this person (the role chips). */
    canChangeRole: boolean;
}

export const isPrimaryOwner = (role: string | null | undefined): boolean => role === 'PrimaryOwner';

export function rightsOver(
    row: LabourPermission,
    caller: { userId: string | null | undefined; role: string | null | undefined; isRegistrant?: boolean | null },
): DecisionRights {
    const none: DecisionRights = { canDecide: false, canChangeRole: false };
    if (!isPrimaryOwner(caller.role) || !caller.userId || caller.isRegistrant === false) return none;
    if (row.userId === caller.userId || row.isRegistrant) return none;
    return { canDecide: true, canChangeRole: row.role !== 'PrimaryOwner' };
}
