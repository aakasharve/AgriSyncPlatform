import { systemClock } from '../../core/domain/services/Clock';
import { createDeviceServices, type DeviceLocationService } from '../../infrastructure/device';
import {
    getDatabase,
    GPS_CONSENT_META_KEY,
    type GpsConsentDecision,
    type GpsConsentMetaValue,
} from '../../infrastructure/storage/DexieDatabase';
import type { SyncLocationPayload } from '../../infrastructure/sync/MutationQueue';

export interface CaptureLocationOptions {
    consentDecision?: GpsConsentDecision;
    highAccuracy?: boolean;
    timeoutMs?: number;
    locationService?: DeviceLocationService;
}

const DEFAULT_TIMEOUT_MS = 1200;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), timeoutMs);
        promise
            .then(value => resolve(value))
            .catch(() => resolve(null))
            .finally(() => window.clearTimeout(timer));
    });
}

function toConsentMeta(decision: GpsConsentDecision): GpsConsentMetaValue {
    return {
        askedAt: systemClock.nowISO(),
        decision,
    };
}

async function saveConsentDecision(decision: GpsConsentDecision): Promise<void> {
    const db = getDatabase();
    await db.appMeta.put({
        key: GPS_CONSENT_META_KEY,
        value: toConsentMeta(decision),
        updatedAt: systemClock.nowISO(),
    });
}

export async function getGpsConsentState(): Promise<GpsConsentMetaValue | null> {
    const db = getDatabase();
    const stored = await db.appMeta.get(GPS_CONSENT_META_KEY);
    const value = stored?.value as GpsConsentMetaValue | undefined;
    return value ?? null;
}

export async function setGpsConsentDecision(decision: GpsConsentDecision): Promise<void> {
    await saveConsentDecision(decision);
}

export async function captureLocation(options: CaptureLocationOptions = {}): Promise<SyncLocationPayload | null> {
    const db = getDatabase();
    const locationService = options.locationService ?? createDeviceServices().location;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const stored = await db.appMeta.get(GPS_CONSENT_META_KEY);
    const storedConsent = (stored?.value as GpsConsentMetaValue | undefined)?.decision;
    const decision = options.consentDecision ?? storedConsent;

    if (!decision) {
        await saveConsentDecision('later');
        return null;
    }

    if (decision !== 'granted') {
        await saveConsentDecision(decision);
        return null;
    }

    await saveConsentDecision('granted');

    try {
        let permission = await locationService.checkPermission();
        if (permission.location !== 'granted') {
            permission = await locationService.requestPermission();
        }

        if (permission.location !== 'granted') {
            await saveConsentDecision('denied');
            return null;
        }

        const snapshot = await withTimeout(
            locationService.getCurrentPosition(options.highAccuracy ?? false),
            timeoutMs);

        if (!snapshot) {
            return null;
        }

        return {
            latitude: snapshot.latitude,
            longitude: snapshot.longitude,
            accuracyMeters: snapshot.accuracy,
            altitude: snapshot.altitude,
            capturedAtUtc: new Date(snapshot.timestamp).toISOString(),
            provider: snapshot.provider,
            permissionState: 'granted',
        };
    } catch {
        return null;
    }
}
