/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — findings R3 + R12.
 *
 * The chip decides what to SAY (`deriveSyncHonestyState`). The drawer decides
 * what to SHOW (`needsFarmerAction`). Those are two separately written pieces
 * of logic, and when they disagreed the farmer got "1 Failed" above an empty
 * list, or a red badge beside an amber "saved on phone".
 *
 * This file is the oracle that holds them together. The two implementations
 * stay independent on purpose — a shared helper would make them agree by
 * definition and prove nothing — so agreement is asserted over the entire
 * status x retryCount cross-product instead.
 */
import { describe, it, expect } from 'vitest';

import type { MutationQueueItem, MutationQueueStatus } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import {
    EMPTY_SYNC_EVIDENCE,
    MAX_AUTO_RETRY_COUNT,
    deriveSyncHonestyState,
    type SyncEvidenceSnapshot,
} from '../syncHonestyState';
import {
    OPEN_FAILURE_STATUSES,
    needsFarmerAction,
    partitionOpenFailures,
    toStuckMutationView,
} from '../stuckMutations';

const ALL_STATUSES: MutationQueueStatus[] = [
    'PENDING', 'SENDING', 'APPLIED', 'FAILED', 'REJECTED_USER_REVIEW', 'REJECTED_DROPPED',
];

const RETRY_COUNTS = [0, 1, MAX_AUTO_RETRY_COUNT - 1, MAX_AUTO_RETRY_COUNT, MAX_AUTO_RETRY_COUNT + 4];

function queueRow(status: MutationQueueStatus, retryCount = 0, id = 1): MutationQueueItem {
    return {
        id,
        deviceId: 'test-device',
        clientRequestId: `req-${status}-${retryCount}-${id}`,
        clientCommandId: 'cmd-1',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status,
        createdAt: '2026-08-12T09:00:00.000Z',
        updatedAt: '2026-08-12T09:00:00.000Z',
        retryCount,
        lastError: status === 'FAILED' ? 'Request failed with status code 400' : undefined,
    };
}

/** A device that HAS had something acknowledged, so `null` never masks a claim. */
function settled(overrides: Partial<SyncEvidenceSnapshot> = {}): SyncEvidenceSnapshot {
    return { ...EMPTY_SYNC_EVIDENCE, acknowledgedCount: 1, ...overrides };
}

describe('the drawer shows exactly what the chip is complaining about', () => {
    for (const status of ALL_STATUSES) {
        for (const retryCount of RETRY_COUNTS) {
            it(`${status} @ retryCount=${retryCount}: "needs the farmer" matches the NEEDS_FIX claim`, () => {
                const row = queueRow(status, retryCount);
                const claim = deriveSyncHonestyState(settled({
                    rows: [{ status: row.status, retryCount: row.retryCount }],
                }));

                expect(needsFarmerAction(row)).toBe(claim === 'NEEDS_FIX');
            });
        }
    }

    it('every status that can need the farmer is one the drawer actually reads', () => {
        // The R3 trap in its general form: a status classified as actionable
        // but missing from the Dexie filter is counted, never fetched, and
        // therefore never listed.
        for (const status of ALL_STATUSES) {
            for (const retryCount of RETRY_COUNTS) {
                if (needsFarmerAction(queueRow(status, retryCount))) {
                    expect(OPEN_FAILURE_STATUSES).toContain(status);
                }
            }
        }
    });

    it('does not read statuses it can never act on', () => {
        expect(OPEN_FAILURE_STATUSES).not.toContain('APPLIED');
        expect(OPEN_FAILURE_STATUSES).not.toContain('PENDING');
        expect(OPEN_FAILURE_STATUSES).not.toContain('SENDING');
        expect(OPEN_FAILURE_STATUSES).not.toContain('REJECTED_DROPPED');
    });
});

describe('a row below the cap is in progress, not stuck (R12)', () => {
    it('is not counted as needing the farmer', () => {
        expect(needsFarmerAction(queueRow('FAILED', MAX_AUTO_RETRY_COUNT - 1))).toBe(false);
    });

    it('and the chip agrees — this is the amber-label-beside-a-red-badge case', () => {
        const claim = deriveSyncHonestyState(settled({
            rows: [{ status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT - 1 }],
        }));
        expect(claim).toBe('ON_PHONE');
    });

    it('becomes stuck at the cap, in step with the chip', () => {
        expect(needsFarmerAction(queueRow('FAILED', MAX_AUTO_RETRY_COUNT))).toBe(true);
        expect(deriveSyncHonestyState(settled({
            rows: [{ status: 'FAILED', retryCount: MAX_AUTO_RETRY_COUNT }],
        }))).toBe('NEEDS_FIX');
    });

    it('a durable rejection needs the farmer at any retryCount, including zero', () => {
        expect(needsFarmerAction(queueRow('REJECTED_USER_REVIEW', 0))).toBe(true);
    });
});

