/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 4) - runs the one-time upload of the old local to-dos
 * (`legacyTodoUpload.ts`) once per sign-in and farm, after the first successful sync (`agrisync:sync-reconciled`). Never in demo mode
 * (demo data is never sent to a server), never signed out, and not again for a farm whose upload finished. A failure leaves everything as
 * it was (the old copy stays) and is tried again after the next sync.
 */
import { useEffect, useRef } from 'react';
import { legacyUploadIsDone, uploadLegacyTodos } from './legacyTodoUpload';

export interface LegacyTodoUploadArgs {
    farmId: string | null;
    userId: string | null;
    isDemoMode: boolean;
    isAuthenticated: boolean;
}

export function useLegacyTodoUpload({ farmId, userId, isDemoMode, isAuthenticated }: LegacyTodoUploadArgs): void {
    const finishedFor = useRef<string | null>(null);

    useEffect(() => {
        if (isDemoMode || !isAuthenticated || !farmId || !userId) return undefined;
        const key = `${userId}:${farmId}`;
        let alive = true;
        const afterSync = () => {
            if (!alive || finishedFor.current === key) return;
            void (async () => {
                try {
                    if (await legacyUploadIsDone(farmId)) { finishedFor.current = key; return; }
                    const result = await uploadLegacyTodos({ farmId });
                    if (result.waiting === 0) finishedFor.current = key;
                } catch (error) {
                    console.warn(JSON.stringify({ component: 'useLegacyTodoUpload', action: 'upload_failed', message: error instanceof Error ? error.message : String(error) }));
                }
            })();
        };
        window.addEventListener('agrisync:sync-reconciled', afterSync);
        return () => {
            alive = false;
            window.removeEventListener('agrisync:sync-reconciled', afterSync);
        };
    }, [farmId, userId, isDemoMode, isAuthenticated]);
}
