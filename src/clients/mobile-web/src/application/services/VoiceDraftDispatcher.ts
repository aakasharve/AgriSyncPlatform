import { AgriLogResponse } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';

export interface VoiceDraftEvent {
    id: number;
    draft: AgriLogResponse;
    provenance?: LogProvenance;
    emittedAtISO: string;
}

export type VoiceDraftListener = (event: VoiceDraftEvent) => void | Promise<void>;

/**
 * Typed in-memory dispatcher used to decouple voice parsing from log command execution.
 */
export class VoiceDraftDispatcher {
    private listeners = new Set<VoiceDraftListener>();
    private nextEventId = 1;

    emit(draft: AgriLogResponse, provenance?: LogProvenance): void {
        const event: VoiceDraftEvent = {
            id: this.nextEventId++,
            draft,
            provenance,
            emittedAtISO: new Date().toISOString()
        };

        for (const listener of this.listeners) {
            try {
                const result = listener(event);
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch((error) => {
                        console.error('[VoiceDraftDispatcher] Listener promise failed', error);
                    });
                }
            } catch (error) {
                console.error('[VoiceDraftDispatcher] Listener failed', error);
            }
        }
    }

    subscribe(listener: VoiceDraftListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
