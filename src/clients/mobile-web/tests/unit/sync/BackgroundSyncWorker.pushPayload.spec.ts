// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: control-room-go-live-must-haves-2026-11-10 (plan CR-1a, Global
 * Constraints, doctrine F5: "Nothing is added to the /sync/push payload").
 *
 * WHAT THE PHONE SENDS TO /sync/push IS EXACTLY WHAT IT SENT BEFORE.
 *
 * The request body has two fields, `deviceId` and `mutations`, and each
 * pushed mutation has four: `clientRequestId`, `clientCommandId`,
 * `mutationType` and `payload`. The server refuses a body it does not
 * recognise, and a phone already in a farmer's hand cannot be changed, so
 * one more field on this request is a change every installed app pays for.
 * These tests fail when any field is added to the body or to a mutation, or
 * when a mutation's payload is no longer the payload that was queued.
 *
 * In particular the facts a queue row keeps for this phone alone (that it
 * failed before and when, how often it was tried, its last error, its farm)
 * stay on the phone, and the app's report of what happened to work that had
 * failed (Task C3) leaves through the telemetry emitter, never through this
 * request.
 *
 * What is real here: the BackgroundSyncWorker, the MutationQueue, Dexie (on
 * fake-indexeddb), the AgriSyncClient, its sync resource and axios with its
 * interceptors. Only the last step is replaced: the axios adapter of the
 * client's own instance, so no socket is opened and the test reads the body
 * as it would have gone onto the wire, after everything that could have
 * touched it. The other spec in this folder replaces `pushSyncBatch` itself
 * and so cannot see what the client and the transport do with the request.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

import { resetDatabase, getDatabase } from '../../../src/infrastructure/storage/DexieDatabase';

const { emitSyncPushOutcomeMock } = vi.hoisted(() => ({
    emitSyncPushOutcomeMock: vi.fn(),
}));

// Signed in. Everything else in the store stays real: the client imports more of it.
vi.mock('../../../src/infrastructure/storage/AuthTokenStore', async () => {
    const actual = await vi.importActual<typeof import('../../../src/infrastructure/storage/AuthTokenStore')>(
        '../../../src/infrastructure/storage/AuthTokenStore');
    return {
        ...actual,
        getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
    };
});
vi.mock('../../../src/features/sync/pull/SyncPullReconciler', () => ({
    reconcileSyncPull: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/infrastructure/sync/PayloadValidator', () => ({
    validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }),
}));
vi.mock('../../../src/infrastructure/sync/AiJobWorker', () => ({
    AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/app/state/RootStore', () => ({
    getRootStore: () => ({ sync: { send: vi.fn() } }),
}));
// The client's failure reporter posts to the server by itself. Nothing here fails, and nothing here may post.
vi.mock('../../../src/infrastructure/telemetry/ClientErrorReporter', () => ({
    reportClientError: vi.fn(),
}));
// The report's way out of the worker: a recording stand-in, so it is seen to leave by this door.
vi.mock('../../../src/core/telemetry/eventEmitters', async () => {
    const actual = await vi.importActual<typeof import('../../../src/core/telemetry/eventEmitters')>(
        '../../../src/core/telemetry/eventEmitters');
    return { ...actual, emitSyncPushOutcome: emitSyncPushOutcomeMock };
});

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../../../src/infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../../src/infrastructure/sync/BackgroundSyncWorker';
import { SyncMutationName } from '../../../src/infrastructure/sync/SyncMutationCatalog';
import { agriSyncClient } from '../../../src/infrastructure/api/AgriSyncClient';

/** The fields of the request body, as they are today. Sorted. */
const BODY_FIELDS = ['deviceId', 'mutations'];

/** The fields of one pushed mutation, as they are today. Sorted. */
const MUTATION_FIELDS = ['clientCommandId', 'clientRequestId', 'mutationType', 'payload'];

type PushedMutation = { clientRequestId: string; clientCommandId: string; mutationType: string; payload: unknown };
type PushBody = { deviceId: string; mutations: PushedMutation[] };

type Verdict =
    | { status: 'applied' }
    | { status: 'failed'; errorCode?: string; errorMessage?: string };

/** The server stored the save. */
const APPLIED: Verdict = { status: 'applied' };

/** A refusal the worker tries again by itself. */
const REFUSED_FOR_NOW: Verdict = { status: 'failed', errorMessage: 'connection reset by peer' };

/** One request as it reached the replaced adapter: after the client, the transport and every interceptor. */
interface WireRequest {
    method: string;
    url: string;
    /** The body exactly as serialised for the wire. */
    raw: string;
    headerNames: string[];
}

