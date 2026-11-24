/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main") - the SERVER WINS on download.
 *
 * The pull carries `ownScheduleItems` and `ownScheduleItemRevisions`: every work of each plot-season's own schedule this person reads (and every save and
 * removal of them), FULL on every pull, only for farms the schedule mechanism is switched on for and only to a phone that asks for the new format. They
 * REPLACE the phone's copy whole (a work removed on the server is a row with state `removed`, never a missing row; a farm switched off sends none and its
 * rows leave). An ABSENT key (an older server, or a pull with no farm switched on) leaves the stores as they are: the screens that read them are hidden
 * then (the switch), and the next pull that carries the key replaces them.
 *
 * A change made on this phone and not yet answered is never touched here: it is in the mutation queue (P10), and `getLocalOwnSchedule` shows it beside
 * these rows with a label. A row that cannot be read is skipped and counted, never stored half. Never throws into the pull.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import {
    ownScheduleItemRowFromDto,
    ownScheduleRevisionRowFromDto,
    type OwnScheduleItemRevisionRow,
    type OwnScheduleItemRow,
} from '../../../../infrastructure/storage/ownScheduleItemRow';

export interface OwnScheduleReconcileOutcome {
    items: number;
    revisions: number;
    skipped: number;
}

/** Applies the two keys when present. Returns what was kept (zeros when the keys were absent). */
export async function reconcileOwnScheduleItems(db: AgriLogDatabase, payload: SyncPullResponse): Promise<OwnScheduleReconcileOutcome> {
    const raw = payload as SyncPullResponse & { ownScheduleItems?: unknown; ownScheduleItemRevisions?: unknown; ownScheduleCarries?: unknown };
    const outcome: OwnScheduleReconcileOutcome = { items: 0, revisions: 0, skipped: 0 };
    try {
        // Slice 11: the season-end answers REPLACE the phone's copy whole, like the works (a disposable server cache in `referenceData`; no new store).
        if (Array.isArray(raw.ownScheduleCarries)) {
            const rows = raw.ownScheduleCarries.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object'
                && typeof (r as Record<string, unknown>).plotId === 'string' && typeof (r as Record<string, unknown>).fromCropCycleId === 'string'
                && typeof (r as Record<string, unknown>).cropCycleId === 'string' && typeof (r as Record<string, unknown>).taskKey === 'string');
            outcome.skipped += raw.ownScheduleCarries.length - rows.length;
            await db.referenceData.put({ key: 'ownScheduleCarries', data: rows, versionHash: String(rows.length), updatedAt: new Date().toISOString() });
        }
        if (Array.isArray(raw.ownScheduleItems)) {
            const rows: OwnScheduleItemRow[] = [];
            for (const dto of raw.ownScheduleItems) {
                const row = ownScheduleItemRowFromDto(dto);
                if (row) rows.push(row);
                else outcome.skipped += 1;
            }
            await db.ownScheduleItems.clear();
            if (rows.length > 0) await db.ownScheduleItems.bulkPut(rows);
            outcome.items = rows.length;
        }
        if (Array.isArray(raw.ownScheduleItemRevisions)) {
            const rows: OwnScheduleItemRevisionRow[] = [];
            for (const dto of raw.ownScheduleItemRevisions) {
                const row = ownScheduleRevisionRowFromDto(dto);
                if (row) rows.push(row);
                else outcome.skipped += 1;
            }
            await db.ownScheduleItemRevisions.clear();
            if (rows.length > 0) await db.ownScheduleItemRevisions.bulkPut(rows);
            outcome.revisions = rows.length;
        }
        if (outcome.skipped > 0) {
            console.warn(JSON.stringify({ component: 'ownScheduleItemsReconciler', action: 'own_schedule_rows_skipped', skipped: outcome.skipped }));
        }
    } catch (error) {
        console.warn(JSON.stringify({
            component: 'ownScheduleItemsReconciler',
            action: 'own_schedule_not_kept_this_pull',
            reason: error instanceof Error ? error.message : String(error),
        }));
    }
    return outcome;
}
