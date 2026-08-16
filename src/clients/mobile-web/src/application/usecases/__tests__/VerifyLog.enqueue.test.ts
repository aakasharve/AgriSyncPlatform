// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 1.4 (dfes-companion) — client half of "an owner can approve a
 * mukadam's log". `verifyLog()` built the wire payload as
 * {dailyLogId, targetStatus, verifiedByUserId, callerRole}. The canonical
 * `verify_log_v2` Zod schema (sync-contract/schemas/payloads/verify_log_v2.zod.ts)
 * requires {logId, verifierUserId, decision, decidedAt} and rejects any
 * caller-declared `callerRole`. Before this fix `mutationQueue.enqueue`
 * throws at PayloadValidator, so the approve button never reaches the
 * network — see task-1.4-report.md Wall 1.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { verifyLog, batchVerifyLogs } from '../VerifyLog';
import type { LogsRepository } from '../../ports';
import type { AuditPort } from '../../ports/AuditPort';
import type { FarmerProfile } from '../../../domain/types/farm.types';
import { VerificationStatus } from '../../../domain/types/farm.types';
import { VerifyLogV2Payload } from '../../../../../../../sync-contract/schemas/payloads';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-08-16T09:00:00.000Z';
const OWNER_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
const LOG_ID = 'b2b2b2b2-0000-4000-8000-000000000002';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

const noopRepository = {} as unknown as LogsRepository;

function makeProfile(): FarmerProfile {
    return {
        name: 'Test Owner',
        village: 'Test Village',
        phone: '9999999999',
        language: 'mr',
        verificationStatus: VerificationStatus.PhoneVerified,
        operators: [
            {
                id: OWNER_ID,
                name: 'Owner',
                role: 'PRIMARY_OWNER',
                capabilities: [],
                isVerifier: true,
            },
        ],
        activeOperatorId: OWNER_ID,
        waterResources: [],
        motors: [],
        infrastructure: {
            waterManagement: 'Centralized',
            filtrationType: 'None',
        },
    };
}

describe('VerifyLog — task 1.4 client wire shape (verify_log_v2)', () => {
    let auditPort: AuditPort;

    beforeEach(async () => {
        vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
        await freshDb();
        auditPort = { append: vi.fn().mockResolvedValue(undefined) };
    });

    it('approve enqueues a payload that PASSES the canonical verify_log_v2 zod schema (was: throws + success:false)', async () => {
        const result = await verifyLog(
            { logId: LOG_ID, verifierId: OWNER_ID, action: 'approve' },
            noopRepository,
            auditPort,
            makeProfile()
        );

        expect(result.success).toBe(true);

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows).toHaveLength(1);

        const parsed = VerifyLogV2Payload.safeParse(rows[0].payload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data).toEqual({
                logId: LOG_ID,
                verifierUserId: OWNER_ID,
                decision: 'verify',
                decidedAt: FROZEN_NOW_ISO,
            });
        }

        // The server refuses a payload that declares its own authority.
        expect(rows[0].payload).not.toHaveProperty('callerRole');
        expect(rows[0].payload).not.toHaveProperty('dailyLogId');
        expect(rows[0].payload).not.toHaveProperty('targetStatus');
        expect(rows[0].payload).not.toHaveProperty('verifiedByUserId');
    });

    it('dispute enqueues decision "dispute" with the required reason', async () => {
        const result = await verifyLog(
            { logId: LOG_ID, verifierId: OWNER_ID, action: 'dispute', note: 'quantity looks wrong' },
            noopRepository,
            auditPort,
            makeProfile()
        );

        expect(result.success).toBe(true);

        const rows = await getDatabase().mutationQueue.toArray();
        const parsed = VerifyLogV2Payload.safeParse(rows[0].payload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.decision).toBe('dispute');
            expect(parsed.data.reason).toBe('quantity looks wrong');
        }
    });

    /**
     * WAVE-1.4 fix round (I1). This use case is the LAST line of defence, not
     * the fix: the pre-sync placeholder is resolved to a real identity by
     * `core/domain/verifierIdentity.ts` before it ever gets here (proved in
     * `app/hooks/__tests__/useTrustLayer.freshDevice.test.tsx`). This test
     * pins the boundary — if a placeholder ever reaches this far again, it is
     * REFUSED at the offline queue rather than silently queued as garbage the
     * server would have to reject.
     *
     * Honest label: this assertion was already true before the fix. It exists
     * so a future "just let it through" shortcut fails loudly here.
     */
    it('refuses the pre-sync placeholder "owner" instead of queueing an unroutable payload', async () => {
        const result = await verifyLog(
            { logId: LOG_ID, verifierId: 'owner', action: 'approve' },
            noopRepository,
            auditPort,
            makeProfile()
        );

        expect(result.success).toBe(false);
        expect(await getDatabase().mutationQueue.toArray()).toHaveLength(0);
    });

    it('batchVerifyLogs enqueues one valid verify_log_v2 payload per log', async () => {
        const otherLogId = 'c3c3c3c3-0000-4000-8000-000000000003';
        const result = await batchVerifyLogs(
            { logIds: [LOG_ID, otherLogId], verifierId: OWNER_ID, action: 'approve' },
            noopRepository,
            auditPort,
            makeProfile()
        );

        expect(result.success).toBe(true);

        const rows = await getDatabase().mutationQueue.toArray();
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            const parsed = VerifyLogV2Payload.safeParse(row.payload);
            expect(parsed.success).toBe(true);
            expect(row.payload).not.toHaveProperty('callerRole');
        }
    });
});
