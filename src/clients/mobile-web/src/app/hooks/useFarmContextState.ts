/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppContent.tsx.
 *
 * Owns the farm-context state machine consumed by AppContent + AppHeader:
 *   - my-farms list (lazy fetched after auth),
 *   - currentFarmId (mirrored to SessionStore for persistence),
 *   - first-farm wizard open/close,
 *   - the join door (JoinByCodeScreen) open/close,
 *   - user actions: switch / wizard-complete / join (code or QR) / join-complete.
 */

import React from 'react';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
import { useAuth } from '../providers/AuthProvider';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { isActiveSeat } from '../../core/session/seatStatus';
import {
    exitMembership,
    getMyFarms,
    type BootstrapFirstFarmResponse,
    type JoinedFarm,
    type MyFarmDto,
} from '../../features/onboarding/qr/inviteApi';
import { takeJoinAfterSignIn } from '../../features/onboarding/qr/farmCodeEntry';

export interface FarmContextState {
    /**
     * The farms the person is IN — Active seats only (spec plr-d7-m1-multiuser-2026-10-26 step 1).
     * A typed-code join request waiting for the owner is NOT here: it is in `pendingFarms`.
     */
    myFarms: MyFarmDto[] | null;
    /** Seats that have not ended but grant nothing yet (a join request waiting for the owner). */
    pendingFarms: MyFarmDto[];
    currentFarmId: string | null;
    showFirstFarmWizard: boolean;
    setShowFirstFarmWizard: React.Dispatch<React.SetStateAction<boolean>>;
    /** True when the user has 0 farms — shows the minimal 2-field onboarding. */
    showMinimalOnboarding: boolean;
    setShowMinimalOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
    handleSwitchFarm: (farmId: string) => void;
    handleWizardComplete: (result: BootstrapFirstFarmResponse) => void;
    /** Opens the join door (typed farm code, or the QR way). Name kept: every `onJoinViaQr` prop calls it. */
    handleJoinViaQr: () => void;
    /** spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the join door (`JoinByCodeScreen`). */
    showJoinByCode: boolean;
    closeJoinByCode: () => void;
    /** The server made (or already had) a seat: re-read the farm lists. Never switches farm by itself. */
    handleJoinComplete: (farm: JoinedFarm) => void;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — withdraws a waiting join request (the
     * server's self-exit, which always accepts one) and re-reads both farm lists. Rejects when
     * the server refused or could not be reached, so the caller can say so.
     */
    handleWithdrawRequest: (farmId: string) => Promise<void>;
}

/**
 * spec: owner-oversight-loop (Task 12) — `FirstFarmWizard` is a single,
 * full-screen overlay instance owned by `AppContent.tsx` (mounted once,
 * controlled by `showFirstFarmWizard`). The NEW "तुमच्या शेती · Your farms"
 * row in `SetupHubMenu.tsx` needs to open that SAME instance — never a
 * second `FirstFarmWizard` mount — but it renders deep inside `AppRouter`,
 * several component boundaries away from `AppContent`'s local state, with
 * no existing context bridge between them (`AppRouterContext` is derived
 * from `AppFeatureContexts`, a wholly separate state tree that does not
 * carry `setShowFirstFarmWizard`).
 *
 * Threading a new field through `AppRouterContext` -> `AppRouter.tsx` ->
 * `simpleRoutes.tsx` -> `ProfilePage` -> `SetupHubMenu` would touch five
 * files this task's brief never named, for one boolean. A `window` custom
 * event is the smaller, reversible surface: `AppContent.tsx` (mounted once,
 * for the app's whole lifetime) listens once; any component anywhere can
 * dispatch it without needing a prop path to exist. Symmetrical with the
 * `open_farm_boundary` sessionStorage handoff `ProfilePage.tsx` already
 * uses for the same kind of cross-boundary trigger.
 */
export const OPEN_CREATE_FARM_WIZARD_EVENT = 'agrisync:open-create-farm-wizard';

/** Dispatches the event above. Safe to call from anywhere, including SSR
 * (no-ops without `window`). */
export function requestCreateFarmWizard(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(OPEN_CREATE_FARM_WIZARD_EVENT));
}

/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the ONE join door. It used to be a
 * `window.prompt` asking for a pasted QR link (English, no typed code, a dead end for a
 * person who only had the code the owner read out). Every "join" control now opens the
 * same full screen, `JoinByCodeScreen` (typed farm code + the QR way), owned by this hook
 * and mounted once in `AppContent`. Controls that have a prop path call `handleJoinViaQr`;
 * `SetupHubMenu`'s row (deep inside `AppRouter`, no prop path) dispatches this event —
 * the same pattern, for the same reason, as `OPEN_CREATE_FARM_WIZARD_EVENT` above.
 */
