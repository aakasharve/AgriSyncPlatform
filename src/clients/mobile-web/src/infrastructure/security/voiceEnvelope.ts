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
// WHAT THE SEAL BINDS, AND WHY IT NOW BINDS ANYTHING AT ALL
// ---------------------------------------------------------
// This module previously carried the note "we deliberately do NOT use
// AAD ... adding empty AAD would just be ceremony". That reasoning was
// wrong, and the correction matters.
//
// AES-GCM's auth tag proves the ciphertext was produced under this DEK
// and has not been altered. It proves NOTHING about *where* the
// ciphertext is stored. With no AAD, the sealed triple
// (`ciphertext`, `iv`, `wrappedDekId`) is a free-floating token: copy it
// out of clip A's row and paste it into clip B's row, under the same
// tenant DEK, and it opens cleanly and silently. The farmer then hears
// one day's recording presented as another's, and every downstream
// artefact — transcript, parse, day ledger, audit trail — is attributed
// to the wrong clip with no signal that anything moved. A per-tenant DEK
// cannot detect this, because both rows are inside the same tenant.
//
// So the seal now binds the two facts that make a ciphertext belong to
// exactly one row: the CLIP ID and the OWNER ACCOUNT. Both are
// authenticated but not encrypted — AAD is covered by the tag, not by
// the ciphertext — so a mismatch on either surfaces as an ordinary
// auth-tag failure at decrypt time. Relocation stops being silent.
//
// The AAD is versioned and length-prefixed. Versioned so a future
// binding change is detectable rather than ambiguous; length-prefixed so
// no pair of distinct (clipId, ownerAccountId) inputs can canonicalise
// to the same bytes (without lengths, `clip=ab|owner=c` and
// `clip=a|owner=bc` collide once a separator appears inside an id).

/**
 * The row identity a sealed clip is bound to. Both fields are mandatory:
 * an optional binding is an attacker-selectable binding, which is the
 * same as no binding at all.
 */
export interface VoiceClipBinding {
    /** `voiceClips.id` — the primary key of the row that owns this ciphertext. */
    clipId: string;
    /** The owner account the clip's farm belongs to. */
    ownerAccountId: string;
}

/** Bump only when the canonical byte layout below changes. */
const VOICE_CLIP_AAD_VERSION = 'agrisync.voiceclip.aad.v1';

/**
 * Canonical AAD bytes for a binding. Exported so tests can assert the
 * exact layout — a silent change here makes every previously sealed clip
 * unopenable, so the layout is a contract, not an implementation detail.
 *
 * Throws on an empty id rather than binding to the empty string: sealing
 * under a blank binding would reintroduce the relocation hole for that
 * clip while looking, from the outside, exactly like a bound one.
 */
export function voiceClipAad(binding: VoiceClipBinding): Uint8Array {
    const clipId = (binding?.clipId ?? '').trim();
    const ownerAccountId = (binding?.ownerAccountId ?? '').trim();
    if (clipId.length === 0) {
        throw new Error('voiceEnvelope: clipId is required to bind a voice-clip seal.');
    }
    if (ownerAccountId.length === 0) {
        throw new Error('voiceEnvelope: ownerAccountId is required to bind a voice-clip seal.');
    }
    return new TextEncoder().encode(
        `${VOICE_CLIP_AAD_VERSION}\n`
        + `clip:${clipId.length}:${clipId}\n`
        + `owner:${ownerAccountId.length}:${ownerAccountId}`,
    );
}

/**
 * On-disk representation of a sealed voice clip. The three fields
 * together are everything `openVoiceClip` needs to decrypt — except
 * the DEK itself, which lives only in memory (or in KMS via `resolveDek`),
 * and the binding, which the caller must supply from the row the
 * ciphertext is stored in.
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
 * @param binding    The row this ciphertext belongs to. Authenticated, not
 *                   encrypted; `openVoiceClip` must be given the same values
 *                   or the auth tag fails.
 */
export async function sealVoiceClip(
    plaintext: Uint8Array,
    dek: Uint8Array,
    dekId: string,
    binding: VoiceClipBinding,
): Promise<SealedClip> {
    const key = await importDek(dek);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: voiceClipAad(binding) },
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
 * Open a sealed clip under the given DEK and binding. Throws on auth-tag
 * failure (wrong DEK, tampered ciphertext, tampered IV, **or a binding
 * that does not match the one the clip was sealed under** — WebCrypto
 * raises a generic OperationError which we surface verbatim). The
 * retention worker should treat any throw as "clip is unrecoverable; mark
 * needsResealOnNextAccess=false and surface to UI as an error".
 *
 * A ciphertext relocated into a different row fails here. That is the
 * point of `binding`.
 */
export async function openVoiceClip(
    sealed: SealedClip,
    dek: Uint8Array,
    binding: VoiceClipBinding,
): Promise<Uint8Array> {
    const key = await importDek(dek);
    const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv, additionalData: voiceClipAad(binding) },
        key,
        sealed.ciphertext,
    );
    return new Uint8Array(pt);
}
