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

