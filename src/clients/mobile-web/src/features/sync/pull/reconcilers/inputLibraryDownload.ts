/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 4; founder D-107 B "on the server from go-live").
 *
 * The phone's copy of the product library the server publishes (`GET /shramsafal/reference/input-library`). It is a
 * DEDICATED step, beside `referenceDataReconciler`, and not part of the sync pull's Dexie transaction: the library is global
 * and large, so it never inflates a farm's pull, and it runs AFTER the pull, never inside it.
 *
 *   - `adoptStoredInputLibrary(db)`, at app start: the stored copy (Dexie `inputLibrary`, one row) becomes the library
 *     `loadLibrary()` serves. With no row, the bundled `catalog.json` seed stays, so matching never breaks offline.
 *   - `syncInputLibrary(db)`, on app start and after each pull: asks the server with the stored version in `If-None-Match`.
 *       200 -> the copy is checked, its indexes are built, THEN it is stored and adopted ('updated');
 *       304 -> nothing changes ('not-modified');
 *       no network, a refusal or a server error -> nothing changes, the old copy keeps serving ('unavailable');
 *       a body that is not a usable library -> nothing changes ('rejected');
 *       a body that passes the checks but cannot be taken into use -> nothing changes ('kept-old-copy');
 *       asked too recently (the after-a-pull call only) -> no request is made ('skipped').
 *
 * THE ORDER IS THE POINT (fix pass 1, B002): validate, then build the indexes in a try/catch, and only THEN write Dexie and
 * adopt. A copy the phone cannot use never reaches Dexie, so it can never replace a good stored copy, and the phone is never
 * left asking the server for 304s on a version it cannot read. The whole step never throws: any failure keeps the old copy.
 *
 * The server only ever serves PUBLISHED rows; a draft source is never in what arrives here.
 */

import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import {
    adoptPreparedLibrary,
    prepareStoredLibrary,
    setStoredLibrary,
    validateLibrary,
    type CatalogFile,
    type PreparedLibrary,
} from '../../../../domain/inputs/inputCatalog';

/** The library route (a GET under the ShramSafal reference group). */
export const INPUT_LIBRARY_PATH = '/shramsafal/reference/input-library';

/** The one row of the Dexie `inputLibrary` store. */
export const INPUT_LIBRARY_ROW_ID = 'current';

export interface InputLibraryRow {
    id: typeof INPUT_LIBRARY_ROW_ID;
    /** The version the copy was served under (`inputs-2.<n>`), sent back as `If-None-Match`. */
    version: string;
    library: CatalogFile;
    updatedAtUtc: string;
}

export type InputLibrarySyncOutcome = 'updated' | 'not-modified' | 'unavailable' | 'rejected' | 'kept-old-copy' | 'skipped';

/**
 * The after-a-pull call asks the server at most this often. A pull runs every 15 seconds; the library changes when a person
 * publishes a source, so a conditional request per pull would be hundreds of needless requests an hour per phone. The start
 * call is never throttled, so a newly opened app always asks at once.
 */
export const INPUT_LIBRARY_POLL_MS = 10 * 60 * 1000;

let lastAskedAtMs = Number.NEGATIVE_INFINITY;

/** Forgets when the server was last asked (tests, and a change of person on the device). */
export function resetInputLibraryThrottle(): void {
    lastAskedAtMs = Number.NEGATIVE_INFINITY;
}

/** The request function; the default is `apiFetch` (the access token, one refresh on 401). Injected in tests. */
export type InputLibraryFetch = (path: string, init: RequestInit) => Promise<Response>;

export interface InputLibrarySyncDeps {
    fetch?: InputLibraryFetch;
    now?: () => string;
    /** Builds a downloaded library for use; the default is `prepareStoredLibrary`. Injected in tests to prove the safety net. */
    prepare?: (file: unknown) => PreparedLibrary | null;
    /** Do not ask the server if it was asked less than this many milliseconds ago (default 0: always ask). */
    minIntervalMs?: number;
    /** The clock for the throttle, in milliseconds (default `Date.now`). */
    nowMs?: () => number;
}

function table(db: AgriLogDatabase) {
    return db.table<InputLibraryRow, string>('inputLibrary');
}

/** Reads the stored copy and makes it the library in use. True when a usable stored copy was adopted. Never throws. */
export async function adoptStoredInputLibrary(db: AgriLogDatabase): Promise<boolean> {
    try {
        const row = await table(db).get(INPUT_LIBRARY_ROW_ID);
        if (!row) return false;
        return setStoredLibrary(row.library);
    } catch {
        return false;
    }
}

