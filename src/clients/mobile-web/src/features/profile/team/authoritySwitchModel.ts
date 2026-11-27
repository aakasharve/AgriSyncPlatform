/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane 2b — the pure rules behind the primary owner's responsibility switches. The server's PUT
 * takes the WHOLE desired set, so every change is computed from the server's last answer: the one
 * switch moves, every other authority (the ones with no switch yet — plan, assign — included) travels
 * back exactly as the server sent it.
 */
import { MARATHI_MONTHS_FULL } from '../../labour/marathiDate';
import { SWITCHABLE_AUTHORITIES, authorityNeeds } from '../../../core/session/farmAuthorities';
import type { AuthorityGrant } from '../data/labourPermissionsClient';
import { AUTHORITY_GROUPS, type AuthorityGroupKey } from './authorityCopy';

/**
 * Repair FIX-1 item 9 — the switches by heading, in the founder's order; a switchable responsibility no heading names is
 * never hidden: it comes last, under no heading (`key: null`).
 */
export function groupedSwitches(): { key: AuthorityGroupKey | null; names: string[] }[] {
    const switchable = new Set<string>(SWITCHABLE_AUTHORITIES);
    const grouped = AUTHORITY_GROUPS.map(g => ({ key: g.key as AuthorityGroupKey | null, names: g.names.filter(n => switchable.has(n)) }));
    const placed = new Set(grouped.flatMap(g => g.names));
    const rest = SWITCHABLE_AUTHORITIES.filter(n => !placed.has(n));
    return rest.length > 0 ? [...grouped, { key: null, names: [...rest] }] : grouped;
}

/**
 * Repair FIX-1 item 9 — what he may use NOW, for the card's "काय करू शकतात" line: held, not ended (an end that has passed or
 * cannot be read counts as ended — never shown as allowed), and in force on his seat; in the headings' order.
 */
export function responsibilitiesInForce(
    authorities: readonly AuthorityGrant[],
    notInForce: readonly string[] | null | undefined,
    nowMs: number,
): string[] {
    const live = new Set(authorities
        .filter(a => a.expiresAtUtc == null || Date.parse(a.expiresAtUtc) > nowMs)
        .map(a => a.name));
    const idle = new Set(notInForce ?? []);
    return groupedSwitches().flatMap(g => g.names).filter(n => live.has(n) && !idle.has(n));
}

/** Is `name` in the server's list? */
export function holds(current: readonly AuthorityGrant[], name: string): boolean {
    return current.some(a => a.name === name);
}

/** The end the server stored for `name` (null = कायम or not held). */
export function endOf(current: readonly AuthorityGrant[], name: string): string | null {
    return current.find(a => a.name === name)?.expiresAtUtc ?? null;
}

/**
 * Turn `name` ON with `expiresAtUtc` (null = कायम). A responsibility that means nothing without
 * another (review money needs see money, MU design §11.1) brings it along with the same end when
 * the person does not hold it yet; one he already holds is left exactly as it is.
 */
export function withAuthority(
    current: readonly AuthorityGrant[],
    name: string,
    expiresAtUtc: string | null,
): AuthorityGrant[] {
    const next = current.filter(a => a.name !== name).map(a => ({ ...a }));
    next.push({ name, expiresAtUtc });
    const needed = authorityNeeds(name);
    if (needed && !next.some(a => a.name === needed)) {
        next.push({ name: needed, expiresAtUtc });
    }
    return next;
}

/**
 * Turn `name` OFF. A responsibility that means nothing without it goes with it (see money off takes see
 * wages and review money along — lane MU-3; the server refuses one stored without the other); nothing
 * else moves.
 */
export function withoutAuthority(current: readonly AuthorityGrant[], name: string): AuthorityGrant[] {
    return current.filter(a => a.name !== name && authorityNeeds(a.name) !== name).map(a => ({ ...a }));
}

/**
 * The day a responsibility runs THROUGH (its end is the following local midnight, as
 * `expiryUtcForChip('date', …)` stores it), for the "…पर्यंत" line. '' for कायम or an unreadable
 * instant — never an invented date.
 */
export function throughDay(expiresAtUtc: string | null, language: string | null | undefined): string {
    if (!expiresAtUtc) return '';
    const end = new Date(expiresAtUtc);
    if (Number.isNaN(end.getTime())) return '';
    const through = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    return language === 'en'
        ? through.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
        : `${through.getDate()} ${MARATHI_MONTHS_FULL[through.getMonth()]}`;
}
