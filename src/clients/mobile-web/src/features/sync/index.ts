export { useSyncQueueStatus } from './hooks/useSyncQueueStatus';
export { default as SyncStatusDrawer } from './components/SyncStatusDrawer';
export { default as OfflineBanner } from './components/OfflineBanner';

// Labour Phase 2 / T1 — the sync-honesty state model is deliberately NOT
// re-exported here. This barrel also exports `SyncStatusDrawer`, which drags
// `lucide-react` and a module-scope `backgroundSyncWorker` singleton into the
// graph of anything that touches it. The save path (T2) must not pay that cost
// to read three string constants, so it deep-imports — correctly:
//
//     import { SYNC_HONESTY_I18N_KEYS } from '../../features/sync/status/syncHonestyState';
//
// That deep import is the intended path, not a workaround. Keep it that way.
