// spec: data-principle-spine-2026-05-05/05.3
//
// Tenant DEK client — fetches the per-tenant Data Encryption Key from
// the backend and caches it in-memory for the duration of the session.
//
// **In-memory only.** The DEK plaintext NEVER touches disk. Persisting
// it would defeat the entire envelope-encryption goal (a lost device
// would surrender both the ciphertext and the key). When the user
// logs out, `clearCachedDek()` MUST be called by the logout path.
//
// NOTE (parallel implementation): see SecurityResource.ts header — the
// endpoints called via `agriSyncClient.getTenantDek` / `resolveDek` are
// implemented in Phase 05 sub-phase 05.2 which is in flight in parallel.
// The cache contract here is independent of the wire shape.

import { agriSyncClient } from '../api/AgriSyncClient';

interface CachedDek {
    dekId: string;
    dek: Uint8Array;
    expiresAtUtc: Date;
}

/**
 * Singleton in-memory cache. Module-scoped so every importer shares
 * the same DEK for the session. Reset on logout via `clearCachedDek()`.
 */
let _cached: CachedDek | null = null;

/**
 * Decode a base64 string into raw bytes. Browser-safe (atob + charCodeAt)
 * — no Node `Buffer` dependency. Used for the backend's `dekBase64`
 * field which carries the 32-byte AES-256 key bytes.
 */
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

/**
 * Return the DEK to use for sealing NEW voice clips. Lazy-fetches and
 * caches in-memory; refreshes when the cached DEK has expired (the
 * backend rotates daily per plan §05.2.1).
 *
 * Pair with `sealVoiceClip(plaintext, dek, dekId)` in voiceEnvelope.ts.
 */
export async function getCurrentTenantDek(): Promise<{ dekId: string; dek: Uint8Array }> {
    if (_cached && _cached.expiresAtUtc > new Date()) {
        return { dekId: _cached.dekId, dek: _cached.dek };
    }
    const resp = await agriSyncClient.getTenantDek();
    _cached = {
        dekId: resp.dekId,
        dek: base64ToBytes(resp.dekBase64),
        expiresAtUtc: new Date(resp.expiresAtUtc),
    };
    return { dekId: _cached.dekId, dek: _cached.dek };
}

/**
 * Resolve a historical DEK by id. Used on the read path when the
 * `wrappedDekId` stored alongside a sealed clip differs from the
 * currently cached DEK (post-rotation case). Backend's KMS unwraps
 * the DEK under EncryptionContext binding (plan §05.2.1); a wrong
 * tenant or expired key surfaces as a `null` return — caller should
 * treat as "clip unrecoverable" rather than crashing.
 */
export async function resolveDek(dekId: string): Promise<Uint8Array | null> {
    const resp = await agriSyncClient.resolveDek(dekId);
    if (!resp) return null;
    return base64ToBytes(resp.dekBase64);
}

/**
 * Drop the in-memory DEK. MUST be called from the logout path so the
 * next user on the device cannot decrypt the previous user's clips
 * without re-authenticating to the backend.
 */
export function clearCachedDek(): void {
    _cached = null;
}
