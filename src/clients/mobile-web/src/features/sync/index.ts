export { useSyncQueueStatus, useUnqueueableLogCount } from './hooks/useSyncQueueStatus';
export { default as SyncStatusDrawer } from './components/SyncStatusDrawer';
export { default as OfflineBanner } from './components/OfflineBanner';

// `useUnqueueableLogCount` lives in the SAME module as `useSyncQueueStatus`
// and is exported here for the same consumer (`AppHeader`), so it adds no
// module to this barrel's graph — it is one more binding off a module the
// barrel already pulls in. The note below is about `status/`, not this.
//
// Labour Phase 2 / T1 — the sync-honesty state model is deliberately NOT
// re-exported here. This barrel also exports `SyncStatusDrawer`, which drags
// `lucide-react` and a module-scope `backgroundSyncWorker` singleton into the
// graph of anything that touches it. The save path (T2) must not pay that cost
// to read three string constants, so it deep-imports — correctly:
//
//     import { SYNC_HONESTY_I18N_KEYS } from '../../features/sync/status/syncHonestyState';
//
// That deep import is the intended path, not a workaround. Keep it that way.