/** Asks the server for the library by version; stores and adopts a newer copy. Never throws: every failure keeps the copy in use. */
export async function syncInputLibrary(db: AgriLogDatabase, deps: InputLibrarySyncDeps = {}): Promise<InputLibrarySyncOutcome> {
    return (await syncDetailed(db, deps)).outcome;
}

/** The outcome, and whether the request itself never got an answer (the fetch threw): only that frees the throttle. */
interface DetailedOutcome {
    outcome: InputLibrarySyncOutcome;
    networkFailed: boolean;
}

async function syncDetailed(db: AgriLogDatabase, deps: InputLibrarySyncDeps): Promise<DetailedOutcome> {
    try {
        return await download(db, deps);
    } catch {
        return { outcome: 'unavailable', networkFailed: false };
    }
}

async function download(db: AgriLogDatabase, deps: InputLibrarySyncDeps): Promise<DetailedOutcome> {
    const done = (outcome: InputLibrarySyncOutcome, networkFailed = false): DetailedOutcome => ({ outcome, networkFailed });
    const doFetch: InputLibraryFetch = deps.fetch ?? (async (path, init) => (await import('../../../../infrastructure/api/apiFetch')).apiFetch(path, init));
    const prepare = deps.prepare ?? prepareStoredLibrary;
    const now = deps.now ?? (() => new Date().toISOString());

    let stored: InputLibraryRow | undefined;
    try {
        stored = await table(db).get(INPUT_LIBRARY_ROW_ID);
    } catch {
        stored = undefined;
    }

    // Only a stored copy the phone can actually use names a version to the server. A row it cannot use (written by an older
    // build, say) must not earn a 304: that would leave the phone on the bundled seed for good.
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (stored?.version && validateLibrary(stored.library) === null) headers['If-None-Match'] = `"${stored.version}"`;

    let response: Response;
    try {
        response = await doFetch(INPUT_LIBRARY_PATH, { method: 'GET', headers });
    } catch {
        // No answer at all (offline, a dropped connection): the one failure that says nothing about the server.
        return done('unavailable', true);
    }

    if (response.status === 304) return done('not-modified');
    // An ANSWER that is an error (404, 500): the server was reached and said no, so the phone must not ask again at every pull.
    if (!response.ok) return done('unavailable');

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return done('rejected');
    }

    // 1. validate (every element the code reads), 2. build the indexes in a try/catch, 3. only then write Dexie, 4. adopt.
    if (validateLibrary(body) !== null) return done('rejected');
    let prepared: PreparedLibrary | null = null;
    try {
        prepared = prepare(body);
    } catch {
        prepared = null;
    }
    if (!prepared) return done('kept-old-copy');

    const library = body as CatalogFile;
    try {
        await table(db).put({ id: INPUT_LIBRARY_ROW_ID, version: library.version, library, updatedAtUtc: now() });
    } catch {
        return done('unavailable');
    }
    adoptPreparedLibrary(prepared);
    return done('updated');
}

/**
 * App start / after a pull: adopt what is stored first (so matching uses it at once), then ask the server. Never throws.
 * With `minIntervalMs`, a call that follows an earlier ask too closely makes no request and answers 'skipped'.
 */
export async function runInputLibraryStep(db: AgriLogDatabase, deps: InputLibrarySyncDeps = {}): Promise<InputLibrarySyncOutcome> {
    try {
        const nowMs = (deps.nowMs ?? Date.now)();
        const sinceLastAsk = nowMs - lastAskedAtMs;
        // A clock that moved BACKWARD (a negative gap) means the interval has not been measured: ask, never wait on a bad clock.
        if ((deps.minIntervalMs ?? 0) > 0 && sinceLastAsk >= 0 && sinceLastAsk < (deps.minIntervalMs ?? 0)) return 'skipped';
        const previous = lastAskedAtMs;
        lastAskedAtMs = nowMs;
        await adoptStoredInputLibrary(db);
        const { outcome, networkFailed } = await syncDetailed(db, deps);
        // Only a request that got NO answer frees the throttle: the next chance asks again. An error answer (404, 500) keeps the
        // interval, so a route that keeps failing is not hit at every 15-second pull.
        if (networkFailed) lastAskedAtMs = previous;
        return outcome;
    } catch {
        return 'unavailable';
    }
}