export const OPEN_JOIN_FARM_EVENT = 'agrisync:open-join-farm';

/** Dispatches the event above. Safe to call from anywhere (no-ops without `window`). */
export function requestJoinFarm(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(OPEN_JOIN_FARM_EVENT));
}

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16, round-1 review F10). How long the first
 * run waits for /farms/mine before it stops holding the screen. `getMyFarms` has no timeout of its
 * own, so on a hanging (not refused) connection the first run used to show an empty screen for as
 * long as the request hung. After this wait an unknown list reads as "no farm known" (exactly what a
 * refused request already did); the request is NOT abandoned — a late answer still lands.
 */
export const FARM_LIST_WAIT_MS = 10_000;

export function useFarmContextState(): FarmContextState {
    const { isAuthenticated, session } = useAuth();
    const [myFarms, setMyFarms] = React.useState<MyFarmDto[] | null>(null);
    const [pendingFarms, setPendingFarms] = React.useState<MyFarmDto[]>([]);
    const [currentFarmId, setCurrentFarmId] = React.useState<string | null>(
        () => SessionStore.getCurrentFarmId() || null,
    );
    const [showFirstFarmWizard, setShowFirstFarmWizard] = React.useState(false);
    const [showMinimalOnboarding, setShowMinimalOnboarding] = React.useState(false);
    const [showJoinByCode, setShowJoinByCode] = React.useState(false);
    const [refreshCounter, setRefreshCounter] = React.useState(0);
    // Refetch when an offline presence session is upgraded to a real token
    // (isAuthenticated/userId do not change at that moment).
    const hasRealToken = Boolean(session?.accessToken);
    // The app-wide farm list (/me/context) learns about a joined farm too. Read through a
    // ref: its `refresh` changes identity every fetch (see FarmContext.tsx).
    const farmContext = useOptionalFarmContext();
    const farmContextRef = React.useRef(farmContext);
    farmContextRef.current = farmContext;
    // Round-2 review EDGE-1. Set when `handleWizardComplete` closed the 0-farm screen for a farm the
    // server had ALREADY made and the list went back to "not known yet" (null). If the re-read then
    // fails (offline) or hangs past FARM_LIST_WAIT_MS, nothing confirms a farm: the doors come back
    // (he was on them a moment ago) instead of the empty app with no farm and no way on. Any answer
    // from the server clears it (a farm listed → the first run goes on; none → the doors anyway).
    const doorsUntilListedRef = React.useRef(false);

    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the join door opens on request from
    // anywhere, and by itself right after sign-in when the login screen's join button asked
    // for it (the server answers a code only for a signed-in person).
    React.useEffect(() => {
        const open = () => setShowJoinByCode(true);
        window.addEventListener(OPEN_JOIN_FARM_EVENT, open);
        return () => window.removeEventListener(OPEN_JOIN_FARM_EVENT, open);
    }, []);
    React.useEffect(() => {
        if (isAuthenticated && takeJoinAfterSignIn()) setShowJoinByCode(true);
    }, [isAuthenticated]);

    React.useEffect(() => {
        if (!isAuthenticated) {
            doorsUntilListedRef.current = false;
            setMyFarms(null);
            setPendingFarms([]);
            setShowFirstFarmWizard(false);
            setShowMinimalOnboarding(false);
            setShowJoinByCode(false);
            return;
        }

        let cancelled = false;
        const stopWaiting = () => {
            // A list already on screen stays; only a list still unknown (null) stops being waited for.
            setMyFarms(prev => prev ?? []);
            if (doorsUntilListedRef.current) {
                doorsUntilListedRef.current = false;
                setShowMinimalOnboarding(true);
            }
        };
        const waitTimer = setTimeout(() => {
            if (!cancelled) stopWaiting();
        }, FARM_LIST_WAIT_MS);
        (async () => {
            try {
                const listed = await getMyFarms();
                clearTimeout(waitTimer);
                if (cancelled) return;
                doorsUntilListedRef.current = false;
                // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2) — /farms/mine now lists a
                // typed-code join request too (status PendingApproval). That is not a farm the
                // person is in: the server sends it no data and refuses its writes. So it is never
                // listed, opened or picked as the current farm; it waits in `pendingFarms`.
                const farms = listed.filter(isActiveSeat);
                setMyFarms(farms);
                setPendingFarms(listed.filter(f => !isActiveSeat(f)));

                if (farms.length === 0) {
                    // Show the minimal 2-field onboarding, NOT the heavy wizard.
                    // The heavy wizard (FirstFarmWizard) is still available from the
                    // AppHeader "create farm" affordance (setShowFirstFarmWizard).
                    // A person whose only seat is a pending request still has no farm, so the
                    // 0-farm screen stays (it says the request is waiting) and no farm is picked.
                    setShowMinimalOnboarding(true);
                    return;
                }
                // The 0-farm screen is for a person with no farm. A farm can arrive without the
                // wizard (an owner-approved request, a QR claim), so the server listing one closes it.
                setShowMinimalOnboarding(false);

                if (!currentFarmId || !farms.some(f => f.farmId === currentFarmId)) {
                    const next = farms[0].farmId;
                    setCurrentFarmId(next);
                    SessionStore.setCurrentFarmId(next);
                }
            } catch {
                clearTimeout(waitTimer);
                // A failed RE-read is not "no farms": the list already on screen (for example the
                // farm the server has just created) stays. Only a list never read becomes empty
                // (round-1 review F8a — the new farm used to vanish mid-first-run here).
                if (!cancelled) stopWaiting();
            }
        })();
        return () => { cancelled = true; clearTimeout(waitTimer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshCounter, isAuthenticated, session?.userId, hasRealToken]);

    const handleSwitchFarm = React.useCallback((farmId: string) => {
        setCurrentFarmId(farmId);
        SessionStore.setCurrentFarmId(farmId);
    }, []);

    const handleWizardComplete = React.useCallback((result: BootstrapFirstFarmResponse) => {
        setShowFirstFarmWizard(false);
        setShowMinimalOnboarding(false);
        setCurrentFarmId(result.farmId);
        SessionStore.setCurrentFarmId(result.farmId);
        // spec: plr-d10-redesign-real-integration-2026-10-25 (I16) — the farm the server just made
        // is listed AT ONCE, so the first run goes straight on to फोनच्या परवानग्या instead of
        // flashing the empty app until /farms/mine answers. Only what the server returned: its id,
        // name and code, and the creator's seat (the bootstrap makes him its owner). The re-read
        // below replaces this entry with the server's own.
        //
        // Only for a farm made by THIS call (round-1 review F8b). `wasAlreadyBootstrapped` means the
        // server handed back a farm made earlier — one this person may have left since — so nothing
        // claims he owns it: a list with no farm in it goes back to "not known yet" (the first run
        // waits, bounded by FARM_LIST_WAIT_MS) until the server's own list answers. If it never does
        // (offline, or hung past the wait), the 0-farm doors come back (round-2 review EDGE-1).
        setMyFarms(prev => {
            if (prev?.some(f => f.farmId === result.farmId)) return prev;
            if (result.wasAlreadyBootstrapped) {
                if (prev && prev.length > 0) return prev;
                doorsUntilListedRef.current = true; // EDGE-1: idempotent, safe if React re-runs this
                return null;
            }
            return [...(prev ?? []), {
                farmId: result.farmId,
                name: result.farmName,
                role: 'PrimaryOwner',
                farmCode: result.farmCode,
                subscription: null,
                status: 'Active',
            }];
        });
        setRefreshCounter(x => x + 1);
        // The app-wide farm list (/me/context) learns about the new farm too.
        void farmContextRef.current?.refresh();
    }, []);

    const handleJoinViaQr = React.useCallback(() => {
        setShowJoinByCode(true);
    }, []);

    const closeJoinByCode = React.useCallback(() => {
        setShowJoinByCode(false);
    }, []);

    // A seat on another farm is usually PendingApproval: the lists are re-read from the
    // server, but the open farm is NOT switched — the owner has not let him in yet.
    const handleJoinComplete = React.useCallback((_farm: JoinedFarm) => {
        setRefreshCounter(x => x + 1);
        void farmContextRef.current?.refresh();
    }, []);

    const handleWithdrawRequest = React.useCallback(async (farmId: string) => {
        await exitMembership(farmId);
        setRefreshCounter(x => x + 1);
        void farmContextRef.current?.refresh();
    }, []);

    return {
        myFarms,
        pendingFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        showMinimalOnboarding,
        setShowMinimalOnboarding,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
        showJoinByCode,
        closeJoinByCode,
        handleJoinComplete,
        handleWithdrawRequest,
    };
}
