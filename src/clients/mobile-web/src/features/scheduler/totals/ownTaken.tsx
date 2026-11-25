/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; P4) - "तुम्ही घेतलेली N कामं" on the profile of a schedule the plot follows: THIS farmer's own works of
 * this plot-season that were taken from the schedule (their origin `take:<version id>` is a version of the schedule's chain), counted from what the phone holds. It is his own data,
 * so the five-farmer rule does not apply. A 0 is drawn only when the phone really holds the own list of the season (at least one own work of it is kept, whatever its state);
 * otherwise there is no line - the phone never says "0" for a list it does not have.
 */
import React, { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useScheduleTemplates } from '../../../app/hooks/useReferenceData';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { totalsWords } from './totalsWords';

const plain = (id: string): string => id.replace(/-/g, '').toLowerCase();

/** The ids (32 hex digits, as an origin writes them) of every version of the schedule's chain the phone can name: the version itself, the chain id the server gave, and every row linked by `previousVersionId`. */
export function chainVersionIds(rows: readonly unknown[], versionId: string, chainId: string | null): Set<string> {
    const links = new Map<string, string | null>();
    for (const r of rows) {
        const row = r as { id?: unknown; previousVersionId?: unknown } | null;
        if (row && typeof row.id === 'string') links.set(plain(row.id), typeof row.previousVersionId === 'string' && row.previousVersionId ? plain(row.previousVersionId) : null);
    }
    const found = new Set<string>([plain(versionId)]);
    if (chainId) found.add(plain(chainId));
    let grew = true;
    while (grew) {
        grew = false;
        for (const [id, prev] of links) {
            const joins = found.has(id) || (prev !== null && found.has(prev));
            if (joins) for (const x of prev ? [id, prev] : [id]) if (!found.has(x)) { found.add(x); grew = true; }
        }
    }
    return found;
}

/** Active own works whose origin names a version of the chain. */
export function countOwnTaken(items: ReadonlyArray<{ state: string; origin: string | null }>, ids: ReadonlySet<string>): number {
    return items.filter(i => i.state === 'active' && !!i.origin && i.origin.startsWith('take:') && ids.has(i.origin.slice(5).toLowerCase())).length;
}

/** The season's own works as the server holds them on this phone; null while unread. `held` is false when the phone keeps no own work of the season at all. */
function useSeasonItems(cropCycleId: string): { held: boolean; items: Array<{ state: string; origin: string | null }> } | null {
    const [state, setState] = useState<{ held: boolean; items: Array<{ state: string; origin: string | null }> } | null>(null);
    useEffect(() => {
        const sub = liveQuery(() => getDatabase().ownScheduleItems.where('cropCycleId').equals(cropCycleId).toArray()).subscribe({
            next: rows => setState({ held: rows.length > 0, items: rows.map(r => ({ state: r.state, origin: r.origin ?? r.task?.origin ?? null })) }),
            error: () => setState({ held: false, items: [] }),
        });
        return () => sub.unsubscribe();
    }, [cropCycleId]);
    return state;
}

export const OwnTakenLine: React.FC<{ cropCycleId: string; versionId: string; chainId: string | null; templateRows?: readonly unknown[] }> = ({ cropCycleId, versionId, chainId, templateRows }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const stored = useScheduleTemplates();
    const season = useSeasonItems(cropCycleId);
    if (!season || !season.held) return null;
    const n = countOwnTaken(season.items, chainVersionIds(templateRows ?? (Array.isArray(stored) ? stored : []), versionId, chainId));
    return <p className="m-0 text-[15px] font-extrabold text-emerald-900" data-testid="own-taken-line" data-count={n}>{totalsWords(language).ownTaken(n)}</p>;
};
