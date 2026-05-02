import { systemClock } from '../domain/services/Clock';

// Skill: product-telemetry-and-reliability
// Purpose: Track golden signals (Availability, Correctness, Latency) and Sync Health.

type EventType = 'SYNC_FAILURE' | 'AI_CORRECTION' | 'LOG_CREATED' | 'APP_CRASH';

type TelemetryPayload = Record<string, unknown>;

interface TelemetryEvent {
    type: EventType;
    payload: TelemetryPayload;
    timestamp: number;
    tenantId?: string;
}

export class TelemetryService {
    private static instance: TelemetryService;

    private constructor() { }

    static getInstance(): TelemetryService {
        if (!TelemetryService.instance) {
            TelemetryService.instance = new TelemetryService();
        }
        return TelemetryService.instance;
    }

    track(type: EventType, payload: TelemetryPayload) {
        const event: TelemetryEvent = {
            type,
            payload,
            timestamp: systemClock.nowEpoch()
        };
        // In production, this would batch and send to server
        console.log('[Telemetry]', event);
    }

    trackSyncFailure(error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.track('SYNC_FAILURE', { error: message });
    }

    trackCorrection(original: string, corrected: string) {
        this.track('AI_CORRECTION', { original, corrected });
    }
}

export const telemetry = TelemetryService.getInstance();
