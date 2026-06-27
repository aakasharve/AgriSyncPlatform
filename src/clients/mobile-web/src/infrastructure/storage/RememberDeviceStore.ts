/**
 * RememberDeviceStore — persists the "remember this device" user preference.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 *
 * This is a boolean preference flag (not a credential or token). Stored in
 * localStorage under infrastructure/storage/ per the storage-discipline gate.
 * The flag is read by AgriSyncClient.refreshSession() to send the correct
 * rememberDevice value to the backend so the HttpOnly cookie gets the right
 * expiry (session-cookie when false, persistent when true).
 */

const REMEMBER_DEVICE_KEY = 'agrisync_remember_device_v1';

export function getRememberDevice(): boolean {
    try {
        return localStorage.getItem(REMEMBER_DEVICE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setRememberDevice(value: boolean): void {
    try {
        localStorage.setItem(REMEMBER_DEVICE_KEY, value ? 'true' : 'false');
    } catch {
        // ignore storage errors
    }
}

export function clearRememberDevice(): void {
    try {
        localStorage.removeItem(REMEMBER_DEVICE_KEY);
    } catch {
        // ignore
    }
}
