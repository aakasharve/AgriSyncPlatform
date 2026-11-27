// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A)
//
// AFTER SIGN-IN: write the permissions page's two switches as he left them - but never over a choice he made before.
//
// The page opens before the OTP, so it cannot know whose number this is (start-otp deliberately does not say whether an
// account exists). A NEW account has made no choice: the page's switches are his first and only choice, ON unless he
// turned one off. An EXISTING account may already have chosen, in the app's "गोपनीयता व संमती" or on the one-time notice
// sheet; this page must not turn such a choice over (the page says so: `earlierChoiceStays`). So each switch is written
// only where the server holds NO earlier choice for it:
//   - improvement: `chosenAtUtc` is null (the server's own "never chose");
//   - playback: the consent row was never touched (OFF, no accepted / revoked time, no wording version).
//
// A BACKGROUND RECONCILIATION, like the consent link (`consentGateLinkReconciler.ts` - read its header): never rejects,
// nothing awaits it, it renders nothing. Offline or a failed write leaves the choices held; the next app start (or the
// phone coming online) tries again. Each try reads the server first, so a replay never changes anything twice.

import {
    claimHeldSwitchChoices,
    clearHeldSwitchChoices,
    readHeldSwitchChoices,
} from '../../../infrastructure/storage/HeldSwitchChoicesStore';
import type {
    ConsentStateDto,
    ImprovementPermissionDto,
    SetImprovementPermissionRequest,
    UpdateConsentRequest,
} from '../../../infrastructure/api/consentDtos';
import { APP_VERSION } from '../../../infrastructure/api/transport';
import { IMPROVEMENT_WORDING_VERSION, VOICE_RETENTION_WORDING_VERSION } from '../improvement/improvementPermissionCopy';

export interface SwitchApi {
    getConsent(): Promise<ConsentStateDto>;
    updateConsent(request: UpdateConsentRequest): Promise<ConsentStateDto>;
    getImprovementPermission(): Promise<ImprovementPermissionDto>;
    setImprovementPermission(request: SetImprovementPermissionRequest): Promise<ImprovementPermissionDto>;
}

export type HeldSwitchOutcome = 'nothing-pending' | 'no-account' | 'offline' | 'other-account' | 'applied' | 'deferred';

/** The playback switch was never touched on the server: no choice of his to keep. */
export const playbackNeverChosen = (c: ConsentStateDto): boolean =>
    c.fullHistoryJournal === false
    && !c.fullHistoryJournalWordingVersion
    && (c.acceptedAtUtc ?? null) === null
    && (c.revokedAtUtc ?? null) === null;

let inFlight: Promise<HeldSwitchOutcome> | null = null;

/** Writes the held choices for `userId`. One attempt at a time. NEVER rejects. */
export function applyHeldSwitchChoices(
    userId: string | null | undefined,
    api: SwitchApi,
    onPlaybackGranted?: () => void,
): Promise<HeldSwitchOutcome> {
    if (inFlight) return inFlight;
    const attempt = run(userId, api, onPlaybackGranted).catch((): HeldSwitchOutcome => 'deferred');
    inFlight = attempt.finally(() => { inFlight = null; });
    return inFlight;
}

export function __resetHeldSwitchChoicesForTests(): void {
    inFlight = null;
}

async function run(userId: string | null | undefined, api: SwitchApi, onPlaybackGranted?: () => void): Promise<HeldSwitchOutcome> {
    if (!userId) return 'no-account';
    const held = await readHeldSwitchChoices();
    if (!held) return 'nothing-pending';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    // The acceptance (and its choices) belongs to the first account that came out of that sign-in; never to another.
    if (held.claimedByUserId && held.claimedByUserId !== userId) return 'other-account';
    const claimed = (await claimHeldSwitchChoices(userId)) ?? held;

    try {
        const improvement = await api.getImprovementPermission();
        if (improvement.chosenAtUtc === null) {
            await api.setImprovementPermission({
                allowed: claimed.improvement,
                wordingVersion: IMPROVEMENT_WORDING_VERSION,
                languageShown: claimed.language,
            });
        }

        const consent = await api.getConsent();
        if (claimed.voicePlayback && playbackNeverChosen(consent)) {
            await api.updateConsent({
                fullHistoryJournal: true,
                languageShown: claimed.language === 'en' ? 'en-IN' : 'mr-IN',
                consentTextVersion: consent.version,
                clientAppVersion: APP_VERSION,
                fullHistoryJournalWordingVersion: VOICE_RETENTION_WORDING_VERSION,
            });
            onPlaybackGranted?.();
        }
    } catch {
        return 'deferred'; // nothing cleared, nothing shown: the next start tries again
    }

    await clearHeldSwitchChoices(claimed.preRegistrationSessionId);
    return 'applied';
}
