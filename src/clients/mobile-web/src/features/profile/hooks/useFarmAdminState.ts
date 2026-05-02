/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from ProfilePage.tsx.
 *
 * Owns the farm-admin slice of ProfilePage state:
 *   - canonical farm snapshot (myFarm) + memberships,
 *   - farm details (boundary + canonical centre),
 *   - farm-boundary draw modal toggles,
 *   - weather connection state,
 *   - exit-membership flow + invite-QR opener.
 */

import React from 'react';
import type { PlotGeoData } from '../../../types';
import { useUiPref } from '../../../shared/hooks/useUiPref';
import {
    getFarmDetails,
    probeFarmWeather,
    updateFarmBoundary,
    type FarmDetailsDto,
    type MyFarmDto,
} from '../../onboarding/qr/inviteApi';
import type { SubscriptionSnapshotView } from '../../admin/billing/EntitlementBanner';

const weatherConnectedKey = (farmId: string) => `farm:weatherConnected:${farmId}`;

export interface MyFarmSummary {
    farmId: string;
    name: string;
    role: string;
    subscription: SubscriptionSnapshotView | null;
}

export interface UseFarmAdminStateResult {
    myFarm: MyFarmSummary | null;
    setMyFarm: React.Dispatch<React.SetStateAction<MyFarmSummary | null>>;
    myMemberships: MyFarmDto[];
    setMyMemberships: React.Dispatch<React.SetStateAction<MyFarmDto[]>>;
    farmLookupError: string | null;
    farmDetails: FarmDetailsDto | null;
    showFarmBoundary: boolean;
    setShowFarmBoundary: React.Dispatch<React.SetStateAction<boolean>>;
    savingBoundary: boolean;
    boundaryError: string | null;
    setBoundaryError: React.Dispatch<React.SetStateAction<string | null>>;
    weatherConnected: boolean;
    connectingWeather: boolean;
    connectError: string | null;
    showInviteQr: boolean;
    setShowInviteQr: React.Dispatch<React.SetStateAction<boolean>>;
    handleOpenInviteQr: () => Promise<void>;
    handleSaveFarmBoundary: (geoData: PlotGeoData) => Promise<void>;
    handleFinishFarmBoundary: () => void;
    handleConnectWeather: () => Promise<void>;
    handleExitMembership: (farmId: string, _farmName: string) => Promise<void>;
}

