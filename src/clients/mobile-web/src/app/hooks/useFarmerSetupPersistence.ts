// spec: plr-d10-redesign-real-integration-2026-10-25 (I3 — X2)
//
// The farmer's setup — water sources, motors, the electricity timetable, machines, land,
// village, trust settings — lived in React state only. Every edit on the setup pages was
// lost the moment the app closed, and the only thing that ever wrote the profile to the
// phone was the sync reconciler, which preserves those fields but never received an edit.
//
// This writes each edit to the phone. Two things it deliberately does NOT do:
//   • It never saves the in-memory `operators`. People added on this phone carry roles and
//     wages; they must come from the server (doctrine P10, Labour V1), so the stored list —
//     what the last sync downloaded — is kept as it is.
//   • It never writes back what it just read. A profile loaded from the phone (or refreshed
//     by a sync) is remembered as "stored", so only a change made AFTER that is saved.
//
// On this phone only: nothing here reaches the server (PENDING D-9 decides whether a
// second phone of the farm should see the same setup).

import { useCallback, useEffect, useRef } from 'react';
import type { FarmerProfile } from '../../types';
import type { AppDataSource } from '../../application/ports/AppDataSource';

interface Options {
    farmerProfile: FarmerProfile;
    dataSource: AppDataSource;
    isDemoMode: boolean;
    /** True once the first load from the phone has finished — nothing is saved before it. */
    dataLoaded: boolean;
}

export interface FarmerSetupPersistence {
    /** Call with a profile that was just READ from the phone, before putting it in state. */
    noteStoredProfile: (profile: FarmerProfile) => void;
}

async function saveFarmerSetup(dataSource: AppDataSource, next: FarmerProfile): Promise<void> {
    try {
        const stored = await dataSource.profile.get();
        await dataSource.profile.save({ ...next, operators: stored?.operators ?? [] });
    } catch (err) {
        console.error('[useFarmerSetupPersistence] could not save the farm setup', err);
    }
}

export function useFarmerSetupPersistence({
    farmerProfile, dataSource, isDemoMode, dataLoaded,
}: Options): FarmerSetupPersistence {
    const lastStored = useRef<string | null>(null);

    const noteStoredProfile = useCallback((profile: FarmerProfile) => {
        lastStored.current = JSON.stringify(profile);
    }, []);

    useEffect(() => {
        if (isDemoMode || !dataLoaded) return;
        const current = JSON.stringify(farmerProfile);
        if (lastStored.current === null) {
            // First look after loading: this is what the phone already holds.
            lastStored.current = current;
            return;
        }
        if (current === lastStored.current) return;
        lastStored.current = current;
        void saveFarmerSetup(dataSource, farmerProfile);
    }, [farmerProfile, dataSource, isDemoMode, dataLoaded]);

    return { noteStoredProfile };
}
