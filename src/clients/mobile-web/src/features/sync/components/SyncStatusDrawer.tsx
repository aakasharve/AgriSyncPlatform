import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Wifi, WifiOff, Cloud, CloudOff, Cpu, Upload, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useSyncQueueStatus } from '../hooks/useSyncQueueStatus';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueItem } from '../../../infrastructure/storage/DexieDatabase';

interface Props {
     isOpen: boolean;
     onClose: () => void;
}

/**
 * SyncStatusDrawer — Bottom sheet showing sync queue details with manual retry.
 *
 * Sections: Connection, Pending Changes, Failed Items (with retry), Uploads, AI Processing, Last Sync.
 */
const SyncStatusDrawer: React.FC<Props> = ({ isOpen, onClose }) => {
     const status = useSyncQueueStatus();
     const [failedItems, setFailedItems] = useState<MutationQueueItem[]>([]);
     const [aiJobStatusCounts, setAiJobStatusCounts] = useState<{ pending: number; processing: number }>({
          pending: 0,
          processing: 0,
     });
     const [isSyncing, setIsSyncing] = useState(false);
     const [isRetrying, setIsRetrying] = useState(false);

     // Load failed items when drawer opens
     useEffect(() => {
          if (!isOpen) return;
          loadFailedItems();
     }, [isOpen, status.failedCount]);

     useEffect(() => {
          if (!isOpen) return;
          loadAiJobStatusCounts();
     }, [isOpen, status.pendingAiJobs]);

     useEffect(() => {
          if (!isOpen) return;

          const handleKeyDown = (event: KeyboardEvent) => {
               if (event.key === 'Escape') {
                    onClose();
               }
          };

          window.addEventListener('keydown', handleKeyDown);
          return () => window.removeEventListener('keydown', handleKeyDown);
     }, [isOpen, onClose]);

     const loadFailedItems = async () => {
          try {
               const db = getDatabase();
               const items = await db.mutationQueue.where('status').equals('FAILED').toArray();
               setFailedItems(items);
          } catch (e) {
               console.warn('Failed to load failed items', e);
          }
     };

     const loadAiJobStatusCounts = async () => {
          try {
               const db = getDatabase();
               const pending = await db.pendingAiJobs.where('status').equals('pending').count();
               const processing = await db.pendingAiJobs.where('status').equals('processing').count();
               setAiJobStatusCounts({ pending, processing });
          } catch (e) {
               console.warn('Failed to load AI job queue status counts', e);
               setAiJobStatusCounts({ pending: 0, processing: 0 });
          }
     };

     const handleSyncNow = async () => {
          setIsSyncing(true);
          try {
               await backgroundSyncWorker.triggerNow();
          } catch (e) {
               console.error('Manual sync failed', e);
          } finally {
               setIsSyncing(false);
          }
     };

     const handleRetryAll = async () => {
          setIsRetrying(true);
          try {
               await backgroundSyncWorker.retryAllFailed();
          } catch (e) {
               console.error('Retry all failed', e);
          } finally {
               setIsRetrying(false);
          }
     };

     const handleRetryOne = async (clientRequestId: string) => {
          try {
               await backgroundSyncWorker.retryFailed(clientRequestId);
               await loadFailedItems();
          } catch (e) {
               console.error('Retry failed', e);
          }
     };

     const getRelativeTime = (isoDate: string | null): string => {
          if (!isoDate) return 'Never';
          const diff = Date.now() - new Date(isoDate).getTime();
          if (diff < 10000) return 'Just now';
          if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
          if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
          return `${Math.floor(diff / 3600000)}h ago`;
     };

     if (!isOpen) return null;

     const totalPending = status.pendingCount + status.pendingUploads + status.pendingAiJobs;
     const totalFailed = status.failedCount + status.failedUploads;
     const aiStatusParts = [
          aiJobStatusCounts.pending > 0 ? `${aiJobStatusCounts.pending} voice recording${aiJobStatusCounts.pending > 1 ? 's' : ''} pending` : null,
          aiJobStatusCounts.processing > 0 ? `${aiJobStatusCounts.processing} voice recording${aiJobStatusCounts.processing > 1 ? 's' : ''} processing` : null,
     ].filter((part): part is string => Boolean(part));

     return (
          <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-end justify-center animate-in fade-in" onClick={onClose}>
               <div
                    className="bg-white w-full max-w-lg rounded-t-3xl shadow-2xl max-h-[75vh] flex flex-col animate-in slide-in-from-bottom-8"
                    onClick={(e) => e.stopPropagation()}
               >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                         <div className="flex items-center gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${status.isOnline ? 'bg-emerald-400' : 'bg-red-400'}`} />
                              <h3 className="text-lg font-black text-slate-800">Sync Status</h3>
                         </div>
                         <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
                              <X size={16} className="text-slate-500" />
                         </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                         {/* E2E: always-present pending count for Playwright assertions */}
                         <span data-testid="sync-pending-count" aria-label={`${totalPending} pending`} className="sr-only">{totalPending}</span>

                         {/* 1. Connection */}
                         <div className={`flex items-center gap-3 p-3 rounded-xl border ${status.isOnline ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                              {status.isOnline ? <Wifi size={16} className="text-emerald-600" /> : <WifiOff size={16} className="text-red-600" />}
                              <span className={`text-sm font-bold ${status.isOnline ? 'text-emerald-700' : 'text-red-700'}`}>
                                   {status.isOnline ? 'Connected' : 'Offline — changes saved locally'}
                              </span>
                         </div>

                         {/* 2. Pending Changes */}
                         {totalPending > 0 && (
                              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                                   <div className="flex items-center gap-2 mb-1">
                                        <Clock size={14} className="text-amber-600" />
                                        <span className="text-sm font-bold text-amber-700">
                                             {totalPending} change{totalPending > 1 ? 's' : ''} waiting to sync
                                        </span>
                                   </div>
                                   <div className="text-[10px] text-amber-600 font-medium space-x-3">
                                        {status.pendingCount > 0 && <span>{status.pendingCount} mutations</span>}
                                        {status.pendingUploads > 0 && <span>{status.pendingUploads} uploads</span>}
                                        {status.pendingAiJobs > 0 && <span>{status.pendingAiJobs} AI jobs</span>}
                                   </div>
                              </div>
                         )}

                         {/* 3. Failed Items */}
                         {totalFailed > 0 && (
                              <div className="rounded-xl border border-red-200 overflow-hidden">
                                   <div className="flex items-center justify-between p-3 bg-red-50">
                                        <div className="flex items-center gap-2">
                                             <AlertCircle size={14} className="text-red-600" />
                                             <span className="text-sm font-bold text-red-700">{totalFailed} Failed</span>
                                        </div>
                                        <button
                                             onClick={handleRetryAll}
                                             disabled={isRetrying}
                                             className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                        >
                                             {isRetrying ? 'Retrying...' : 'Retry All'}
                                        </button>
                                   </div>
                                   <div className="divide-y divide-red-100">
                                        {failedItems.slice(0, 5).map((item) => (
                                             <div key={item.id} className="flex items-center justify-between p-3 bg-white">
                                                  <div className="min-w-0 flex-1">
                                                       <p className="text-xs font-bold text-slate-700 truncate">{item.mutationType}</p>
                                                       <p className="text-[10px] text-red-500 font-medium truncate">{item.lastError || 'Unknown error'}</p>
                                                  </div>
                                                  <button
                                                       onClick={() => handleRetryOne(item.clientRequestId)}
                                                       className="ml-2 px-2 py-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                                                  >
                                                       Retry
                                                  </button>
                                             </div>
                                        ))}
                                        {failedItems.length > 5 && (
                                             <p className="p-2 text-center text-[10px] text-slate-400 font-medium">
                                                  +{failedItems.length - 5} more
                                             </p>
                                        )}
                                   </div>
                              </div>
                         )}

                         {/* 4. Uploads */}
                         {(status.pendingUploads > 0 || status.failedUploads > 0) && (
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                                   <Upload size={14} className="text-blue-600" />
                                   <span className="text-sm font-medium text-blue-700">
                                        {status.pendingUploads > 0 && `${status.pendingUploads} uploading`}
                                        {status.pendingUploads > 0 && status.failedUploads > 0 && ' • '}
                                        {status.failedUploads > 0 && `${status.failedUploads} failed`}
                                   </span>
                              </div>
                         )}

                         {/* 5. AI Processing */}
                         {aiStatusParts.length > 0 && (
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 border border-purple-200">
                                   <Cpu size={14} className="text-purple-600" />
                                   <span className="text-sm font-medium text-purple-700">
                                        {aiStatusParts.join(' â€¢ ')}
                                   </span>
                              </div>
                         )}

                         {/* 6. All Clear */}
                         {totalPending === 0 && totalFailed === 0 && (
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                                   <CheckCircle size={14} className="text-emerald-600" />
                                   <span className="text-sm font-bold text-emerald-700">All synced</span>
                              </div>
                         )}

                         {/* Last Synced */}
                         <div className="text-center text-[10px] text-slate-400 font-medium pt-2">
                              Last synced: {getRelativeTime(status.lastSyncAt)}
                              {status.syncedCount > 0 && ` • ${status.syncedCount} applied`}
                         </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-100">
                         <button
                              onClick={handleSyncNow}
                              disabled={isSyncing || !status.isOnline}
                              data-testid="sync-trigger-now"
                              className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-all active:scale-[0.98]"
                         >
                              <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                              {isSyncing ? 'Syncing...' : 'Sync Now'}
                         </button>
                    </div>
               </div>
          </div>
     );
};

export default SyncStatusDrawer;
