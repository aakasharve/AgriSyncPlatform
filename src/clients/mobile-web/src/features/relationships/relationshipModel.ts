/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6, "one source of truth"). The pure reading of
 * `/me/context` that the header's "तुम्ही इथे" card, the farm switcher and the relationship cards all share - no parallel client
 * arrays. A seat is read by its LABEL (the owner's word: सहमालक, कुटुंब, मुकादम, कामगार) and its PLOTS; what it may do comes from
 * the authorities the server sent, never from the label (D-22, D-26).
 */
import type { MeAuthority, MeContext, MeFarm } from '../../core/session/MeContextService';
import { isActiveSeat } from '../../core/session/seatStatus';
import { getRoleLabel } from '../../shared/roles/roleLabels';
import { dayOf } from '../invitations/invitationModel';
import { relationshipCopy, toRelationshipLanguage, type RelationshipCopy } from './relationshipCopy';

/** An authority end is "near" when it falls within this many days (CTO call, reversible). */
export const NEAR_EXPIRY_DAYS = 14;

/** The label key of a seat: the owner's chosen label, else what the role says ("PrimaryOwner" -> Owner). */
export function labelKeyOf(farm: Pick<MeFarm, 'role' | 'label'>): 'Owner' | 'CoOwner' | 'Family' | 'Mukadam' | 'Worker' {
    if (farm.role === 'PrimaryOwner') return 'Owner';
    if (farm.label === 'CoOwner' || farm.label === 'Family' || farm.label === 'Mukadam' || farm.label === 'Worker') return farm.label;
    switch (farm.role) {
        case 'SecondaryOwner': return 'CoOwner';
        case 'Mukadam': return 'Mukadam';
        default: return 'Worker';
    }
}

/** The role word, in the person's language. */
export function roleWordOf(farm: Pick<MeFarm, 'role' | 'label'>, copy: RelationshipCopy): string {
    return copy.role[labelKeyOf(farm)] ?? copy.role.Worker;
}

/** "सर्व प्लॉट" / "3 प्लॉट" / "स्वतःचं काम". The primary owner and a seat the server did not describe cover every plot. */
export function plotsLineOf(farm: Pick<MeFarm, 'role' | 'plotScope' | 'plotNames'>, copy: RelationshipCopy): string {
    if (farm.role === 'PrimaryOwner' || !farm.plotScope || farm.plotScope === 'AllPlots') return copy.allPlots;
    if (farm.plotScope === 'OwnWork') return copy.ownWork;
    return copy.plotCount((farm.plotNames ?? []).length);
}

/** The soonest authority end that is still ahead and near, or null. */
export function nearestEnd(authorities: readonly MeAuthority[] | null | undefined, now: Date): string | null {
    const horizon = now.getTime() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    let soonest: number | null = null;
    for (const a of authorities ?? []) {
        if (!a?.expiresAtUtc) continue;
        const at = new Date(a.expiresAtUtc).getTime();
        if (Number.isNaN(at) || at <= now.getTime() || at > horizon) continue;
        if (soonest === null || at < soonest) soonest = at;
    }
    return soonest === null ? null : new Date(soonest).toISOString();
}

export function isPrimarySeat(farm: Pick<MeFarm, 'role'>): boolean {
    return farm.role === 'PrimaryOwner';
}

/** The Active seats - the only ones that are farms (a waiting invitation or request is never a row, visible is not operational). */
export function activeSeats(me: MeContext | null | undefined): MeFarm[] {
    return (me?.farms ?? []).filter(isActiveSeat);
}

/**
 * Repair R3 lane S1 (V3-D, 27 Nov 2026) - the line of the header's "तुम्ही इथे" card: "मालक · सर्व प्लॉट", "मुकादम · 3 प्लॉट",
 * "कामगार · स्वतःचं काम". It replaces the role band and the nameboard's small word, with the same words, and now everyone sees it:
 * a single-farm owner too (the approved design changes MU §6 Scenario A). It reads the OPEN farm only: when /me/context does not
 * list that farm as an active seat, the answer is null, never another seat's role.
 */
export function hereLineFor(
    me: MeContext | null | undefined,
    currentFarmId: string | null | undefined,
    language: string | null | undefined,
): string | null {
    const seat = activeSeats(me).find(s => s.farmId === currentFarmId);
    if (!seat) return null;
    const copy = relationshipCopy(language);
    return `${roleWordOf(seat, copy)} · ${plotsLineOf(seat, copy)}`;
}

/** The role word of the plain farm list (/farms/mine's role), before /me/context answers: one language only. */
export function plainRoleWord(role: string, language: string | null | undefined): string {
    switch (role) {
        case 'PrimaryOwner':
        case 'SecondaryOwner':
        case 'Mukadam':
        case 'Worker': {
            const l = getRoleLabel(role);
            return toRelationshipLanguage(language) === 'en' ? l.en : l.mr;
        }
        default: return role;
    }
}

export interface SwitcherRow {
    farmId: string;
    name: string;
    word: string;
    plots: string;
    /** "4 नोव्हें पर्यंत" - only when an authority end is near. */
    until: string | null;
    current: boolean;
}

/** One row per ACTIVE relationship; never a waiting invitation or request. */
export function switcherRows(
    me: MeContext | null | undefined,
    currentFarmId: string | null | undefined,
    language: string | null | undefined,
    now: Date = new Date(),
): SwitcherRow[] {
    const copy = relationshipCopy(language);
    const seats = activeSeats(me);
    const current = seats.find(s => s.farmId === currentFarmId) ?? seats[0];
    return seats.map(seat => {
        const end = nearestEnd(seat.authorities, now);
        return {
            farmId: seat.farmId,
            name: seat.name,
            word: roleWordOf(seat, copy),
            plots: plotsLineOf(seat, copy),
            until: end ? copy.switcher.until(dayOf(end, language)) : null,
            current: seat.farmId === current?.farmId,
        };
    });
}

/** A person with no farm of his own among his seats - the switcher then asks "तुमचं स्वतःचं शेत आहे का?". */
export function ownsNoFarm(me: MeContext | null | undefined): boolean {
    const seats = activeSeats(me);
    return seats.length > 0 && !seats.some(isPrimarySeat);
}

export type CardState = 'active' | 'waiting' | 'paused';

export interface RelationshipCardModel {
    farmId: string;
    farmName: string;
    state: CardState;
    word: string;
    plotsLine: string;
    plotNames: string[];
    isPrimary: boolean;
    authorities: MeAuthority[];
    near: string | null;
    reason: string | null;
}

/**
 * The cards for the seats that are not "invited" (an invitation has its own card, from `me.invitations`): active, waiting for
 * the owner (a request), or paused with its reason. A seat that is none of these (ended) is not listed by the server.
 */
export function relationshipCards(
    me: MeContext | null | undefined,
    language: string | null | undefined,
    now: Date = new Date(),
): RelationshipCardModel[] {
    const copy = relationshipCopy(language);
    return (me?.farms ?? []).map(seat => {
        const state: CardState = isActiveSeat(seat) ? 'active' : seat.status === 'Suspended' ? 'paused' : 'waiting';
        return {
            farmId: seat.farmId,
            farmName: seat.name,
            state,
            word: roleWordOf(seat, copy),
            plotsLine: plotsLineOf(seat, copy),
            plotNames: seat.plotScope === 'ChosenPlots' ? [...(seat.plotNames ?? [])] : [],
            isPrimary: isPrimarySeat(seat),
            authorities: [...(seat.authorities ?? [])],
            near: state === 'active' ? nearestEnd(seat.authorities, now) : null,
            reason: state === 'paused' ? (seat.statusReason ?? null) : null,
        };
    });
}

/** A chosen-plots seat: its money totals are his plots' only (labelled so). */
export function isChosenPlotsSeat(farm: Pick<MeFarm, 'role' | 'plotScope'> | null | undefined): boolean {
    return !!farm && farm.role !== 'PrimaryOwner' && farm.plotScope === 'ChosenPlots';
}
