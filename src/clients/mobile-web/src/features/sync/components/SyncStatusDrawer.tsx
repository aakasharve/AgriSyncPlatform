import React, { useState, useEffect } from 'react';
// `Cloud` / `CloudOff` were imported and never rendered — a pre-existing lint
// warning (proven against 30d3654f) that only surfaced now because this file is
// staged for the first time. Removed; nothing rendered them.
import { X, RefreshCw, Wifi, WifiOff, Cpu, Upload, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useSyncQueueStatus } from '../hooks/useSyncQueueStatus';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

interface Props {
     isOpen: boolean;
     onClose: () => void;
     /**
      * Opens `OfflineConflictPage` — the ONLY surface that can clear a durable
      * rejection (finding OPEN-C). Optional because this drawer's second mount
      * point, `OperatorSessionBar`, has no navigation and zero importers
      * (ruling R9): unreachable in the shipping UI, so it gets the explanation
      * without the button rather than a button that goes nowhere.
      */
     onOpenConflicts?: () => void;
}

/**
 * SyncStatusDrawer — Bottom sheet showing sync queue details with manual retry.
 *
 * Sections: Connection, Pending Changes, Failed Items (with retry), Uploads, AI Processing, Last Sync.
 */
const SyncStatusDrawer: React.FC<Props> = ({ isOpen, onClose, onOpenConflicts }) => {
     const status = useSyncQueueStatus();
     const [aiJobStatusCounts, setAiJobStatusCounts] = useState<{ pending: number; processing: number }>({
          pending: 0,
          processing: 0,
     });
     const [isSyncing, setIsSyncing] = useState(false);
     const [isRetrying, setIsRetrying] = useState(false);
     /** OPEN-E — rows 6+ used to be a plain-text "+N more" and unreachable. */
     const [showAllStuck, setShowAllStuck] = useState(false);
     /**
      * Rows whose per-row Retry has been tapped and not yet observed leaving the
      * list. The list is now a 3s poll rather than an imperative re-read, so
      * without this a tapped row sits there looking untouched for up to three
      * seconds and invites a second tap.
      */
     const [retryingIds, setRetryingIds] = useState<string[]>([]);

     /**
      * OPEN-D — the list and the count now come from ONE array.
      *
      * This component used to run its own `where('status').equals('FAILED')`
      * query while the header printed `status.failedCount`, which counts durable
      * rejections too. One rejected row and zero failed rows rendered
      * "1 Failed" above an EMPTY LIST — a number with nothing behind it, on the
      * screen the header chip sends the farmer to when it says `अडकलं — तपासा`.
      * `stuckMutations` is that count's own contents; they cannot disagree.
      */
     const stuck = status.stuckMutations;
     const visibleStuck = showAllStuck ? stuck : stuck.slice(0, 5);
     const needsReviewCount = stuck.filter((item) => item.remedy === 'NEEDS_REVIEW').length;
     const resendableCount = stuck.length - needsReviewCount + status.failedUploads;

     useEffect(() => {
          if (!isOpen) return;
          loadAiJobStatusCounts();
     }, [isOpen, status.pendingAiJobs]);

     // Drop the "retrying" mark once the poll confirms the row has left the
     // stuck set. Nothing here re-reads Dexie; it only follows what the hook
     // already reports, so the spinner cannot outlive the truth.
     useEffect(() => {
          setRetryingIds((prev) => prev.filter((id) => stuck.some((item) => item.clientRequestId === id)));
     }, [stuck]);

     // Collapse again when the sheet closes, so the next open starts short.
     useEffect(() => {
          if (!isOpen) setShowAllStuck(false);
     }, [isOpen]);

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
          setRetryingIds((prev) => (prev.includes(clientRequestId) ? prev : [...prev, clientRequestId]));
          try {
               await backgroundSyncWorker.retryFailed(clientRequestId);
          } catch (e) {
               console.error('Retry failed', e);
               // Un-mark on a throw, or the row is stuck showing a spinner over
               // a retry that never happened — a smaller version of the same
               // defect this whole task is about.
               setRetryingIds((prev) => prev.filter((id) => id !== clientRequestId));
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

                         {/* 3. Needs You — was "Failed Items" */}
                         {totalFailed > 0 && (
                              <div className="rounded-xl border border-red-200 overflow-hidden">
                                   <div className="flex items-center justify-between p-3 bg-red-50">
                                        <div className="flex min-w-0 items-center gap-2">
                                             <AlertCircle size={14} className="text-red-600 shrink-0" />
                                             {/* One number used to stand for two unrelated
                                                 situations: rows a tap can re-send, and rows the
                                                 server has permanently refused, which "Retry All"
                                                 deliberately does not touch. Splitting them is what
                                                 makes the button beside it honest.

                                                 LENGTH IS LOAD-BEARING HERE. L5b measured this box
                                                 at 213px and it HARD-CLIPS at ~34 characters with
                                                 no ellipsis to warn you. The split branch is the
                                                 long one: at three-digit counts it reads
                                                 "999 can be sent · 999 need you" = 30. Do not add
                                                 words here without re-measuring — an earlier draft
                                                 said "can be sent again" in this branch and hit 34
                                                 exactly at two digits. */}
                                             <span className="truncate text-sm font-bold text-red-700">
                                                  {needsReviewCount > 0 && resendableCount > 0
                                                       ? `${resendableCount} can be sent · ${needsReviewCount} need you`
                                                       : needsReviewCount > 0
                                                            ? `${needsReviewCount} need you`
                                                            : `${resendableCount} can be sent again`}
                                             </span>
                                        </div>
                                        {resendableCount > 0 && (
                                             <button
                                                  onClick={handleRetryAll}
                                                  disabled={isRetrying}
                                                  data-testid="sync-retry-all"
                                                  className="ml-2 shrink-0 px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                                             >
                                                  {isRetrying ? 'Retrying...' : 'Retry All'}
                                             </button>
                                        )}
                                   </div>
                                   <div className="divide-y divide-red-100">
                                        {visibleStuck.map((item) => {
                                             const isRetryingRow = retryingIds.includes(item.clientRequestId);
                                             return (
                                                  <div key={item.clientRequestId} className="flex items-center justify-between p-3 bg-white">
                                                       <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold text-slate-700 truncate">{item.mutationType}</p>
                                                            <p className="text-[10px] text-red-500 font-medium truncate">{item.lastError || 'Unknown error'}</p>
                                                            {item.remedy === 'NEEDS_REVIEW' && (
                                                                 // Re-sending these bytes unchanged is KNOWN to
                                                                 // fail — the server refused this row on its
                                                                 // merits. A "Retry" here would be a second
                                                                 // painted door beside the first one.
                                                                 <p className="text-[10px] font-medium text-slate-500">
                                                                      The server would not accept this. Open it to fix, resend or discard.
                                                                 </p>
                                                            )}
                                                       </div>
                                                       {item.remedy === 'NEEDS_REVIEW' ? (
                                                            onOpenConflicts && (
                                                                 <button
                                                                      onClick={onOpenConflicts}
                                                                      data-testid={`sync-review-${item.clientRequestId}`}
                                                                      className="ml-2 shrink-0 px-2 py-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                                                                 >
                                                                      Review
                                                                 </button>
                                                            )
                                                       ) : (
                                                            <button
                                                                 onClick={() => handleRetryOne(item.clientRequestId)}
                                                                 disabled={isRetryingRow}
                                                                 data-testid={`sync-retry-${item.clientRequestId}`}
                                                                 className="ml-2 shrink-0 px-2 py-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                                                            >
                                                                 {isRetryingRow ? 'Sending...' : 'Retry'}
                                                            </button>
                                                       )}
                                                  </div>
                                             );
                                        })}
                                        {stuck.length > 5 && (
                                             // OPEN-E: this used to be plain text. Rows 6+ were
                                             // counted and named but could not be inspected or
                                             // individually retried — the list's own version of a
                                             // count with nothing behind it.
                                             <button
                                                  onClick={() => setShowAllStuck((v) => !v)}
                                                  data-testid="sync-toggle-all-stuck"
                                                  className="w-full p-2 text-center text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                                             >
                                                  {showAllStuck ? 'Show fewer' : `+${stuck.length - 5} more`}
                                             </button>
                                        )}
                                        {status.failedUploads > 0 && (
                                             // OPEN-F: the Uploads section counts into the number
                                             // above and has no control of its own. "Retry All" DOES
                                             // reach these now (T3 wired `resetFailedUploadsToPending`
                                             // into it), so this points at a button that works — and
                                             // it is guaranteed on screen, because failedUploads > 0
                                             // is one of the two terms in `resendableCount`.
                                             <p className="p-3 text-[10px] font-medium text-slate-500 bg-white">
                                                  {status.failedUploads} photo upload{status.failedUploads > 1 ? 's' : ''} also stopped. "Retry All" sends {status.failedUploads > 1 ? 'them' : 'it'} again.
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
