/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOWNLOADED LABOUR CACHE - the 7-day limit in every IndexedDB store that can feed
 * a screen with worker names or attendance (founder decision 2026-10-12, round 2).
 *
 * Two kinds of data live in the same stores and are treated OPPOSITELY:
 *
 *   DOWNLOADED cache - server-derived copies (acknowledged attendance rows, worker
 *   names inside pulled logs, the pulled team list, the raw last-pull snapshot).
 *   Older than 7 days, unstamped (age unknown) or future-dated => it must not feed
 *   a screen (gated ON READ) and is deleted (boot SWEEP). At logout / session end
 *   the ending user's downloaded cache is purged outright, whatever its age.
 *
 *   UNSENT work - the mutation queue, logs with an unresolved mutation, people added
 *   on this device. NEVER deleted or hidden by anything in this file. Privacy for
 *   unsent work comes from the per-user database (userDatabaseName.ts): another
 *   user's database handle cannot reach these rows, and the queue is replayed only
 *   from the ACTIVE user's database.
 *
 * What is NOT touched, on purpose: a log's counts, wages, notes and dates (the
 * farmer's own record, not a cache); only the NAMES inside its labour events go.
 *
 * Store-by-store inventory: see LABOUR_CACHE_7DAY.md (release-1.0.13 evidence).
 */
import Dexie from 'dexie';
import { AgriLogDatabase, getDatabase } from './DexieDatabase';
import type { DexieLogRecord } from './DexieDatabase';
import { LABOUR_READOUT_MAX_AGE_MS } from './LabourReadoutCache';
import { readActiveUserId } from './activeUserId';
import { systemClock } from '../../core/domain/services/Clock';
import { LEGACY_DATABASE_NAME, UNIDENTIFIED_DATABASE_NAME, PER_USER_DATABASE_PREFIX } from './userDatabaseName';
import type { DailyLog, FarmOperator, FarmerProfile } from '../../types';

/** One cap for every Labour cache (read-out, roster and the Dexie stores below). */
export const DOWNLOADED_LABOUR_MAX_AGE_MS = LABOUR_READOUT_MAX_AGE_MS;

const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
export const LAST_PULL_SNAPSHOT_KEY = 'shramsafal_last_pull_payload';

/** True only for a parseable stamp that is at most 7 days old (and not far in the future). */
export function isDownloadFresh(stamp: string | null | undefined, now: number = systemClock.nowEpoch()): boolean {
    if (typeof stamp !== 'string') return false;
    const at = Date.parse(stamp);
    if (Number.isNaN(at)) return false;
    return now - at <= DOWNLOADED_LABOUR_MAX_AGE_MS && at - now <= FUTURE_SLACK_MS;
}

// ---------------------------------------------------------------------------
// logs: worker names inside labour events
// ---------------------------------------------------------------------------

function hasLabourNames(log: DailyLog): boolean {
    return (log.labour ?? []).some((e) => e.attributedOperators !== undefined || e.workerNames !== undefined);
}

/** The log without the downloaded names in its labour events. Same object if there were none. */
export function stripLabourNames(log: DailyLog): DailyLog {
    if (!hasLabourNames(log)) return log;
    return {
        ...log,
        labour: (log.labour ?? []).map((e) => {
            if (e.attributedOperators === undefined && e.workerNames === undefined) return e;
            const { attributedOperators: _a, workerNames: _w, ...rest } = e;
            void _a; void _w;
            return rest;
        }),
    };
}

const UNRESOLVED_INTENT = ['PENDING', 'SENDING', 'FAILED', 'REJECTED_USER_REVIEW'] as const;

