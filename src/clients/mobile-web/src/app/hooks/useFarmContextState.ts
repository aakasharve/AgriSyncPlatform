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
 *   - 3 user actions: switch / wizard-complete / join-via-QR.
 */

import React from 'react';
import { SessionStore } from '../../infrastructure/storage/SessionStore';
import { useAuth } from '../providers/AuthProvider';
import {
    getMyFarms,
    type BootstrapFirstFarmResponse,
    type MyFarmDto,
} from '../../features/onboarding/qr/inviteApi';

export interface FarmContextState {
    myFarms: MyFarmDto[] | null;
    currentFarmId: string | null;
    showFirstFarmWizard: boolean;
    setShowFirstFarmWizard: React.Dispatch<React.SetStateAction<boolean>>;
    /** True when the user has 0 farms — shows the minimal 2-field onboarding. */
    showMinimalOnboarding: boolean;
    setShowMinimalOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
    handleSwitchFarm: (farmId: string) => void;
    handleWizardComplete: (result: BootstrapFirstFarmResponse) => void;
    handleJoinViaQr: () => void;
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
 * The join-via-QR prompt flow, extracted to a standalone, stateless
 * function (Task 12) so `SetupHubMenu.tsx`'s new farm-switcher row can call
 * the EXACT same logic `AppHeader`'s farm switcher already uses — not a
 * second, independently-typed copy that could drift. Pure: reads only
 * `window.prompt`/`window.location`, no closure over this hook's state.
 */
export function promptAndJoinFarmViaQr(): void {
    // Deep-link: JoinFarmLandingPage expects `?join=<token>&farm=<code>`.
    // Without a scanner, prompt the user to paste the link.
    const link = window.prompt(
        'तुमच्या मालकाने शेअर केलेली QR लिंक पेस्ट करा\nPaste the QR link shared by the farmer:',
    );
    if (!link) return;
    try {
        const url = new URL(link.trim());
        const token = url.searchParams.get('t') ?? url.searchParams.get('join');
        const farm = url.searchParams.get('f') ?? url.searchParams.get('farm');
        if (token && farm) {
            window.location.assign(
                `/?join=${encodeURIComponent(token)}&farm=${encodeURIComponent(farm)}`,
            );
            return;
        }
    } catch { /* fall through to alert */ }
    window.alert('Link not recognised. Ask the farmer to share it again.');
}

export function useFarmContextState(): FarmContextState {
    const { isAuthenticated, session } = useAuth();
    const [myFarms, setMyFarms] = React.useState<MyFarmDto[] | null>(null);
    const [currentFarmId, setCurrentFarmId] = React.useState<string | null>(
        () => SessionStore.getCurrentFarmId() || null,
    );
    const [showFirstFarmWizard, setShowFirstFarmWizard] = React.useState(false);
    const [showMinimalOnboarding, setShowMinimalOnboarding] = React.useState(false);
    const [refreshCounter, setRefreshCounter] = React.useState(0);

    React.useEffect(() => {
        if (!isAuthenticated) {
            setMyFarms(null);
            setShowFirstFarmWizard(false);
            setShowMinimalOnboarding(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyFarms(farms);

                if (farms.length === 0) {
                    // Show the minimal 2-field onboarding, NOT the heavy wizard.
                    // The heavy wizard (FirstFarmWizard) is still available from the
                    // AppHeader "create farm" affordance (setShowFirstFarmWizard).
                    setShowMinimalOnboarding(true);
                    return;
                }

                if (!currentFarmId || !farms.some(f => f.farmId === currentFarmId)) {
                    const next = farms[0].farmId;
                    setCurrentFarmId(next);
                    SessionStore.setCurrentFarmId(next);
                }
            } catch {
                if (!cancelled) setMyFarms([]);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshCounter, isAuthenticated, session?.userId]);

    const handleSwitchFarm = React.useCallback((farmId: string) => {
        setCurrentFarmId(farmId);
        SessionStore.setCurrentFarmId(farmId);
    }, []);

    const handleWizardComplete = React.useCallback((result: BootstrapFirstFarmResponse) => {
        setShowFirstFarmWizard(false);
        setShowMinimalOnboarding(false);
        setCurrentFarmId(result.farmId);
        SessionStore.setCurrentFarmId(result.farmId);
        setRefreshCounter(x => x + 1);
    }, []);

    // Task 12 — now a thin call into the standalone, exported
    // `promptAndJoinFarmViaQr()` above, so `SetupHubMenu.tsx`'s new row can
    // reuse the identical flow without duplicating it.
    const handleJoinViaQr = React.useCallback(() => {
        promptAndJoinFarmViaQr();
    }, []);

    return {
        myFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        showMinimalOnboarding,
        setShowMinimalOnboarding,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
    };
}
