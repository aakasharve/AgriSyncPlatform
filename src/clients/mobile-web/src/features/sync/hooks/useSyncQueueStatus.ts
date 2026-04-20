import { useState, useEffect, useCallback } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export interface SyncQueueStatus {
     // Mutation queue
     pendingCount: number;
     failedCount: number;
     syncedCount: number;
     // Upload queue
     pendingUploads: number;
     failedUploads: number;
     // AI jobs
     pendingAiJobs: number;
     // Connection
     isOnline: boolean;
     // Last sync
     lastSyncAt: string | null;
}

const EMPTY_STATUS: SyncQueueStatus = {
     pendingCount: 0,
     failedCount: 0,
     syncedCount: 0,
     pendingUploads: 0,
     failedUploads: 0,
     pendingAiJobs: 0,
     isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
     lastSyncAt: null,
};

/**
 * useSyncQueueStatus — Reactive hook for sync queue visibility.
 *
 * Polls Dexie tables every 3 seconds for mutation queue, upload queue,
 * and pending AI jobs status. Also listens for online/offline events.
 */
export function useSyncQueueStatus(): SyncQueueStatus {
     const [status, setStatus] = useState<SyncQueueStatus>(EMPTY_STATUS);

     const refresh = useCallback(async () => {
          try {
               const db = getDatabase();

               // Mutation queue counts
               const pending = await db.mutationQueue.where('status').equals('PENDING').count();
               const sending = await db.mutationQueue.where('status').equals('SENDING').count();
               const failed = await db.mutationQueue.where('status').equals('FAILED').count();
               const applied = await db.mutationQueue.where('status').equals('APPLIED').count();

               // Upload queue counts
               const pendingUploads = await db.uploadQueue.where('status').anyOf('pending', 'uploading', 'retry_wait').count();
               const failedUploads = await db.uploadQueue.where('status').equals('failed').count();

               // AI jobs
               const pendingAiJobs = await db.pendingAiJobs.where('status').anyOf('pending', 'processing').count();

               // Last sync
               const cursor = await db.syncCursors.get('shramsafal');
               const lastSyncAt = cursor?.lastSyncAt ?? null;

               setStatus({
                    pendingCount: pending + sending,
                    failedCount: failed,
                    syncedCount: applied,
                    pendingUploads,
                    failedUploads,
                    pendingAiJobs,
                    isOnline: navigator.onLine,
                    lastSyncAt,
               });
          } catch (e) {
               console.warn('[useSyncQueueStatus] Failed to read queue status', e);
          }
     }, []);

     useEffect(() => {
          refresh();
          const interval = setInterval(refresh, 3000);

          const handleOnline = () => setStatus(prev => ({ ...prev, isOnline: true }));
          const handleOffline = () => setStatus(prev => ({ ...prev, isOnline: false }));
          window.addEventListener('online', handleOnline);
          window.addEventListener('offline', handleOffline);

          return () => {
               clearInterval(interval);
               window.removeEventListener('online', handleOnline);
               window.removeEventListener('offline', handleOffline);
          };
     }, [refresh]);

     return status;
}
