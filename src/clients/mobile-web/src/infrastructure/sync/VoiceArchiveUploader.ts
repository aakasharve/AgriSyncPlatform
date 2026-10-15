// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// The upload queue for voice clips, as a background worker.
//
// WHAT IT DOES. Recording is local-first and never waits for the network: the
// clip is written to the farmer's own on-device database the moment he stops
// speaking. THIS worker is what later carries a clip to the cloud archive, and
// it does so only when ALL of these hold at that moment:
//   - the phone is online and a farmer is signed in;
//   - the SERVER says he keeps his voice in the cloud (consent is read live at
//     upload time - a farmer who has declined or revoked is never uploaded, and
//     a clip never queued under an earlier "yes" outlives a later "no");
//   - the clip's farm is in THIS farmer's local cache (the seal is bound to the
//     owner account, so a clip cannot be sealed for a farm he does not hold).
// Then each clip goes through `archiveToRetainedTierIfConsented` one at a time:
// seal in memory, POST, and call it saved ONLY on the server's echo of its id.
//
// WHAT IT NEVER DOES. It never deletes, purges, expires or rewrites a
// recording (founder ruling D9 - kept forever). A failed upload is retried on a
// backoff for as long as it takes; there is no give-up and no TTL.
//
// ONE FARMER AT A TIME. The queue IS the signed-in farmer's own database (a
// per-farmer IndexedDB, see `activateUserDatabase`). The cycle remembers which
// database it started on and stops the instant that changes, so a clip can
// never be uploaded under the wrong farmer's session. The provider also drains
// (`stop()` resolves after the running cycle) BEFORE it switches database.

import { getAuthSession } from '../storage/AuthTokenStore';
import { getActiveDatabaseName } from '../storage/activeDatabaseName';
import { getDatabase, type VoiceClipCacheRecord } from '../storage/DexieDatabase';
import { agriSyncClient } from '../api/AgriSyncClient';
import { archiveToRetainedTierIfConsented } from '../voice/VoiceClipRetention';
import { deriveCloudArchiveState } from '../voice/voiceArchiveState';
import { observeArchiveConsentView, recordedUnderConsent } from '../voice/voiceArchiveConsent';

const WORKER_INTERVAL_MS = 30_000;
/** Clips carried per cycle. Small on purpose: sealing + a base64 POST is heavy on a low-RAM phone. */
const BATCH_LIMIT = 3;

export interface DrainResult {
    /** Why nothing was attempted; absent when the queue was examined. */
    skipped?: 'offline' | 'consent_unknown' | 'consent_not_granted' | 'database_changed';
    attempted: number;
    acknowledged: number;
    failed: number;
    waiting: number;
}

const EMPTY: DrainResult = { attempted: 0, acknowledged: 0, failed: 0, waiting: 0 };

function hasBytes(clip: VoiceClipCacheRecord): boolean {
    return Boolean(clip.localBlob) || Boolean(clip.ciphertext && clip.iv && clip.wrappedDekId);
}

function isDue(clip: VoiceClipCacheRecord, nowMs: number): boolean {
    if (!clip.archiveNextAttemptAtUtc) return true;
    const dueMs = Date.parse(clip.archiveNextAttemptAtUtc);
    return Number.isNaN(dueMs) || dueMs <= nowMs;
}

/**
 * Run one pass over the signed-in farmer's unacknowledged clips. Exported for
 * the worker, for `triggerNow`, and for tests.
 */
export async function drainRetainedArchiveQueue(): Promise<DrainResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { ...EMPTY, skipped: 'offline' };
    }

    // Consent is read live, every pass. Declined / revoked => nothing leaves the phone.
    let granted: boolean;
    let consentSince: string | null;
    try {
        const consent = await agriSyncClient.getConsent();
        granted = consent.fullHistoryJournal === true;
        // eligibleSince = max(this phone's marker, the SERVER's start of the
        // current continuous grant). null while granted = server value missing
        // or unparseable = fail closed: nothing qualifies this pass.
        consentSince = await observeArchiveConsentView(consent);
    } catch {
        return { ...EMPTY, skipped: 'consent_unknown' };
    }
    if (!granted) {
        return { ...EMPTY, skipped: 'consent_not_granted' };
    }

    const databaseAtStart = getActiveDatabaseName();
    const db = getDatabase();
    const nowMs = Date.now();
    const unacknowledged = (await db.voiceClips.toArray())
        .filter(clip => !clip.s3RetainedKey && hasBytes(clip))
        // Only clips recorded while consent was in force; older ones stay local-only.
        .filter(clip => recordedUnderConsent(clip.recordedAtUtc, consentSince))
        .filter(clip => deriveCloudArchiveState(clip, true, nowMs) !== 'uploading')
        .sort((a, b) => Date.parse(a.recordedAtUtc) - Date.parse(b.recordedAtUtc));

    const due = unacknowledged.filter(clip => isDue(clip, nowMs));
    const result: DrainResult = { ...EMPTY, waiting: unacknowledged.length - due.length };

    for (const clip of due.slice(0, BATCH_LIMIT)) {
        // A different farmer's database is now active: stop. Nothing of the
        // next farmer's may be uploaded under this cycle, and nothing of this
        // farmer's may be uploaded under theirs.
        if (getActiveDatabaseName() !== databaseAtStart) {
            return { ...result, skipped: 'database_changed' };
        }
        result.attempted += 1;
        const outcome = await archiveToRetainedTierIfConsented(clip.id, clip.farmId);
        if (outcome.status === 'archived') result.acknowledged += 1;
        else if (outcome.status === 'failed') result.failed += 1;
        else result.waiting += 1;
    }
    result.waiting += Math.max(0, due.length - BATCH_LIMIT);
    return result;
}

export class VoiceArchiveUploader {
    private timerId: number | null = null;
    private running = false;
    private activeCycle: Promise<void> | null = null;
    private readonly listeners = new Set<() => void>();

    /**
     * Called after every upload attempt (success or failure) so an open screen can re-read
     * the local archive state. Carries no data: the screen reads Dexie, the source of truth.
     * Returns the unsubscribe function.
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        for (const listener of Array.from(this.listeners)) {
            try {
                listener();
            } catch (error) {
                console.error('[VoiceArchiveUploader] listener failed', error);
            }
        }
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        void this.safeRunCycle();
        this.timerId = window.setInterval(() => void this.safeRunCycle(), WORKER_INTERVAL_MS);
        window.addEventListener('online', this.handleOnline);
    }

    /** Stops scheduling and resolves once a running cycle (if any) has finished. */
    stop(): Promise<void> {
        if (this.running) {
            this.running = false;
            if (this.timerId !== null) {
                window.clearInterval(this.timerId);
                this.timerId = null;
            }
            window.removeEventListener('online', this.handleOnline);
        }
        return this.activeCycle ?? Promise.resolve();
    }

    async triggerNow(): Promise<void> {
        await this.safeRunCycle(true);
    }

    private handleOnline = () => {
        void this.safeRunCycle();
    };

    private async safeRunCycle(force = false): Promise<void> {
        if ((!this.running && !force) || this.activeCycle) return;
        if (!getAuthSession()) return;
        const run = drainRetainedArchiveQueue()
            .then(() => undefined)
            .catch(error => {
                console.error('[VoiceArchiveUploader] cycle failed', error);
            });
        this.activeCycle = run;
        try {
            await run;
        } finally {
            this.activeCycle = null;
        }
        this.notify();
    }
}

export const voiceArchiveUploader = new VoiceArchiveUploader();