describe('partitionOpenFailures — one array, so the count and the list cannot drift', () => {
    it('separates the stuck from the still-retrying', () => {
        const rows = [
            queueRow('FAILED', 1, 1),
            queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 2),
            queueRow('REJECTED_USER_REVIEW', 1, 3),
            queueRow('FAILED', 0, 4),
        ];

        const { stuck, stillRetrying } = partitionOpenFailures(rows);

        expect(stuck.map(s => s.id)).toEqual([2, 3]);
        expect(stillRetrying).toBe(2);
    });

    it('the count IS the length of the list — the "1 Failed above an empty list" defect', () => {
        const rows = [queueRow('REJECTED_USER_REVIEW', 1, 7)];

        const { stuck } = partitionOpenFailures(rows);

        expect(stuck).toHaveLength(1);
        expect(stuck[0].clientRequestId).toBe(rows[0].clientRequestId);
    });

    it('is ordered oldest first so the list does not reshuffle every three seconds', () => {
        const rows = [
            queueRow('REJECTED_USER_REVIEW', 1, 9),
            queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 2),
            queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 5),
        ];

        expect(partitionOpenFailures(rows).stuck.map(s => s.id)).toEqual([2, 5, 9]);
    });

    it('says which remedy actually works for each row', () => {
        expect(toStuckMutationView(queueRow('FAILED', MAX_AUTO_RETRY_COUNT)).remedy).toBe('RETRY');
        expect(toStuckMutationView(queueRow('REJECTED_USER_REVIEW', 1)).remedy).toBe('NEEDS_REVIEW');
    });

    it('carries the server error through — a row with no explanation is a dead end', () => {
        const view = toStuckMutationView(queueRow('FAILED', MAX_AUTO_RETRY_COUNT));
        expect(view.lastError).toBe('Request failed with status code 400');
        expect(view.mutationType).toBe(SyncMutationName.CreateDailyLog);
    });

    it('does not carry the payload into a three-second poll', () => {
        expect(toStuckMutationView(queueRow('FAILED', MAX_AUTO_RETRY_COUNT))).not.toHaveProperty('payload');
    });

    it('an empty queue produces an empty list, not an absent one', () => {
        expect(partitionOpenFailures([])).toEqual({ stuck: [], stillRetrying: 0 });
    });
});

describe('THE ACCEPTANCE CRITERION: "stuck" and "here is what is stuck" are the same condition', () => {
    // The chip says `अडकलं — तपासा` exactly when `deriveSyncHonestyState`
    // returns NEEDS_FIX. The drawer opens its Failed section exactly when
    // `failedCount + failedUploads > 0` (`SyncStatusDrawer.tsx:117,171`).
    // If those two ever come apart, the farmer is told to go check something
    // the check cannot show them.
    const shapes: Array<{ name: string; rows: MutationQueueItem[]; failedUploads: number; pendingUploads?: number; pendingAiJobs?: number }> = [
        { name: 'nothing at all', rows: [], failedUploads: 0 },
        { name: 'one pending mutation', rows: [queueRow('PENDING', 0, 1)], failedUploads: 0 },
        { name: 'one sub-cap failure', rows: [queueRow('FAILED', 1, 1)], failedUploads: 0 },
        { name: 'one capped failure', rows: [queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 1)], failedUploads: 0 },
        { name: 'one durable rejection', rows: [queueRow('REJECTED_USER_REVIEW', 1, 1)], failedUploads: 0 },
        { name: 'one discarded row', rows: [queueRow('REJECTED_DROPPED', 1, 1)], failedUploads: 0 },
        { name: 'only a failed upload', rows: [], failedUploads: 2 },
        { name: 'a failed upload beside healthy mutations', rows: [queueRow('PENDING', 0, 1)], failedUploads: 1 },
        { name: 'capped failure + sub-cap failure', rows: [queueRow('FAILED', 1, 1), queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 2)], failedUploads: 0 },
        { name: 'everything at once', rows: [queueRow('PENDING', 0, 1), queueRow('FAILED', 1, 2), queueRow('FAILED', MAX_AUTO_RETRY_COUNT, 3), queueRow('REJECTED_USER_REVIEW', 1, 4)], failedUploads: 1, pendingUploads: 2, pendingAiJobs: 3 },
        { name: 'pending uploads only', rows: [], failedUploads: 0, pendingUploads: 3 },
        { name: 'pending AI jobs only', rows: [], failedUploads: 0, pendingAiJobs: 1 },
    ];

    it.each(shapes)('$name — the chip shouts iff the drawer has something to show', ({ rows, failedUploads, pendingUploads = 0, pendingAiJobs = 0 }) => {
        const claim = deriveSyncHonestyState(settled({
            rows: rows.map(r => ({ status: r.status, retryCount: r.retryCount })),
            failedUploads,
            pendingUploads,
            pendingAiJobs,
        }));

        const openFailures = rows.filter(r => (OPEN_FAILURE_STATUSES as readonly string[]).includes(r.status));
        const { stuck } = partitionOpenFailures(openFailures);
        const drawerTotalFailed = stuck.length + failedUploads;

        expect(claim === 'NEEDS_FIX').toBe(drawerTotalFailed > 0);
    });
});