/** Ids of logs this device still owes the server something about (unsent work). */
export async function readUnsentLogIds(db: AgriLogDatabase): Promise<Set<string>> {
    const ids = new Set<string>();
    const rows = await db.mutationQueue.where('status').anyOf([...UNRESOLVED_INTENT]).toArray();
    for (const row of rows) {
        const p = row.payload as { dailyLogId?: string; logId?: string } | null | undefined;
        if (!p || typeof p !== 'object') continue;
        if (p.dailyLogId) ids.add(p.dailyLogId);
        if (p.logId) ids.add(p.logId);
    }
    return ids;
}

/**
 * ON READ: the logs a screen may see. A record's names are shown only if it has
 * unsent work (the user's own, in their own database) or its download stamp is fresh.
 */
export async function logsForDisplay(db: AgriLogDatabase, records: readonly DexieLogRecord[]): Promise<DailyLog[]> {
    if (!records.some((r) => hasLabourNames(r.log))) return records.map((r) => r.log);
    let unsent: Set<string>;
    try {
        unsent = await readUnsentLogIds(db);
    } catch {
        unsent = new Set(records.map((r) => r.id)); // unreadable queue: fail OPEN for the user's own unsent work
    }
    const now = systemClock.nowEpoch();
    return records.map((r) =>
        unsent.has(r.id) || isDownloadFresh(r.labourNamesDownloadedAtUtc, now) ? r.log : stripLabourNames(r.log));
}

// ---------------------------------------------------------------------------
// farmerProfile: team operators pulled from the server
// ---------------------------------------------------------------------------

/**
 * Operators a screen may see: freshly downloaded ones, ones added on this device
 * (localOnly, or the `op_` ids the legacy add-person path minted), and the signed-in
 * user's own entry (their own identity is not a cache of someone else's).
 */
export function operatorsForDisplay(operators: readonly FarmOperator[] | undefined, now: number = systemClock.nowEpoch()): FarmOperator[] {
    const own = readActiveUserId();
    return (operators ?? []).filter((o) =>
        o.localOnly === true
        || (!o.downloadedAtUtc && typeof o.id === 'string' && o.id.startsWith('op_'))
        || (own !== null && o.id === own)
        || isDownloadFresh(o.downloadedAtUtc, now));
}

export function profileForDisplay(profile: FarmerProfile): FarmerProfile {
    if (!Array.isArray(profile?.operators)) return profile;
    const kept = operatorsForDisplay(profile.operators);
    return kept.length === profile.operators.length ? profile : { ...profile, operators: kept };
}

// ---------------------------------------------------------------------------
// sweeps
// ---------------------------------------------------------------------------

async function sweep(db: AgriLogDatabase, mode: 'age' | 'all', now: number): Promise<void> {
    const keepAttendance = (updatedAt: string | undefined) => mode === 'age' && isDownloadFresh(updatedAt, now);

    // 1. acknowledged attendance rows
    const staleMarkIds: string[] = [];
    await db.attendanceMarks.each((m) => { if (!keepAttendance(m.updatedAt)) staleMarkIds.push(m.id); });
    if (staleMarkIds.length) await db.attendanceMarks.bulkDelete(staleMarkIds);

    // 2. worker names inside logs (never the logs themselves; never an unsent log)
    const unsent = await readUnsentLogIds(db);
    const toRewrite: DexieLogRecord[] = [];
    await db.logs.each((r) => {
        if (!hasLabourNames(r.log) || unsent.has(r.id)) return;
        if (mode === 'age' && isDownloadFresh(r.labourNamesDownloadedAtUtc, now)) return;
        const { labourNamesDownloadedAtUtc: _s, ...rest } = r;
        void _s;
        toRewrite.push({ ...rest, log: stripLabourNames(r.log) });
    });
    if (toRewrite.length) await db.logs.bulkPut(toRewrite);

    // 3. the pulled team list inside the profile row
    const row = await db.farmerProfile.get('self');
    const profile = row?.data as FarmerProfile | undefined;
    if (row && profile && Array.isArray(profile.operators) && profile.operators.length > 0) {
        const own = readActiveUserId();
        const kept = profile.operators.filter((o) =>
            o.localOnly === true
            || (!o.downloadedAtUtc && typeof o.id === 'string' && o.id.startsWith('op_'))
            || (own !== null && o.id === own)
            || (mode === 'age' && isDownloadFresh(o.downloadedAtUtc, now)));
        if (kept.length !== profile.operators.length) {
            await db.farmerProfile.put({ ...row, data: { ...profile, operators: kept } });
        }
    }

    // 4. the raw last-pull snapshot (carries operators, logs and marks verbatim)
    const snap = await db.appMeta.get(LAST_PULL_SNAPSHOT_KEY);
    if (snap && !(mode === 'age' && isDownloadFresh(snap.updatedAt, now))) {
        await db.appMeta.delete(LAST_PULL_SNAPSHOT_KEY);
    }
}

