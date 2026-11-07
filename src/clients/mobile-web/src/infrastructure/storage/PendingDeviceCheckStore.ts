// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
//
// The one-time new-phone question, while it is open on this phone. A sign-in (SMS code or the test password) or a
// boot refresh whose answer says `deviceCheckRequired` puts the question here INSTEAD of storing a session: the
// server's token for such a phone opens nothing, and keeping it out of AuthTokenStore keeps the app signed out —
// no farm list, no sync, no download — until the person answers. AuthProvider listens and shows the question.
//
// In memory only, on purpose. The server is the truth: on a reload or a cold start the boot refresh asks again and
// puts the question back. Nothing about the question is written to the device.

export interface PendingDeviceCheck {
    userId: string;
    /** The account's display name, for "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?". */
    accountName: string;
}

/**
 * The two fields a sign-in or refresh answer carries for the question (`AuthResponseDto`, `VerifyOtpResponse`). Absent on
 * a server from before the question = not asked.
 */
export interface HeldSignInFields {
    /** true: this phone has not answered; its token opens nothing, so NO session is stored and the question is asked. */
    deviceCheckRequired?: boolean;
    /** The account's display name for the question; null unless it is open. */
    accountName?: string | null;
}

export const DEVICE_CHECK_CHANGED_EVENT = 'agrisync:device-check-changed';

let pending: PendingDeviceCheck | null = null;

function notify(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(DEVICE_CHECK_CHANGED_EVENT));
    }
}

/** The server said this phone has not answered yet: ask. */
export function askDeviceCheck(check: PendingDeviceCheck): void {
    pending = { userId: check.userId, accountName: check.accountName };
    notify();
}

export function getPendingDeviceCheck(): PendingDeviceCheck | null {
    return pending;
}

/** Answered (होय → a real session follows; नाही → signed out), or the sign-in was abandoned. */
export function clearPendingDeviceCheck(): void {
    if (pending === null) return;
    pending = null;
    notify();
}
