// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// Where the held switch choices are written from: beside the auth state, exactly like the consent link
// (`useConsentGateLink.ts` - one trigger: whenever a signed-in user id appears, and again when the phone comes online).
// It observes the auth state; it can never delay or break a sign-in. Renders nothing, reports nothing.

import { useEffect } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { publishPlaybackSwitch } from '../../logs/components/voiceResult/playbackSwitch';
import { applyHeldSwitchChoices } from './heldSwitchChoices';

export function useHeldSwitchChoices(userId: string | null | undefined): void {
    useEffect(() => {
        if (!userId) return;
        const attempt = () => {
            try {
                void applyHeldSwitchChoices(userId, agriSyncClient, () => publishPlaybackSwitch(true)).catch(() => { /* never surfaces */ });
            } catch {
                /* never surfaces */
            }
        };
        attempt();
        if (typeof window === 'undefined') return;
        window.addEventListener('online', attempt);
        return () => window.removeEventListener('online', attempt);
    }, [userId]);
}
