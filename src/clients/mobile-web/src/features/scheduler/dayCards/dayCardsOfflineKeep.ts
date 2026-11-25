// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slices 8 and 12b, CTO gate after the real-app drive; P10 offline) - the day cards a farmer may open in the field, kept on
// the phone right after a pull: every schedule version a plot on this phone follows, plus any version the caller names (the version an owner's message is about and the
// checked new version a change points at). Only a version with NO copy on the phone is fetched (an open viewer refreshes a copy it has when there is signal), so a pull costs
// nothing once the copies are there. Without this, a farmer who synced at home but never opened the Schedule tab online saw "not on the phone yet" in the field.
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { loadDayCards, readCachedDayCards, type DayCardsFetch } from './dayCardsStore';

/** Fetches and keeps the day cards of each version with no copy on this phone; returns the ids it kept. Does nothing with no signal; never throws. */
export async function keepDayCardsForOffline(versionIds: Iterable<string>, db: AgriLogDatabase = getDatabase(), send?: DayCardsFetch): Promise<string[]> {
    const kept: string[] = [];
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return kept;
        const versions = new Set<string>(versionIds);
        try {
            for (const row of await db.scheduleSubscriptions.where('state').equals('Active').toArray()) versions.add(row.templateId);
        } catch {
            // An unreadable store adds nothing: the named versions are still kept.
        }
        for (const id of versions) {
            if (!id || (await readCachedDayCards(id))) continue;
            const loaded = await loadDayCards(id, send).catch(() => null);
            if (loaded?.ok && loaded.source === 'network') kept.push(id);
        }
    } catch {
        // Fire and forget: the viewer says in words that a card is not on the phone yet.
    }
    return kept;
}
