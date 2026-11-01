/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV (founder D-26) — the holder's choice of who sees a record, on THIS phone: queued for the server
 * (`set_record_audience`, offline-safe, P10) and shown at once on his own copy. The server stays the truth: the next pull
 * brings its answer back over this one. Also reads the audience of his money records (kept in the pulled rows' payload)
 * and the people he may choose from.
 */
import { SetRecordAudienceCommand } from '../../application/usecases/sync/SetRecordAudienceCommand';
import type { RecordAudienceName, RecordKindName } from '../../infrastructure/api/recordAudienceDtos';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { systemClock } from '../../core/domain/services/Clock';
import { fetchLabourPermissions } from '../profile/data/labourPermissionsClient';

export const AUDIENCE_CHANGED_EVENT = 'agrisync:record-audience-changed';

export interface AudienceChoice {
    audience: RecordAudienceName;
    /** The people chosen (`Selected` only). */
    people: string[];
}

/** Queue the choice for each record (one recording may hold several plots' logs), then show it on this phone. */
export async function chooseAudience(kind: RecordKindName, recordIds: readonly string[], choice: AudienceChoice): Promise<void> {
    const people = choice.audience === 'Selected' ? [...new Set(choice.people)] : [];
    const changedAtUtc = systemClock.nowISO();
    for (const recordId of recordIds) {
        await SetRecordAudienceCommand.enqueue({ recordKind: kind, recordId, audience: choice.audience, selectedUserIds: people, changedAtUtc });
    }

    const db = getDatabase();
    for (const recordId of recordIds) {
        if (kind === 'DailyLog') {
            const row = await db.logs.get(recordId);
            if (!row?.log) continue;
            const log = { ...row.log } as typeof row.log & { audience?: string; audienceUserIds?: string[] };
            if (choice.audience === 'Team') {
                delete log.audience;
                delete log.audienceUserIds;
            } else {
                log.audience = choice.audience;
                log.audienceUserIds = people;
            }
            await db.logs.update(recordId, { log });
        } else {
            const row = await db.costEntries.get(recordId);
            if (!row) continue;
            const payload = { ...(row.payload as Record<string, unknown>) };
            payload.audience = choice.audience === 'Team' ? null : choice.audience;
            payload.audienceUserIds = choice.audience === 'Team' ? null : people;
            await db.costEntries.put({ ...row, payload: payload as typeof row.payload });
        }
    }

    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUDIENCE_CHANGED_EVENT));
}

/** His money records' audiences, by entry id (only narrowed ones; the server tells only the holder). */
export async function readMoneyAudiences(): Promise<Map<string, { audience: RecordAudienceName; people: string[] }>> {
    const result = new Map<string, { audience: RecordAudienceName; people: string[] }>();
    for (const row of await getDatabase().costEntries.toArray()) {
        const payload = row.payload as { audience?: unknown; audienceUserIds?: unknown } | null;
        if (payload?.audience === 'Selected' || payload?.audience === 'OnlyMe') {
            const people = Array.isArray(payload.audienceUserIds) ? payload.audienceUserIds.filter((x): x is string => typeof x === 'string') : [];
            result.set(row.id, { audience: payload.audience, people });
        }
    }
    return result;
}

export interface ChoosablePerson {
    userId: string;
    name: string;
}

/**
 * The farm's ACTIVE members he may choose (himself left out: he always sees it). The server's roster (owner-only
 * read); `null` = it could not be read now (offline) — the sheet says so instead of an empty list.
 */
export async function loadChoosablePeople(farmId: string, selfUserId: string | null): Promise<ChoosablePerson[] | null> {
    try {
        const roster = await fetchLabourPermissions(farmId);
        return roster
            .filter(m => m.status === 'Active' && m.userId !== selfUserId)
            .map(m => ({ userId: m.userId, name: (m.displayName ?? '').trim() || m.role }));
    } catch (error) {
        // Never silent: the sheet tells him the list did not come, and why is kept in the log.
        console.warn('recordAudience: the member list could not be read', error);
        return null;
    }
}
