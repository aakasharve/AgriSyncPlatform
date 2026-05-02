/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reconciles attachment metadata into Dexie + flips matching uploadQueue
 * rows to 'completed' once the server confirms upload. Must run inside
 * the orchestrator's `db.transaction('rw', ...)` block.
 */

import type { AttachmentDto, SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { mapAttachmentStatus } from '../helpers/mapAttachmentStatus';

export async function reconcileAttachments(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<number> {
    const attachments: AttachmentDto[] = payload.attachments ?? [];

    for (const attachment of attachments) {
        const existing = await db.attachments.get(attachment.id);
        const mappedStatus = mapAttachmentStatus(attachment.status);

        await db.attachments.put({
            id: attachment.id,
            farmId: attachment.farmId,
            linkedEntityId: attachment.linkedEntityId,
            linkedEntityType: attachment.linkedEntityType,
            localPath: existing?.localPath ?? attachment.localPath ?? '',
            originalFileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes ?? existing?.sizeBytes ?? 0,
            status: mappedStatus,
            remoteAttachmentId: attachment.id,
            uploadedAtUtc: attachment.uploadedAtUtc ?? existing?.uploadedAtUtc,
            finalizedAtUtc: attachment.finalizedAtUtc ?? existing?.finalizedAtUtc,
            createdAt: attachment.createdAtUtc,
            updatedAt: attachment.modifiedAtUtc,
            retryCount: existing?.retryCount ?? 0,
            lastError: mappedStatus === 'failed'
                ? existing?.lastError ?? 'Attachment upload failed on server.'
                : undefined,
        });

        if (mappedStatus === 'uploaded') {
            const queuedItems = await db.uploadQueue
                .where('attachmentId')
                .equals(attachment.id)
                .toArray();

            for (const queuedItem of queuedItems) {
                if (queuedItem.autoId === undefined) {
                    continue;
                }

                await db.uploadQueue.update(queuedItem.autoId, {
                    status: 'completed',
                    updatedAt: receivedAtUtc,
                    nextAttemptAt: undefined,
                    lastError: undefined,
                });
            }
        }
    }

    return attachments.length;
}
