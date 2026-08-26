// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3.
 *
 * A terminally-failed attachment upload forces the header chip to `NEEDS_FIX`
 * (`syncHonestyState.ts:253-255`) and is counted into the drawer's "N Failed"
 * header — and until this module existed, nothing in the app could clear it.
 * These tests lock the door open, and lock it to the ONE status the upload
 * worker abandons, so it cannot start yanking healthy rows out of backoff.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase, type UploadQueueStatus } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';
import { resetFailedUploadsToPending } from '../UploadQueueRetry';

const FROZEN_NOW_ISO = '2026-08-12T09:00:00.000Z';
const EARLIER_ISO = '2026-08-11T09:00:00.000Z';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

async function seedUpload(
    attachmentId: string,
    status: UploadQueueStatus,
    options: { withAttachment?: boolean; retryCount?: number } = {},
) {
    const db = getDatabase();
    if (options.withAttachment !== false) {
        await db.attachments.add({
            id: attachmentId,
            farmId: 'farm-1',
            localPath: `/tmp/${attachmentId}.jpg`,
            originalFileName: `${attachmentId}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 2048,
            status: status === 'failed' ? 'failed' : 'pending',
            createdAt: EARLIER_ISO,
            updatedAt: EARLIER_ISO,
            retryCount: options.retryCount ?? (status === 'failed' ? 5 : 1),
            lastError: status === 'failed' ? 'Attachment upload failed.' : undefined,
        });
    }

    await db.uploadQueue.add({
        attachmentId,
        status,
        retryCount: options.retryCount ?? (status === 'failed' ? 5 : 1),
        lastAttemptAt: EARLIER_ISO,
        nextAttemptAt: status === 'failed' ? undefined : '2099-01-01T00:00:00.000Z',
        lastError: status === 'failed' ? 'Attachment upload failed.' : undefined,
        createdAt: EARLIER_ISO,
        updatedAt: EARLIER_ISO,
    });
}

describe('resetFailedUploadsToPending', () => {
    beforeEach(async () => {
        vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);
        await freshDb();
    });

    it('re-queues a failed upload with its retry budget restored', async () => {
        await seedUpload('att-1', 'failed');

        expect(await resetFailedUploadsToPending()).toBe(1);

        const row = await getDatabase().uploadQueue.where('attachmentId').equals('att-1').first();
        expect(row?.status).toBe('pending');
        expect(row?.retryCount).toBe(0);
        expect(row?.nextAttemptAt).toBeUndefined();
        expect(row?.updatedAt).toBe(FROZEN_NOW_ISO);
    });

    it('brings the attachment record back with it', async () => {
        await seedUpload('att-2', 'failed');

        await resetFailedUploadsToPending();

        const attachment = await getDatabase().attachments.get('att-2');
        expect(attachment?.status).toBe('pending');
        expect(attachment?.retryCount).toBe(0);
    });

    it('keeps lastError — the farmer is owed the reason, not a clean slate', async () => {
        await seedUpload('att-3', 'failed');

        await resetFailedUploadsToPending();

        const row = await getDatabase().uploadQueue.where('attachmentId').equals('att-3').first();
        expect(row?.lastError).toBe('Attachment upload failed.');
    });

    it('does not disturb uploads the worker is still handling', async () => {
        await seedUpload('att-pending', 'pending');
        await seedUpload('att-uploading', 'uploading');
        await seedUpload('att-waiting', 'retry_wait');

        expect(await resetFailedUploadsToPending()).toBe(0);

        const db = getDatabase();
        expect((await db.uploadQueue.where('attachmentId').equals('att-waiting').first())?.retryCount).toBe(1);
        expect((await db.uploadQueue.where('attachmentId').equals('att-waiting').first())?.nextAttemptAt).toBe('2099-01-01T00:00:00.000Z');
        expect((await db.uploadQueue.where('attachmentId').equals('att-uploading').first())?.status).toBe('uploading');
    });

    it('handles a failed row whose attachment record is gone', async () => {
        await seedUpload('att-orphan', 'failed', { withAttachment: false });

        expect(await resetFailedUploadsToPending()).toBe(1);

        const row = await getDatabase().uploadQueue.where('attachmentId').equals('att-orphan').first();
        expect(row?.status).toBe('pending');
    });

    it('re-queues every failed upload, not just the first', async () => {
        await seedUpload('att-a', 'failed');
        await seedUpload('att-b', 'failed');
        await seedUpload('att-c', 'pending');

        expect(await resetFailedUploadsToPending()).toBe(2);
        expect(await getDatabase().uploadQueue.where('status').equals('failed').count()).toBe(0);
    });

    it('reports zero on an empty queue rather than implying it did something', async () => {
        expect(await resetFailedUploadsToPending()).toBe(0);
    });
});
