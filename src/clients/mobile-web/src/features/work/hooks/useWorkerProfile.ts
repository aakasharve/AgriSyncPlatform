/**
 * useWorkerProfile — Dexie-first cache, then server sync.
 * CEI Phase 4 §4.8
 */

import { useCallback, useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { WorkerProfileData } from '../../../domain/work/ReliabilityScore';
import type { JobCard } from '../../../domain/work/JobCard';
import { getWorkerProfile, getWorkerJobCards } from '../data/workerProfileClient';

interface UseWorkerProfileResult {
    profile: WorkerProfileData | null;
    recentCards: JobCard[];
    isLoading: boolean;
    refresh: () => void;
}

export function useWorkerProfile(
    userId: string | null,
    farmId: string | null,
): UseWorkerProfileResult {
    const [profile, setProfile] = useState<WorkerProfileData | null>(null);
    const [recentCards, setRecentCards] = useState<JobCard[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick(t => t + 1), []);

    useEffect(() => {
        if (!userId || !farmId) {
            setProfile(null);
            setRecentCards([]);
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        const loadCached = async () => {
            const db = getDatabase();
            const cached = await db.workerProfiles.get(userId);
            if (!cancelled && cached) {
                setProfile(cached.data);
                setIsLoading(false);
            }

            // Load job cards from Dexie (last 20 for this worker)
            const cards = await db.jobCards
                .where('assignedWorkerUserId').equals(userId)
                .toArray();
            const sorted = (cards as unknown as JobCard[])
                .sort((a, b) => b.modifiedAtUtc.localeCompare(a.modifiedAtUtc))
                .slice(0, 20);
            if (!cancelled) {
                setRecentCards(sorted);
                setIsLoading(false);
            }
        };

        const loadFromServer = async () => {
            try {
                const [freshProfile, freshCards] = await Promise.all([
                    getWorkerProfile(userId, farmId),
                    getWorkerJobCards(userId),
                ]);
                if (cancelled) return;

                const db = getDatabase();
                await db.workerProfiles.put({
                    workerUserId: userId,
                    scopedFarmId: farmId,
                    data: freshProfile,
                    cachedAtUtc: new Date().toISOString(),
                });

                setProfile(freshProfile);
                const sorted = [...freshCards]
                    .sort((a, b) => b.modifiedAtUtc.localeCompare(a.modifiedAtUtc))
                    .slice(0, 20);
                setRecentCards(sorted);
            } catch {
                // Server unavailable — cached data shown
            }
        };

        loadCached().then(() => loadFromServer());

        return () => { cancelled = true; };
    }, [userId, farmId, tick]);

    return { profile, recentCards, isLoading, refresh };
}