const wire: WireRequest[] = [];
let verdictFor: (clientRequestId: string) => Verdict = () => APPLIED;

const START_MS = Date.parse('2026-11-14T06:30:00.000Z');

/** Longer than the queue's longest backoff (60 s), so a failed save is due again. */
const PAST_ANY_BACKOFF_MS = 61 * 1000;

let nowMs = START_MS;

function setClock(ms: number) {
    nowMs = ms;
    vi.setSystemTime(ms);
}

const EMPTY_PULL = {
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [],
    financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
};

/** Stands where the network is. It answers the push as `verdictFor` says and every pull with nothing new. */
const recordingAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    const method = (config.method ?? '').toLowerCase();
    const raw = typeof config.data === 'string' ? config.data : '';
    wire.push({
        method,
        url,
        raw,
        headerNames: Object.keys(config.headers.toJSON()).map(name => name.toLowerCase()).sort(),
    });

    const serverTimeUtc = new Date(nowMs).toISOString();
    const data = url === '/sync/push'
        ? {
            serverTimeUtc,
            results: (JSON.parse(raw) as PushBody).mutations.map(m => ({
                clientRequestId: m.clientRequestId,
                mutationType: m.mutationType,
                ...verdictFor(m.clientRequestId),
            })),
        }
        : { serverTimeUtc, nextCursorUtc: serverTimeUtc, ...EMPTY_PULL };

    return { data, status: 200, statusText: 'OK', headers: {}, config };
};

agriSyncClient.http.defaults.adapter = recordingAdapter;

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run: nothing to delete
    }
    await resetDatabase();
}

async function rowFor(clientRequestId: string) {
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), clientRequestId])
        .first();
    expect(row, `queue row ${clientRequestId}`).toBeDefined();
    return row!;
}

/** The bodies sent to POST /sync/push since the recorder was last cleared, parsed, in order. */
function pushes(): Array<{ body: PushBody; raw: string; headerNames: string[] }> {
    return wire
        .filter(request => request.url === '/sync/push')
        .map(request => {
            expect(request.method, 'the push is a POST').toBe('post');
            return { body: JSON.parse(request.raw) as PushBody, raw: request.raw, headerNames: request.headerNames };
        });
}

/** Exactly one push went out; returns it. */
function theOnePush() {
    const sent = pushes();
    expect(sent, 'one cycle with work in it sends one request to /sync/push').toHaveLength(1);
    return sent[0];
}

function expectExactlyTodaysFields(body: PushBody) {
    expect(Object.keys(body).sort(),
        'the top-level fields of the /sync/push body: a field added here is sent by every phone and '
        + 'must be accepted by every server (doctrine F5)')
        .toEqual(BODY_FIELDS);

    expect(Array.isArray(body.mutations)).toBe(true);
    for (const mutation of body.mutations) {
        expect(Object.keys(mutation).sort(),
            `the fields of pushed mutation ${mutation.clientRequestId}: nothing a queue row keeps for this `
            + 'phone alone goes with it')
            .toEqual(MUTATION_FIELDS);
    }
}