export function useFarmAdminState(): UseFarmAdminStateResult {
    const [myFarm, setMyFarm] = React.useState<MyFarmSummary | null>(null);
    const [myMemberships, setMyMemberships] = React.useState<MyFarmDto[]>([]);
    const [farmLookupError, setFarmLookupError] = React.useState<string | null>(null);
    const [farmDetails, setFarmDetails] = React.useState<FarmDetailsDto | null>(null);
    const [showFarmBoundary, setShowFarmBoundary] = React.useState(false);
    const [savingBoundary, setSavingBoundary] = React.useState(false);
    const [boundaryError, setBoundaryError] = React.useState<string | null>(null);
    const [showInviteQr, setShowInviteQr] = React.useState(false);

    // Per-farm weather flag — useUiPref keys swap automatically when farmId
    // changes; sentinel key when no farm is loaded keeps the hook unconditional.
    const weatherPrefKey = weatherConnectedKey(myFarm?.farmId ?? '__no_farm__');
    const [weatherConnectedRaw, setWeatherConnectedPref] = useUiPref<boolean>(weatherPrefKey, false);
    const weatherConnected = myFarm?.farmId ? weatherConnectedRaw : false;
    const [connectingWeather, setConnectingWeather] = React.useState(false);
    const [connectError, setConnectError] = React.useState<string | null>(null);

    // Lazy farm-snapshot loader so the entitlement banner shows on mount.
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { getMyFarms } = await import('../../onboarding/qr/inviteApi');
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyMemberships(farms);
                if (farms.length === 0) return;
                const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
                setMyFarm(prev => prev ?? {
                    farmId: ownerFarm.farmId,
                    name: ownerFarm.name,
                    role: ownerFarm.role,
                    subscription: ownerFarm.subscription ?? null,
                });
            } catch {
                /* silent — user may not be authenticated yet */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    React.useEffect(() => {
        if (!myFarm?.farmId) { setFarmDetails(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const dto = await getFarmDetails(myFarm.farmId);
                if (!cancelled) setFarmDetails(dto);
            } catch {
                if (!cancelled) setFarmDetails(null);
            }
        })();
        return () => { cancelled = true; };
    }, [myFarm?.farmId]);

    const handleOpenInviteQr = React.useCallback(async () => {
        setFarmLookupError(null);
        if (myFarm) {
            setShowInviteQr(true);
            return;
        }
        try {
            const { getMyFarms } = await import('../../onboarding/qr/inviteApi');
            const farms = await getMyFarms();
            if (farms.length === 0) {
                setFarmLookupError('You do not own a farm yet. Ask for help to set one up.');
                return;
            }
            const ownerFarm = farms.find(f => f.role === 'PrimaryOwner' || f.role === 'SecondaryOwner') ?? farms[0];
            setMyFarm({
                farmId: ownerFarm.farmId,
                name: ownerFarm.name,
                role: ownerFarm.role,
                subscription: ownerFarm.subscription ?? null,
            });
            setShowInviteQr(true);
        } catch (err) {
            setFarmLookupError(err instanceof Error ? err.message : 'Could not load your farm.');
        }
    }, [myFarm]);

    const handleSaveFarmBoundary = React.useCallback(async (geoData: PlotGeoData) => {
        if (!myFarm?.farmId || savingBoundary) return;
        setSavingBoundary(true);
        setBoundaryError(null);
        try {
            const updated = await updateFarmBoundary(myFarm.farmId, {
                boundary: geoData.boundary.map(p => ({ lat: p.lat, lng: p.lng })),
                centre: { lat: geoData.center.lat, lng: geoData.center.lng },
                areaAcres: Number(geoData.calculatedAreaAcres.toFixed(4)),
            });
            setFarmDetails(updated);
        } catch (err) {
            const message = err instanceof Error ? err.message
                : (typeof err === 'object' && err && 'message' in err) ? String((err as { message: unknown }).message)
                : 'Could not save farm boundary.';
            setBoundaryError(message);
        } finally {
            setSavingBoundary(false);
        }
    }, [myFarm?.farmId, savingBoundary]);

    const handleFinishFarmBoundary = React.useCallback(() => {
        setShowFarmBoundary(false);
        setBoundaryError(null);
    }, []);

    const handleConnectWeather = React.useCallback(async () => {
        if (!myFarm?.farmId || connectingWeather) return;
        setConnectingWeather(true);
        setConnectError(null);
        try {
            await probeFarmWeather(myFarm.farmId);
            setWeatherConnectedPref(true);
            window.setTimeout(() => window.location.reload(), 200);
        } catch (err) {
            const apiErr = err as { error?: string; message?: string };
            if (apiErr?.error === 'ShramSafal.WeatherProviderNotConfigured') {
                setConnectError(
                    'Weather provider not yet available — your boundary is saved. We\'ll auto-enable live weather as soon as the provider key is configured.',
                );
            } else if (apiErr?.error === 'ShramSafal.FarmCentreMissing') {
                setConnectError('Farm boundary missing. Please draw the boundary first.');
            } else {
                setConnectError(apiErr?.message ?? 'Could not connect weather. Please try again.');
            }
        } finally {
            setConnectingWeather(false);
        }
    }, [myFarm?.farmId, connectingWeather, setWeatherConnectedPref]);

    const handleExitMembership = React.useCallback(async (farmId: string, _farmName: string) => {
        const { exitMembership, getMyFarms, isInviteApiError } = await import('../../onboarding/qr/inviteApi');
        try {
            await exitMembership(farmId);
            const refreshed = await getMyFarms();
            setMyMemberships(refreshed);
            if (myFarm?.farmId === farmId) {
                setMyFarm(null);
            }
        } catch (err) {
            const message = isInviteApiError(err) ? err.message : 'Exit failed.';
            throw new Error(message);
        }
    }, [myFarm?.farmId]);

    return {
        myFarm, setMyFarm,
        myMemberships, setMyMemberships,
        farmLookupError,
        farmDetails,
        showFarmBoundary, setShowFarmBoundary,
        savingBoundary, boundaryError, setBoundaryError,
        weatherConnected, connectingWeather, connectError,
        showInviteQr, setShowInviteQr,
        handleOpenInviteQr,
        handleSaveFarmBoundary,
        handleFinishFarmBoundary,
        handleConnectWeather,
        handleExitMembership,
    };
}