/** BOOT SWEEP: delete downloaded Labour cache older than 7 days (or of unknown age). */
export async function sweepExpiredDownloadedLabour(db: AgriLogDatabase = getDatabase(), now: number = systemClock.nowEpoch()): Promise<void> {
    await sweep(db, 'age', now);
}

/** SESSION END: delete the ending user's downloaded Labour cache whatever its age. Unsent work stays. */
export async function purgeDownloadedLabourNow(db: AgriLogDatabase): Promise<void> {
    await sweep(db, 'all', systemClock.nowEpoch());
}

const inFlight = new Set<Promise<void>>();

/** Resolves when every purge started by `purgeDownloadedLabourForDatabase` has finished (tests, shutdown). */
export async function settleDownloadedLabourPurges(): Promise<void> {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/**
 * Fire-and-forget purge of one database by NAME (the ending user's, captured before
 * routing moved away from it). Best-effort: a failure leaves the age sweep to catch it.
 */
export function purgeDownloadedLabourForDatabase(databaseName: string): void {
    const p = (async () => {
        let db: AgriLogDatabase | null = null;
        try {
            // NOT Dexie.exists(): that probe CREATES a missing database and then deletes it,
            // racing with whoever is opening it. getDatabaseNames() only lists.
            if (!(await Dexie.getDatabaseNames()).includes(databaseName)) return;
            db = new AgriLogDatabase(databaseName);
            await purgeDownloadedLabourNow(db);
        } catch (err) {
            console.warn('[downloadedLabourCache] session-end purge failed', databaseName, err);
        } finally {
            try { db?.close(); } catch { /* ignore */ }
        }
    })().finally(() => { inFlight.delete(p); });
    inFlight.add(p);
}

/**
 * BOOT, every local database: apply the age sweep to every AgriLogDB* database on
 * this handset except the active one (which the caller sweeps), and purge the
 * unidentified boundary database's downloaded cache outright (it belongs to nobody). This is what
 * removes the previous user's pre-existing residue (browser proof F3). Unsent queues
 * are untouched. Best-effort.
 */
export async function sweepOtherLocalDatabases(activeName: string, now: number = systemClock.nowEpoch()): Promise<void> {
    let names: string[] = [];
    try { names = await Dexie.getDatabaseNames(); } catch { return; }
    for (const name of names) {
        const ours = name === LEGACY_DATABASE_NAME || name === UNIDENTIFIED_DATABASE_NAME || name.startsWith(PER_USER_DATABASE_PREFIX);
        // The unidentified boundary belongs to nobody: purged even while it is the active name.
        if (!ours || (name === activeName && name !== UNIDENTIFIED_DATABASE_NAME)) continue;
        let db: AgriLogDatabase | null = null;
        try {
            db = new AgriLogDatabase(name);
            if (name === UNIDENTIFIED_DATABASE_NAME) await purgeDownloadedLabourNow(db);
            else await sweep(db, 'age', now);
        } catch (err) {
            console.warn('[downloadedLabourCache] boot sweep failed', name, err);
        } finally {
            try { db?.close(); } catch { /* ignore */ }
        }
    }
}
