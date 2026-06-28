/**
 * DeviceIdStore
 *
 * Purpose-named storage adapter for the offline mutation queue's stable device
 * id. Kept synchronous because MutationQueue needs this value while building
 * queued command rows.
 */

const DEVICE_ID_KEY = 'agrisync_device_id_v1';

export function readDeviceId(): string | null {
    return localStorage.getItem(DEVICE_ID_KEY);
}

export function writeDeviceId(deviceId: string): void {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
}

/**
 * Returns the existing device id, or creates and persists a new one on first
 * call. Key: agrisync_device_id_v1. Fallback (no crypto.randomUUID): dev-<ms>.
 *
 * Single canonical implementation — import this everywhere instead of
 * duplicating the read-or-create logic. MutationQueue intentionally keeps its
 * own copy (uses idGenerator.generate(), a different sync source) so leave that
 * file alone.
 *
 * spec: secure-remembered-device-sessions-2026-06-24
 */
export function getOrCreateDeviceId(): string {
    let id = readDeviceId();
    if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `dev-${Date.now()}`;
        writeDeviceId(id);
    }
    return id;
}

