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
    handleSwitchFarm: (farmId: string) => void;
    handleWizardComplete: (result: BootstrapFirstFarmResponse) => void;
    handleJoinViaQr: () => void;
}

export function useFarmContextState(): FarmContextState {
    const { isAuthenticated, session } = useAuth();
    const [myFarms, setMyFarms] = React.useState<MyFarmDto[] | null>(null);
    const [currentFarmId, setCurrentFarmId] = React.useState<string | null>(
        () => SessionStore.getCurrentFarmId() || null,
    );
    const [showFirstFarmWizard, setShowFirstFarmWizard] = React.useState(false);
    const [refreshCounter, setRefreshCounter] = React.useState(0);

    React.useEffect(() => {
        if (!isAuthenticated) {
            setMyFarms(null);
            setShowFirstFarmWizard(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyFarms(farms);

                if (farms.length === 0) {
                    setShowFirstFarmWizard(true);
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
        setCurrentFarmId(result.farmId);
        SessionStore.setCurrentFarmId(result.farmId);
        setRefreshCounter(x => x + 1);
    }, []);

    const handleJoinViaQr = React.useCallback(() => {
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
    }, []);

    return {
        myFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
    };
}
