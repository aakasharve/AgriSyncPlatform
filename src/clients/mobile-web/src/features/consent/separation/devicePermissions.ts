// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// AN OS PERMISSION IS NOT DPDP CONSENT, AND DPDP CONSENT IS NOT AN OS PERMISSION.
//
// They are different acts by different parties: the operating system decides whether an
// app may reach a device; the farmer decides whether we may use what that device produces
// and what for. Treating one as the other is the single most common way a consent flow
// goes wrong, and it goes wrong in both directions:
//
//   • Granting the microphone at onboarding is NOT permission to process his voice. It
//     only means the OS will not block the capture. Purpose comes from the notice.
//   • Refusing the microphone is NOT a withdrawal of consent, and must not be treated as
//     one. It also must not close the app to him — see `MANUAL_ENTRY_ALWAYS_AVAILABLE`.
//
// The rule this module exists to enforce: ask for a device permission AT THE MOMENT THE
// FEATURE IS INVOKED, one at a time, never in a bulk pre-emptive sweep at onboarding. A
// bulk sweep asks for three capabilities before the farmer has seen a single reason to
// grant any of them, which is why it gets refused, and a refusal at that point is a
// refusal he has no context to reconsider.

export type DevicePermissionKind = 'microphone' | 'camera' | 'location';

export type DevicePermissionOutcome =
    /** The OS said yes. Says NOTHING about purpose — that is the notice's job. */
    | 'granted'
    /** The OS (or the farmer through it) said no. NOT a consent withdrawal. */
    | 'denied'
    /** No such capability here: insecure context, WebView without the API, no device. */
    | 'unavailable';

/**
 * Load-bearing invariant, stated as a constant so it is greppable and testable:
 * refusing the microphone must never block manual entry. Every caller that handles a
 * `denied` microphone has to leave a typing route open.
 */
export const MANUAL_ENTRY_ALWAYS_AVAILABLE = true;

/**
 * Ask the OS for ONE capability, now, because the farmer just tried to use the feature
 * that needs it.
 *
 * Never throws — a permission question has three honest answers and an exception is none
 * of them. The caller decides what to do with a refusal, and the only thing it may not do
 * is take away a route that does not need the capability at all.
 */
export async function requestDevicePermission(
    kind: DevicePermissionKind,
): Promise<DevicePermissionOutcome> {
    try {
        if (kind === 'location') {
            if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return 'unavailable';
            return await new Promise<DevicePermissionOutcome>((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    () => resolve('granted'),
                    () => resolve('denied'),
                    { timeout: 10_000 },
                );
            });
        }

        const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
        if (!media || typeof media.getUserMedia !== 'function') return 'unavailable';

        const stream = await media.getUserMedia(
            kind === 'microphone' ? { audio: true } : { video: true });
        // Release immediately. We asked for the PERMISSION, not the live device; leaving
        // the track open is what previously made a later getUserMedia report a false
        // "not granted" (see the note this replaces in OnboardingPermissionsPage).
        stream.getTracks().forEach((track) => track.stop());
        return 'granted';
    } catch {
        return 'denied';
    }
}

/**
 * Read the current state WITHOUT prompting — for showing what is already allowed.
 * Deliberately separate from {@link requestDevicePermission}: a screen that reads state
 * must not be able to trigger a prompt as a side effect of rendering.
 */
export async function readDevicePermission(
    kind: DevicePermissionKind,
): Promise<DevicePermissionOutcome | 'prompt'> {
    try {
        if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unavailable';
        const name = kind === 'location' ? 'geolocation' : kind;
        const status = await navigator.permissions.query({ name: name as PermissionName });
        if (status.state === 'granted') return 'granted';
        if (status.state === 'denied') return 'denied';
        return 'prompt';
    } catch {
        // Firefox and several WebViews refuse to answer for microphone/camera. Unknown
        // is not "denied" — reporting it as denied would hide a working feature.
        return 'unavailable';
    }
}
