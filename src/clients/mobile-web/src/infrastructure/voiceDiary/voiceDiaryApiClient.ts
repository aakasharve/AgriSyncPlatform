// spec: voice-diary-e2e-2026-05-17 (D.5)
//
// Voice Diary API client — calls the three retained-tier endpoints
// added by Wave 1.B:
//
//   POST /shramsafal/voice-diary/persist        — archive a sealed clip
//   GET  /shramsafal/voice-diary/by-range       — list clips in a window
//   GET  /shramsafal/voice-diary/by-id/{clipId} — fetch one clip + bytes
//
// (Note: the comments in the backend's VoiceDiaryEndpoints.cs say
// `/api/voice-diary/*` but the actual mount in ModuleEndpoints.cs is
// under the `/shramsafal` route group. The wire path is `/shramsafal/...`.)
//
// All three are bearer-token authorized. The client uses the shared
// axios instance via `agriSyncClient.http`-equivalent access through
// the BackendAiClient extension layer. We define typed wrappers + Zod
// runtime validation at the wire boundary to fail closed on a server
// shape drift.
//
// The persist call passes the LOCAL Dexie `voiceClips.id` as the
// server-side `clipId` PK so the unified VoiceDiary view de-dupes
// cleanly when the same clip arrives via the local-30d path AND the
// retained-tier path (supervisor risk #1 mitigation per envelope brief).

import { z } from 'zod';
import { agriSyncClient } from '../api/AgriSyncClient';

// ---------------------------------------------------------------------------
// Wire shapes (mirror VoiceDiaryEndpoints.cs / RetainedClipResult /
// VoiceClipRetainedListItem on the .NET side).
// ---------------------------------------------------------------------------

export interface PersistVoiceClipRetainedRequest {
    /** Client-side Dexie `voiceClips.id` reused as the server PK (UUID v4). */
    clipId: string;
    /** ISO-8601 UTC timestamp of the original recording. */
    recordedAtUtc: string;
    /** Base64 AES-GCM ciphertext WITHOUT the trailing 16-byte auth tag. */
    cipherBase64: string;
    /** Opaque DEK identifier from `tenantDekClient.getCurrentTenantDek`. */
    dekId: string;
    /** Base64 96-bit IV used during the seal. */
    ivBase64: string;
    /** Base64 16-byte AES-GCM auth tag (split from the WebCrypto output). */
    authTagBase64: string;
    /** Whole-seconds duration. Backend invariant requires >= 1. */
    durationSeconds: number;
    /** BCP-47 locale (e.g. 'mr-IN'); used for downstream search bucketing. */
    language: string;
}

export interface PersistVoiceClipRetainedResponse {
    /** Echoes the clipId; the server may reassign on collision (today: PK reuse). */
    clipId: string;
}

export interface VoiceDiaryListItem {
    clipId: string;
    recordedAtUtc: string;
    durationSeconds: number;
    language: string;
    s3Key: string;
}

export interface VoiceDiaryByIdResult {
    clipId: string;
    recordedAtUtc: string;
    durationSeconds: number;
    language: string;
    dekId: string;
    ivBase64: string;
    authTagBase64: string;
    cipherBase64: string;
}

// ---------------------------------------------------------------------------
// Zod runtime validators (defence in depth — the wire boundary is the
// last place we can stop a server shape drift).
// ---------------------------------------------------------------------------

const PersistResponseSchema = z.object({
    clipId: z.string().min(1),
});

const ListItemSchema = z.object({
    clipId: z.string().min(1),
    recordedAtUtc: z.string(),
    durationSeconds: z.number().int().nonnegative(),
    language: z.string(),
    s3Key: z.string(),
});

const RangeResponseSchema = z.object({
    clips: z.array(ListItemSchema),
});

const ByIdSchema = z.object({
    clipId: z.string().min(1),
    recordedAtUtc: z.string(),
    durationSeconds: z.number().int().nonnegative(),
    language: z.string(),
    dekId: z.string(),
    ivBase64: z.string(),
    authTagBase64: z.string(),
    cipherBase64: z.string(),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Archive a sealed voice clip to the retained S3 tier.
 *
 * The backend gates this on `IConsentEnforcer.RequireGrantAsync(userId,
 * ConsentPurpose.FullHistoryJournal)`; on deny it returns 400 with
 * `error: ShramSafal.ConsentRequired` and the call rejects.
 *
 * The caller MUST split the WebCrypto AES-GCM combined output:
 *   - ciphertext = ct[0 .. ct.length - 16]   → cipherBase64
 *   - authTag    = ct[ct.length - 16 .. end] → authTagBase64
 *
 * See `archiveToRetainedTierIfConsented` in
 * `infrastructure/voice/VoiceClipRetention.ts` for the canonical caller.
 */
export async function persistRetainedVoiceClip(
    request: PersistVoiceClipRetainedRequest,
): Promise<PersistVoiceClipRetainedResponse> {
    const axiosClient = agriSyncClient.http;
    const response = await axiosClient.post<unknown>('/shramsafal/voice-diary/persist', {
        clipId: request.clipId,
        recordedAtUtc: request.recordedAtUtc,
        cipherBase64: request.cipherBase64,
        dekId: request.dekId,
        ivBase64: request.ivBase64,
        authTagBase64: request.authTagBase64,
        durationSeconds: request.durationSeconds,
        language: request.language,
    });

    const parsed = PersistResponseSchema.safeParse(response.data);
    if (!parsed.success) {
        throw new Error(
            `voiceDiaryApiClient.persistRetainedVoiceClip: invalid response shape — ${parsed.error.toString()}`,
        );
    }
    return parsed.data;
}

/**
 * Fetch retained-tier clip metadata in a date window. Server-side
 * scopes to the caller's userId; no farmId required.
 */
export async function getVoiceDiaryByRange(
    fromDate: string,
    toDate: string,
): Promise<VoiceDiaryListItem[]> {
    const axiosClient = agriSyncClient.http;
    const response = await axiosClient.get<unknown>('/shramsafal/voice-diary/by-range', {
        params: { from: fromDate, to: toDate },
    });

    const parsed = RangeResponseSchema.safeParse(response.data);
    if (!parsed.success) {
        throw new Error(
            `voiceDiaryApiClient.getVoiceDiaryByRange: invalid response shape — ${parsed.error.toString()}`,
        );
    }
    return parsed.data.clips;
}

/**
 * Fetch a single retained clip with its ciphertext bytes. The caller
 * resolves the DEK via `resolveDek(dekId)` from `tenantDekClient` and
 * passes both into `voiceEnvelope.openVoiceClip` to recover plaintext.
 *
 * Returns null when the server responds 404 (clip not found OR not
 * owned by the caller — the endpoint conflates both for privacy).
 */
export async function getVoiceDiaryById(clipId: string): Promise<VoiceDiaryByIdResult | null> {
    const axiosClient = agriSyncClient.http;
    try {
        const response = await axiosClient.get<unknown>(`/shramsafal/voice-diary/by-id/${encodeURIComponent(clipId)}`);
        const parsed = ByIdSchema.safeParse(response.data);
        if (!parsed.success) {
            throw new Error(
                `voiceDiaryApiClient.getVoiceDiaryById: invalid response shape — ${parsed.error.toString()}`,
            );
        }
        return parsed.data;
    } catch (error) {
        // Axios threw — peek at the response for a 404 to surface as `null`.
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404) {
            return null;
        }
        throw error;
    }
}
