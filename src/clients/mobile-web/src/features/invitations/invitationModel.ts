/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6; founder D-26). The pure rules of the
 * personal invitation on the phone: the starting set each label pre-fills (only a starting point — the owner changes any
 * of it), the three D-26 questions as edits of ONE grant, the request body (exactly the grant shown), the card's plain
 * words (from the grant the server sent), and the eight-digit code as people type or scan it. The server stays the judge
 * of every rule; this only decides what is shown and sent.
 */
import { AUTHORITY, SWITCHABLE_AUTHORITIES, authorityNeeds } from '../../core/session/farmAuthorities';
import type { AuthorityGrant } from '../profile/data/labourPermissionsClient';
import type { PlotScopeName } from '../profile/data/membershipAdminClient';
import type { InvitationCopy } from './invitationCopy';
import type { CreateInvitationBody, InvitationLabel } from './personalInvitationClient';

export const INVITATION_LABELS: readonly InvitationLabel[] = ['CoOwner', 'Family', 'Mukadam', 'Worker'];

/** What the owner is about to send: ONE object, shown on the screen and sent as it is. */
export interface InviteGrant {
    label: InvitationLabel;
    plotScope: PlotScopeName;
    plotIds: string[];
    authorities: AuthorityGrant[];
}

/**
 * The starting set each label pre-fills (D-26; a label grants nothing — these are only where the switches start):
 *  - सहमालक = शेताची रचना, हजेरी व मंजूर, पैसे पाहणे (D-26). D-26's "दर" (rates) has no server authority yet (D-43 waits
 *    with the rate list), so it is not offered (P5: no switch the server does not enforce).
 *  - कुटुंब = हजेरी व मंजूर (D-26).
 *  - मुकादम = हजेरी (my call: "recording attendance does not mean approving it", D-26 / D-44).
 *  - कामगार = nothing, his own work (the MU-4 default, MU §11.7).
 */
const PRESET: Record<InvitationLabel, { plotScope: PlotScopeName; authorities: string[] }> = {
    CoOwner: { plotScope: 'AllPlots', authorities: [AUTHORITY.editFarmSetup, AUTHORITY.takeAttendance, AUTHORITY.confirmRecords, AUTHORITY.seeMoney] },
    Family: { plotScope: 'AllPlots', authorities: [AUTHORITY.takeAttendance, AUTHORITY.confirmRecords] },
    Mukadam: { plotScope: 'AllPlots', authorities: [AUTHORITY.takeAttendance] },
    Worker: { plotScope: 'OwnWork', authorities: [] },
};

/** The grant a label starts from: its plots and its authorities, each कायम. */
export function presetGrant(label: InvitationLabel): InviteGrant {
    const preset = PRESET[label];
    return {
        label,
        plotScope: preset.plotScope,
        plotIds: [],
        authorities: preset.authorities.map(name => ({ name, expiresAtUtc: null })),
    };
}

/** A new label starts from its own set again (the owner's earlier edits were for the other label). */
export function withLabel(grant: InviteGrant, label: InvitationLabel): InviteGrant {
    return grant.label === label ? grant : presetGrant(label);
}

export function holds(grant: Pick<InviteGrant, 'authorities'>, name: string): boolean {
    return grant.authorities.some(a => a.name === name);
}

/** D-26 question 3, "can they see money?": yes gives see money (कायम); no takes it and everything that needs it. */
export function withMoney(grant: InviteGrant, seesMoney: boolean): InviteGrant {
    if (seesMoney) {
        return holds(grant, AUTHORITY.seeMoney)
            ? grant
            : { ...grant, authorities: [...grant.authorities, { name: AUTHORITY.seeMoney, expiresAtUtc: null }] };
    }
    return {
        ...grant,
        authorities: grant.authorities.filter(a => a.name !== AUTHORITY.seeMoney && authorityNeeds(a.name) !== AUTHORITY.seeMoney),
    };
}

/**
 * "Change individual permissions": the switches send the WHOLE desired set (as on the team card). A set that would grant
 * something without what it needs is completed (wages / review money bring see money) — the server refuses it otherwise.
 */
export function withAuthorities(grant: InviteGrant, next: readonly AuthorityGrant[]): InviteGrant {
    const known = next.filter(a => SWITCHABLE_AUTHORITIES.includes(a.name as never));
    const needs = known
        .map(a => authorityNeeds(a.name))
        .filter((n): n is NonNullable<typeof n> => n !== null && !known.some(a => a.name === n));
    return { ...grant, authorities: [...known, ...[...new Set(needs)].map(name => ({ name, expiresAtUtc: null }))] };
}

export function withPlots(grant: InviteGrant, plotScope: PlotScopeName, plotIds?: readonly string[]): InviteGrant {
    return { ...grant, plotScope, plotIds: plotScope === 'ChosenPlots' ? [...(plotIds ?? [])] : [] };
}

/**
 * The responsibilities that do nothing on this grant (the team card's rule, MU-4 fix pass 1): setup needs every plot; a
 * कामगार or a स्वतःचं काम seat sees only its own records, so money and wages are not in force.
 */
