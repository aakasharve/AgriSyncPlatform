// spec: data-principle-spine-2026-05-05/05.3
//
// Voice clip envelope encryption — WebCrypto AES-GCM.
//
// Every `voiceClips` row in IndexedDB is sealed at rest so a lost device
// surrenders ciphertext only. The DEK is a 256-bit per-tenant key
// fetched from the backend over `GET /shramsafal/security/tenant-dek`
// (see `tenantDekClient.ts`). The DEK is never persisted to disk; it
// lives in-memory for the duration of the session and is dropped on
// logout via `clearCachedDek()`.
//
// Format on disk:
//   { ciphertext: Uint8Array, iv: Uint8Array (12 bytes), wrappedDekId: string }
//
// `wrappedDekId` is the opaque KMS-wrapped DEK identifier issued by the
// backend; on read the client posts it to
// `POST /shramsafal/security/tenant-dek/resolve` to recover the plaintext
// DEK bytes. The IV is per-clip random (NIST SP 800-38D §8.2.2 RBG-based
// construction with 96-bit length, the AES-GCM sweet spot — never reuse
// {key, iv} pairs).
//
// We deliberately do NOT use AAD. The plaintext is opaque audio bytes;
// there is no associated authenticated header to bind. Adding empty
// AAD would just be ceremony.

/**
 * On-disk representation of a sealed voice clip. The three fields
 * together are everything `openVoiceClip` needs to decrypt — except
 * the DEK itself, which lives only in memory (or in KMS via `resolveDek`).
 */
export interface SealedClip {
    /** AES-GCM ciphertext (includes the 16-byte auth tag suffix per WebCrypto). */
    ciphertext: Uint8Array;
    /** 96-bit random IV. Persist alongside the ciphertext; reuse is fatal. */
    iv: Uint8Array;
    /** Opaque DEK identifier from the backend; resolved server-side on read. */
    wrappedDekId: string;
}

/**
 * Import a 32-byte raw DEK as an AES-GCM CryptoKey.
 *
 * `extractable: false` — once imported the DEK can encrypt/decrypt
 * but cannot be exported back to bytes through WebCrypto. The caller
 * holds the byte array; if they need to import again, they re-call
 * this function. We do not cache CryptoKey instances because the
 * cached DEK in `tenantDekClient.ts` is the source of truth and
 * holding two references invites lifecycle drift.
 */
async function importDek(dek: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        dek,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
    );
}

/**
 * Seal plaintext bytes under the given DEK. The returned `SealedClip`
 * is safe to persist verbatim in Dexie — the IV is non-secret and
 * the wrapped DEK id is meaningless without a server round-trip.
 *
 * @param plaintext  Raw bytes to encrypt (voice clip bytes from MediaRecorder).
 * @param dek        32-byte AES-256 key from `getCurrentTenantDek`.
 * @param dekId      Opaque DEK identifier (echoes back on read via `resolveDek`).
 */
export async function sealVoiceClip(
    plaintext: Uint8Array,
    dek: Uint8Array,
    dekId: string,
): Promise<SealedClip> {
    const key = await importDek(dek);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plaintext,
    );
    return {
        ciphertext: new Uint8Array(ct),
        iv,
        wrappedDekId: dekId,
    };
}

/**
 * Open a sealed clip under the given DEK. Throws on auth-tag failure
 * (wrong DEK, tampered ciphertext, tampered IV — WebCrypto raises a
 * generic OperationError which we surface verbatim). The retention
 * worker should treat any throw as "clip is unrecoverable; mark
 * needsResealOnNextAccess=false and surface to UI as an error".
 */
export async function openVoiceClip(
    sealed: SealedClip,
    dek: Uint8Array,
): Promise<Uint8Array> {
    const key = await importDek(dek);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv },
        key,
        sealed.ciphertext,
    );
    return new Uint8Array(pt);
}
