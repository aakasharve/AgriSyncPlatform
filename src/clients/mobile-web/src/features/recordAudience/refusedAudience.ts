/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane PRV fix pass 3 (item 6) — the holder's choice shows on his copy at once (accepted as it is), but a
 * choice the SERVER REFUSED never stays on the lock chip. The full pull that follows a refusal cannot put back a record
 * that still has another change of his queued (the pull never overwrites unsent intent), so the phone keeps, per record,
 * what the record's audience was before his first unsent choice, and puts exactly that back the moment the server refuses.
 * Kept in `appMeta` (no Dexie version bump).
 */
import type { RecordAudienceName, RecordKindName } from '../../infrastructure/api/recordAudienceDtos';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';

/** `appMeta` key: per record, its audience before his first unsent choice. */
export const AUDIENCE_BEFORE_META_KEY = 'shramsafal_audience_before_choice_v1'; // gitleaks:allow (a storage name, not a secret)

export const AUDIENCE_CHANGED_EVENT = 'agrisync:record-audience-changed';

interface Before {
    kind: RecordKindName;
    recordId: string;
    /** null = the whole team (no audience on the copy). */
    audience: RecordAudienceName | null;
    people: string[];
}

const keyOf = (kind: string, recordId: string) => `${kind}:${recordId}`;

async function readAll(): Promise<Record<string, Before>> {
    const value = (await getDatabase().appMeta.get(AUDIENCE_BEFORE_META_KEY))?.value;
    return value && typeof value === 'object' ? { ...(value as Record<string, Before>) } : {};
}

async function writeAll(all: Record<string, Before>): Promise<void> {
    await getDatabase().appMeta.put({ key: AUDIENCE_BEFORE_META_KEY, value: all, updatedAt: new Date().toISOString() });
}

/** The audience his copy shows now (null = the team). */
async function currentOf(kind: RecordKindName, recordId: string): Promise<Pick<Before, 'audience' | 'people'> | undefined> {
    const db = getDatabase();
    if (kind === 'DailyLog') {
        const row = await db.logs.get(recordId);
        if (!row?.log) return undefined;
        const log = row.log as { audience?: RecordAudienceName; audienceUserIds?: string[] };
        return { audience: log.audience ?? null, people: [...(log.audienceUserIds ?? [])] };
    }
    const row = await db.costEntries.get(recordId);
    if (!row) return undefined;
    const payload = row.payload as { audience?: RecordAudienceName | null; audienceUserIds?: string[] | null } | null;
    return { audience: payload?.audience ?? null, people: [...(payload?.audienceUserIds ?? [])] };
}

/**
 * Before his choice is queued: remember the record's audience, unless an earlier choice of his for it is still unsent
 * (then the remembered one is already the audience before his first unsent choice).
 */
export async function rememberAudienceBeforeChoice(kind: RecordKindName, recordIds: readonly string[]): Promise<void> {
    const unsent = await getDatabase().mutationQueue.where('status').anyOf(['PENDING', 'SENDING', 'FAILED']).toArray();
    const waiting = new Set(unsent
        .filter(r => r.mutationType === SyncMutationName.SetRecordAudience)
        .map(r => r.payload as { recordKind?: string; recordId?: string })
        .map(p => keyOf(String(p?.recordKind), String(p?.recordId))));
    const all = await readAll();
    for (const recordId of recordIds) {
        const key = keyOf(kind, recordId);
        if (waiting.has(key) && all[key]) continue;
        const now = await currentOf(kind, recordId);
        if (now) all[key] = { kind, recordId, ...now };
    }
    await writeAll(all);
}

/** The server refused his choice for this record: put back what the record showed before it. */
export async function restoreRefusedAudienceChoice(payload: unknown): Promise<boolean> {
    const p = payload as { recordKind?: RecordKindName; recordId?: string } | null;
    if (!p?.recordKind || !p.recordId) return false;
    const all = await readAll();
    const key = keyOf(p.recordKind, p.recordId);
    const before = all[key];
    if (!before) return false;
    const db = getDatabase();
    if (before.kind === 'DailyLog') {
        const row = await db.logs.get(before.recordId);
        if (row?.log) {
            const log = { ...row.log } as typeof row.log & { audience?: string; audienceUserIds?: string[] };
            if (before.audience === null || before.audience === 'Team') {
                delete log.audience;
                delete log.audienceUserIds;
            } else {
                log.audience = before.audience;
                log.audienceUserIds = before.people;
            }
            await db.logs.update(before.recordId, { log });
        }
    } else {
        const row = await db.costEntries.get(before.recordId);
        if (row) {
            const restored = { ...(row.payload as Record<string, unknown>) };
            const team = before.audience === null || before.audience === 'Team';
            restored.audience = team ? null : before.audience;
            restored.audienceUserIds = team ? null : before.people;
            await db.costEntries.put({ ...row, payload: restored as typeof row.payload });
        }
    }

    delete all[key];
    await writeAll(all);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AUDIENCE_CHANGED_EVENT));
    return true;
}
