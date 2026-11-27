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
import { isActiveSeat } from '../../../core/session/seatStatus';
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
    /**
     * The farm OPEN in the app (repair FIX-1 item 2, R2-A 03 + 20): the same farm the header and the
     * switcher show, read from the app's farm context. Null while the farm lists have not answered,
     * or when the open farm is not one of my active seats. Never "the first farm I own".
     */
    myFarm: MyFarmSummary | null;
    myMemberships: MyFarmDto[];
    setMyMemberships: React.Dispatch<React.SetStateAction<MyFarmDto[]>>;
    /**
     * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — seats that have not ended but grant nothing
     * yet (a typed-code request waiting for the owner, a paused seat). Never in `myMemberships`;
     * listed apart so a request can be withdrawn (M1) and a pause is said as a pause.
     */
    pendingSeats: MyFarmDto[];
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

function summaryOf(f: MyFarmDto): MyFarmSummary {
    return { farmId: f.farmId, name: f.name, role: f.role, subscription: f.subscription ?? null };
}

/** @param appFarmId the farm open in the app (`useFarmContext`), the one the header shows. */
export function useFarmAdminState(appFarmId: string | null): UseFarmAdminStateResult {
    const [myMemberships, setMyMemberships] = React.useState<MyFarmDto[]>([]);
    const openSeat = myMemberships.find(f => f.farmId === appFarmId) ?? null;
    const myFarm = React.useMemo(() => (openSeat ? summaryOf(openSeat) : null), [openSeat]);
    const [pendingSeats, setPendingSeats] = React.useState<MyFarmDto[]>([]);
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
                // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2/F3) — Active seats only: a
                // typed-code request waiting for the owner is not a farm to open, label or pick.
                // It is kept apart (pendingSeats) so it can still be seen and withdrawn.
                const listed = await getMyFarms();
                const farms = listed.filter(isActiveSeat);
                if (cancelled) return;
                setMyMemberships(farms);
                setPendingSeats(listed.filter(f => !isActiveSeat(f)));
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
            const farms = (await getMyFarms()).filter(isActiveSeat);
            setMyMemberships(farms);
            // The QR is the OPEN farm's (never another farm I happen to own).
            if (!farms.some(f => f.farmId === appFarmId)) {
                setFarmLookupError('You do not own a farm yet. Ask for help to set one up.');
                return;
            }
            setShowInviteQr(true);
        } catch (err) {
            setFarmLookupError(err instanceof Error ? err.message : 'Could not load your farm.');
        }
    }, [myFarm, appFarmId]);

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
            // pilot lane IDENT (S7): the KIND of problem; the farm page says it in the app's language (the server's words are English).
            if (apiErr?.error === 'ShramSafal.WeatherProviderNotConfigured') {
                setConnectError('providerNotConfigured');
            } else if (apiErr?.error === 'ShramSafal.FarmCentreMissing') {
                setConnectError('centreMissing');
            } else {
                setConnectError('failed');
            }
        } finally {
            setConnectingWeather(false);
        }
    }, [myFarm?.farmId, connectingWeather, setWeatherConnectedPref]);

    const handleExitMembership = React.useCallback(async (farmId: string, _farmName: string) => {
        const { exitMembership, getMyFarms, isInviteApiError } = await import('../../onboarding/qr/inviteApi');
        try {
            await exitMembership(farmId);
            const listed = await getMyFarms();
            const refreshed = listed.filter(isActiveSeat);
            // The exited farm leaves the list, so it can no longer be the hub's farm.
            setMyMemberships(refreshed);
            setPendingSeats(listed.filter(f => !isActiveSeat(f)));
        } catch (err) {
            const message = isInviteApiError(err) ? err.message : 'Exit failed.';
            throw new Error(message);
        }
    }, []);

    return {
        myFarm,
        myMemberships, setMyMemberships,
        pendingSeats,
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
