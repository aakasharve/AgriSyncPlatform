/**
 * Sub-plan 04 Task 4 — root store.
 *
 * Single point of access to the XState actor system that replaces scattered
 * React Contexts. Today the sync actor and navigation actor live here;
 * authMachine (Task 6 follow-up) will mount alongside.
 *
 * Components subscribe via useSelector from @xstate/react:
 *   const count = useSelector(getRootStore().sync, s =>
 *       s.context.rejectedMutations.length);
 *   const route = useSelector(getRootStore().navigation, selectCurrentRoute);
 */
import { createActor, type Actor } from 'xstate';
import { syncMachine } from './machines/syncMachine';
import {
    navigationMachine,
    readNavigationInputFromLocation,
} from './machines/navigationMachine';

interface RootStore {
    sync: Actor<typeof syncMachine>;
    navigation: Actor<typeof navigationMachine>;
}

let _root: RootStore | null = null;

function createRoot(): RootStore {
    const sync = createActor(syncMachine);
    sync.start();

    const navigation = createActor(navigationMachine, {
        input: readNavigationInputFromLocation(),
    });
    navigation.start();

    return { sync, navigation };
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
        _root.navigation.stop();
        _root = null;
    }
}

export type { RootStore };
export type SyncActor = Actor<typeof syncMachine>;
export type NavigationActor = Actor<typeof navigationMachine>;