describe('BackgroundSyncWorker — what is sent to /sync/push stays exactly what it was (plan CR-1a, doctrine F5)', () => {
    beforeEach(async () => {
        setClock(START_MS);
        await freshDb();
        wire.length = 0;
        verdictFor = () => APPLIED;
        emitSyncPushOutcomeMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('sends a body of exactly deviceId and mutations, and each mutation is exactly four fields', async () => {
        const logPayload = {
            dailyLogId: '11111111-1111-4111-8111-111111111111',
            farmId: '22222222-2222-4222-8222-222222222222',
            note: 'as the farmer said it',
            tasks: [{ activityType: 'spray', hours: 2 }, { activityType: 'irrigation', hours: 0.5 }],
        };
        const taskPayload = {
            dailyLogId: '11111111-1111-4111-8111-111111111111',
            logTaskId: '55555555-5555-4555-8555-555555555555',
            activityType: 'spray',
        };

        // A save queued the ordinary way, with a command id of its own.
        const first = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, logPayload, {
            clientRequestId: 'create_daily_log:11111111-1111-4111-8111-111111111111',
            clientCommandId: 'command-of-the-first-save',
        });
        // And a row as an older version of the app left it in the queue: no command id at all.
        const second = 'add_log_task:left-by-an-older-version';
        await getDatabase().mutationQueue.add({
            deviceId: mutationQueue.getDeviceId(),
            clientRequestId: second,
            mutationType: SyncMutationName.AddLogTask,
            payload: taskPayload,
            status: 'PENDING',
            createdAt: new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(),
            retryCount: 0,
        });

        await backgroundSyncWorker.triggerNow();

        const { body } = theOnePush();
        expectExactlyTodaysFields(body);

        // And the values are the queue's own: nothing renamed, nothing wrapped, nothing added
        // inside a payload. A row with no command id is sent with its request id in that place.
        expect(body).toStrictEqual({
            deviceId: mutationQueue.getDeviceId(),
            mutations: [
                {
                    clientRequestId: first,
                    clientCommandId: 'command-of-the-first-save',
                    mutationType: 'create_daily_log',
                    payload: logPayload,
                },
                {
                    clientRequestId: second,
                    clientCommandId: second,
                    mutationType: 'add_log_task',
                    payload: taskPayload,
                },
            ],
        });

        // The stand-in for the network is a faithful one: its answer was read and both saves arrived.
        expect((await rowFor(first)).status).toBe('APPLIED');
        expect((await rowFor(second)).status).toBe('APPLIED');
    });

    it('sends nothing more for a save that had failed before, and its report leaves by another door', async () => {
        const payload = {
            dailyLogId: '33333333-3333-4333-8333-333333333333',
            farmId: '22222222-2222-4222-8222-222222222222',
            note: 'saved while the server was refusing',
        };
        const id = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, payload);

        // First attempt: the server refuses it for now.
        verdictFor = () => REFUSED_FOR_NOW;
        await backgroundSyncWorker.triggerNow();
        const firstSend = theOnePush();
        const failedAtIso = new Date(nowMs).toISOString();

        // The row now carries what this phone knows about it and the server was never told.
        const failed = await rowFor(id);
        expect(failed.status).toBe('FAILED');
        expect(failed.firstFailedAt).toBe(failedAtIso);
        expect(failed.lastError).toBe('connection reset by peer');
        expect(failed.retryCount).toBe(1);
        expect(failed.attemptCount).toBe(1);
        expect(failed.nextRetryAfterMs).toBeGreaterThan(nowMs);
        expect(emitSyncPushOutcomeMock).not.toHaveBeenCalled();

        // It comes due and is sent again, and this time it arrives.
        setClock(nowMs + PAST_ANY_BACKOFF_MS);
        wire.length = 0;
        verdictFor = () => APPLIED;
        await backgroundSyncWorker.triggerNow();

        const secondSend = theOnePush();
        expectExactlyTodaysFields(secondSend.body);
        expect(secondSend.body).toStrictEqual({
            deviceId: mutationQueue.getDeviceId(),
            mutations: [{ clientRequestId: id, clientCommandId: id, mutationType: 'create_daily_log', payload }],
        });

        // The same save, sent twice, is the same request: that is what lets the server know it.
        expect(secondSend.body).toStrictEqual(firstSend.body);

        // It did recover, and that was reported: once, through the telemetry emitter. So the
        // request above was the request of a cycle that HAD a report to make, and carried none of it.
        expect((await rowFor(id)).status).toBe('APPLIED');
        expect(emitSyncPushOutcomeMock).toHaveBeenCalledTimes(1);
        const report = emitSyncPushOutcomeMock.mock.calls[0][0] as Record<string, unknown>;
        expect(report).toMatchObject({ recoveredCount: 1, needsReviewCount: 0, firstFailedAtUtc: failedAtIso });

        for (const reported of [...Object.keys(report), 'firstFailedAt', 'retryCount', 'attemptCount', 'lastError']) {
            expect(secondSend.raw, `"${reported}" belongs to the phone or to the report, never to the push request`)
                .not.toContain(`"${reported}"`);
        }
    });

    it('carries the request headers it carried before and no other', async () => {
        // The same constraint, second half: "No new request header is added (the CORS header
        // allow-list in Program.cs is not touched)". A header outside that list fails the web
        // app's preflight, so every request from a browser would be refused before it is read.
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { dailyLogId: '44444444-4444-4444-8444-444444444444' });

        await backgroundSyncWorker.triggerNow();

        // `accept` is left out: a browser may always send it. This runs as the web app; on
        // Android the client also sends X-Client-Platform, which the list allows.
        const { headerNames } = theOnePush();
        expect(headerNames.filter(name => name !== 'accept'),
            'the headers of POST /sync/push: each of these is in the server\'s CORS allow-list today')
            .toEqual(['authorization', 'content-type', 'x-app-version', 'x-device-id']);
    });
});
