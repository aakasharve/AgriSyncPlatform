/**
 * Sub-plan 04 Task 4 — root store.
 *
 * Single point of access to the XState actor system that replaces scattered
 * React Contexts. Today only the sync actor lives here; navigationMachine
 * (T-IGH-04-XSTATE-NAV follow-up) and authMachine (Task 6 follow-up) will
 * mount alongside.
 *
 * Components subscribe via useSelector from @xstate/react:
 *   const count = useSelector(getRootStore().sync, s =>
 *       s.context.rejectedMutations.length);
 */
import { createActor, type Actor } from 'xstate';
import { syncMachine } from './machines/syncMachine';

interface RootStore {
    sync: Actor<typeof syncMachine>;
}

let _root: RootStore | null = null;

function createRoot(): RootStore {
    const sync = createActor(syncMachine);
    sync.start();
    return { sync };
}

export function getRootStore(): RootStore {
    if (!_root) {
        _root = createRoot();
    }
    return _root;
}

/**
 * Test-only — tear down the singleton between cases. Production code never
 * needs this.
 */
export function resetRootStore(): void {
    if (_root) {
        _root.sync.stop();
        _root = null;
    }
}

export type { RootStore };
export type SyncActor = Actor<typeof syncMachine>;
