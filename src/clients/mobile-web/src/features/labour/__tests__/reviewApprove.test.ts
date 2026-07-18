/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reviewApprove tests — Task 3.1 (Stage 3, spec:
 * 2026-07-13-labour-attendance-approval-design).
 *
 * Locks the तपासणी approve/query -> real `verify_log` wiring
 * (`ReviewSheet.sendVerification`):
 *   - A `Confirmed` item reaches "verified"/"disputed" in ONE `verify_log`
 *     mutation (Confirmed -> Verified/Disputed is a valid one-hop
 *     transition per `VerificationStateMachine`).
 *   - A `Draft` (or unknown/undefined) item needs TWO mutations, in
 *     order: 'confirmed' first, then the final status — the state machine
 *     forbids a one-hop Draft -> Verified/Disputed.
 *   - A `Verified` item disputing (शंका) also goes in one hop
 *     (Verified -> Disputed is valid; only Draft needs the extra step).
 *   - शंका always carries the (non-empty) reason `DailyLog.Verify` requires
 *     for a Disputed transition.
 *   - A rejected `enqueue()` propagates — the caller must not fabricate
 *     success on a failed mutation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnqueue = vi.fn();
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...args: unknown[]) => mockEnqueue(...args) },
}));

const mockTriggerNow = vi.fn();
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...args: unknown[]) => mockTriggerNow(...args) },
}));

import { sendVerification } from '../components/ReviewSheet';

describe('sendVerification — तपासणी approve/query drives real verify_log', () => {
    beforeEach(() => {
        mockEnqueue.mockReset();
        mockEnqueue.mockResolvedValue('client-request-id');
        mockTriggerNow.mockReset();
        mockTriggerNow.mockResolvedValue(undefined);
    });

    it('approving a Confirmed item enqueues exactly ONE verify_log mutation with verificationStatus "verified"', async () => {
        await sendVerification('r1', 'Confirmed', 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r1', verificationStatus: 'verified', reason: undefined });
    });

    it('approving a Draft item enqueues TWO mutations, in order: confirmed then verified', async () => {
        await sendVerification('r2', 'Draft', 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'verified', reason: undefined });
    });

    it('an unknown/undefined status is treated the same as Draft — two-step', async () => {
        await sendVerification('r-unknown', undefined, 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r-unknown', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r-unknown', verificationStatus: 'verified', reason: undefined });
    });

    it('शंका on a Confirmed item sends ONE disputed mutation with the reason', async () => {
        await sendVerification('r3', 'Confirmed', 'disputed', 'मालकाने शंका घेतली आहे.');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({
            dailyLogId: 'r3',
            verificationStatus: 'disputed',
            reason: 'मालकाने शंका घेतली आहे.',
        });
    });

    it('शंका on a Draft item enqueues confirmed THEN disputed, in order, with the reason on the final step', async () => {
        await sendVerification('r4', 'Draft', 'disputed', 'शंका आहे');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r4', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r4', verificationStatus: 'disputed', reason: 'शंका आहे' });
    });

    it('शंका on a Verified item also goes in one hop (Verified -> Disputed is valid)', async () => {
        await sendVerification('r5', 'Verified', 'disputed', 'शंका');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r5', verificationStatus: 'disputed', reason: 'शंका' });
    });

    it('triggers a best-effort sync push after enqueueing so the mutation reaches the server promptly', async () => {
        await sendVerification('r6', 'Confirmed', 'verified');

        expect(mockTriggerNow).toHaveBeenCalledTimes(1);
    });

    it('propagates a rejected enqueue() — never swallows a failed mutation as a fake success', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('Payload validation failed'));

        await expect(sendVerification('r7', 'Confirmed', 'verified')).rejects.toThrow('Payload validation failed');
    });

    it('stops after the first step if Draft->Confirmed rejects — never attempts the invalid one-hop transition', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('boom'));

        await expect(sendVerification('r8', 'Draft', 'verified')).rejects.toThrow('boom');
        expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });
});