export function notInForce(grant: Pick<InviteGrant, 'label' | 'plotScope'>): string[] {
    const out: string[] = [];
    if (grant.plotScope !== 'AllPlots') out.push(AUTHORITY.editFarmSetup);
    // lane MU-1 (MU-2 review N-3): review money needs see money, so it is not in force wherever money is not.
    if (grant.label === 'Worker' || grant.plotScope === 'OwnWork') out.push(AUTHORITY.seeMoney, AUTHORITY.seeWages, AUTHORITY.reviewMoney);
    return out;
}

/** Ten digits of an Indian mobile (6–9 first), or null; blank is allowed (an invitation for whoever holds the code). */
export function readMobile(input: string | null | undefined): { ok: boolean; digits: string | null } {
    const raw = (input ?? '').replace(/[०-९]/g, d => String(d.charCodeAt(0) - '०'.charCodeAt(0)));
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 0) return { ok: true, digits: null };
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? { ok: true, digits } : { ok: false, digits: null };
}

/**
 * The request body: the grant on the screen, plus the optional person details. An authority that does nothing on this
 * grant (shown "लागू नाही" on its switch) is left out — the server refuses it, and no card may promise it (fix round 1,
 * M-2).
 */
export function createBody(
    grant: InviteGrant,
    person: { name?: string; mobile?: string | null; fieldOperatorId?: string | null },
): CreateInvitationBody {
    const name = person.name?.trim();
    const ruledOut = notInForce(grant);
    return {
        label: grant.label,
        ...(name ? { name } : {}),
        ...(person.mobile ? { invitedPhone: person.mobile } : {}),
        ...(person.fieldOperatorId ? { fieldOperatorId: person.fieldOperatorId } : {}),
        plotScope: grant.plotScope,
        ...(grant.plotScope === 'ChosenPlots' ? { plotIds: [...grant.plotIds] } : {}),
        authorities: grant.authorities
            .filter(a => !ruledOut.includes(a.name))
            .map(a => ({ name: a.name, expiresAtUtc: a.expiresAtUtc ?? null })),
    };
}

/** A day as the person reads it ("१२ नोव्हें" / "12 Nov"); empty for an unreadable instant. */
export function dayOf(iso: string | null | undefined, language: string | null | undefined): string {
    if (!iso) return '';
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN', { day: 'numeric', month: 'short' }).format(when);
    } catch {
        return when.toISOString().slice(0, 10);
    }
}

/**
 * The card's plain words, from the grant the SERVER sent (never from what the phone guessed): the responsibility (label),
 * the plots, one line per authority (with its end), and "पैसे दिसत नाहीत" when money is not given.
 */
export function cardLines(
    grant: { label: InvitationLabel; plotScope: PlotScopeName; plotNames: readonly string[]; authorities: readonly AuthorityGrant[] },
    copy: InvitationCopy,
    language: string | null | undefined,
): { responsibility: string; plots: string; authorities: string[] } {
    const plots = grant.plotScope === 'AllPlots'
        ? copy.allPlots
        : grant.plotScope === 'OwnWork'
            ? copy.ownWork
            : grant.plotNames.join(', ');
    // Fix round 1 (M-2, P5): an authority that does nothing on this grant is never said, even if an older invitation held it.
    const ruledOut = notInForce(grant);
    const lines = SWITCHABLE_AUTHORITIES
        .filter(name => !ruledOut.includes(name) && grant.authorities.some(a => a.name === name))
        .map(name => {
            const end = grant.authorities.find(a => a.name === name)?.expiresAtUtc;
            const word = copy.can[name] ?? name;
            return end ? `${word} (${copy.untilDay(dayOf(end, language))})` : word;
        });
    if (ruledOut.includes(AUTHORITY.seeMoney) || !grant.authorities.some(a => a.name === AUTHORITY.seeMoney)) lines.push(copy.noMoney);
    return {
        responsibility: copy.responsibilityLine(copy.labels[grant.label] ?? grant.label),
        plots: grant.plotScope === 'OwnWork' ? plots : copy.plotsLine(plots),
        authorities: lines,
    };
}

/** The address the QR and the shared link carry. */
export const INVITATION_LINK_PREFIX = 'https://shramsafal.in/i/';

/** The eight digits of an invitation code as typed, pasted or scanned (any form), or null. */
export function normalizeInvitationCode(input: string | null | undefined): string | null {
    if (!input || !input.trim()) return null;
    let text = input.trim();
    const slash = text.toLowerCase().lastIndexOf('/i/');
    if (slash >= 0) text = text.slice(slash + 3);
    const digits = text
        .replace(/[०-९]/g, d => String(d.charCodeAt(0) - '०'.charCodeAt(0)))
        .replace(/[\s-]+/g, '');
    return /^\d{8}$/.test(digits) ? digits : null;
}

/** 4821-7730 — how the code is shown and read aloud. */
export function displayInvitationCode(code: string): string {
    return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
