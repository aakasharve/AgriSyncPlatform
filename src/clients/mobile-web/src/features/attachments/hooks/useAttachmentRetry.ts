/**
 * useAttachmentRetry — Hook for retrying failed attachment uploads
 *
 * Reads failed items from Dexie uploadQueue.
 * Provides retryUpload(id), retryAllFailed(), and failedCount.
 */

import { useState, useEffect, useCallback } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { attachmentUploadWorker } from '../../../infrastructure/sync/AttachmentUploadWorker';
import { systemClock } from '../../../core/domain/services/Clock';

interface FailedUploadItem {
     autoId: number;
     attachmentId: string;
     lastError?: string;
}

export function useAttachmentRetry() {
     const [failedItems, setFailedItems] = useState<FailedUploadItem[]>([]);
     const [isRetrying, setIsRetrying] = useState(false);

     const loadFailed = useCallback(async () => {
          try {
               const db = getDatabase();
               const failed = await db.uploadQueue
                    .where('status')
                    .equals('failed')
                    .toArray();
               setFailedItems(
                    failed
                         .filter(item => item.autoId !== undefined)
                         .map(item => ({
                              autoId: item.autoId!,
                              attachmentId: item.attachmentId,
                              lastError: item.lastError,
                         }))
               );
          } catch {
               // Silently fail
          }
     }, []);

     useEffect(() => {
          loadFailed();
     }, [loadFailed]);

     const retryUpload = useCallback(async (attachmentId: string) => {
          setIsRetrying(true);
          try {
               const db = getDatabase();
               const nowIso = systemClock.nowISO();

               // Reset the queue item to pending
               const items = await db.uploadQueue
                    .where('attachmentId')
                    .equals(attachmentId)
                    .toArray();

               for (const item of items) {
                    if (item.autoId !== undefined && item.status === 'failed') {
                         await db.uploadQueue.update(item.autoId, {
                              status: 'pending',
                              retryCount: 0,
                              nextAttemptAt: undefined,
                              lastError: undefined,
                              updatedAt: nowIso,
                         });
                    }
               }

               // Reset attachment status to pending
               await db.attachments.update(attachmentId, {
                    status: 'pending',
                    lastError: undefined,
                    retryCount: 0,
                    updatedAt: nowIso,
               });

               // Trigger upload worker immediately
               await attachmentUploadWorker.triggerNow();

               // Reload failed list
               await loadFailed();
          } catch {
               // Silently fail
          } finally {
               setIsRetrying(false);
          }
     }, [loadFailed]);

     const retryAllFailed = useCallback(async () => {
          setIsRetrying(true);
          try {
               for (const item of failedItems) {
                    await retryUpload(item.attachmentId);
               }
          } finally {
               setIsRetrying(false);
          }
     }, [failedItems, retryUpload]);

     return {
          failedCount: failedItems.length,
          failedItems,
          retryUpload,
          retryAllFailed,
          isRetrying,
          refreshFailed: loadFailed,
     };
}
