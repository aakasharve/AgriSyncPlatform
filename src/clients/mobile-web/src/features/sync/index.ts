export { useSyncQueueStatus } from './hooks/useSyncQueueStatus';
export { default as SyncStatusDrawer } from './components/SyncStatusDrawer';
export { default as OfflineBanner } from './components/OfflineBanner';

// Labour Phase 2 / T1 — the three claims the app is allowed to make about a
// farmer's records, and the one pure function that decides which one is true.
// Task T2 (`useLogCommands.ts`) must reuse `NEEDS_FIX` and its wording for a
// never-enqueued log rather than coining a fourth claim.
export {
    deriveSyncHonestyState,
    SYNC_HONESTY_I18N_KEYS,
    SYNC_HONESTY_OPEN_STATUSES,
    MAX_AUTO_RETRY_COUNT,
    type SyncHonestyState,
    type SyncQueueRowSnapshot,
} from './status/syncHonestyState';
