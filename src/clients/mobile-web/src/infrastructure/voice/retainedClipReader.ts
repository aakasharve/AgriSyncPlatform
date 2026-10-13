// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// Read a recording back from the server archive and open it on the device.
//
// This is the path that matters after a fresh install or a new phone: the
// farmer signs in, the local database is empty, and the clips the server
// acknowledged must still be there and still play.
//
// Only EXISTING contracts are used, in this order:
//   GET  /shramsafal/voice-diary/by-id/{clipId}     -> ciphertext + iv + tag + dekId
//   POST /shramsafal/security/tenant-dek/resolve    -> the DEK (KMS unwrap, server-side)
//   WebCrypto AES-GCM open, bound to (clipId, ownerAccountId)   [voiceEnvelope.openVoiceClip]
//
// THE ONE THING THE ARCHIVE DOES NOT RECORD is which owner account a clip was
// bound to: the retained-tier row is keyed by user and carries no farm or owner
// (see VoiceClipRetained). On the original phone the local row says; on a fresh
// install there is no local row. So the binding is recovered the only honest way
// available: try each owner account THIS farmer legitimately belongs to and let
// the AES-GCM auth tag decide. A wrong candidate fails the tag and is discarded;
// no candidate outside the farmer's own accounts is ever tried, and nothing is
// ever opened "unbound". (Recording the owner on the server row would remove the
// guesswork - see VOICE_ARCHIVE_PATH.md, gap G2.)

import { getDatabase } from '../storage/DexieDatabase';
import { agriSyncClient } from '../api/AgriSyncClient';
import { openVoiceClip } from '../security/voiceEnvelope';
import { resolveDek } from '../security/tenantDekClient';
import { getVoiceDiaryById } from '../voiceDiary/voiceDiaryApiClient';

export type RetainedClipReadError =
    | 'not_found'
    | 'dek_unavailable'
    | 'binding_unavailable'
    | 'cannot_open';

export type RetainedClipReadResult =
    | { ok: true; bytes: Uint8Array; mimeType: string }
    | { ok: false; error: RetainedClipReadError };

const DEFAULT_MIME = 'audio/webm';

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Owner accounts of the farms THIS farmer's own database holds, the clip's own farm first. */
async function localOwnerCandidates(clipId: string): Promise<{ owners: string[]; mimeType?: string }> {
    const db = getDatabase();
    const owners: string[] = [];
    const push = (value: unknown) => {
        const owner = value == null ? '' : String(value).trim();
        if (owner && !owners.includes(owner)) owners.push(owner);
    };
    const row = await db.voiceClips.get(clipId);
    if (row) {
        const farm = await db.farms.get(row.farmId);
        push(farm?.ownerAccountId);
    }
    for (const farm of await db.farms.toArray()) push(farm.ownerAccountId);
    return { owners, mimeType: row?.mimeType };
}

/** Same set, from the server, for a device whose farm cache has not filled yet. */
async function serverOwnerCandidates(): Promise<string[]> {
    try {
        const me = await agriSyncClient.getMeContext();
        return Array.from(new Set(me.farms.map(farm => String(farm.ownerAccountId).trim()).filter(Boolean)));
    } catch {
        return [];
    }
}

export async function openRetainedClip(clipId: string): Promise<RetainedClipReadResult> {
    const archived = await getVoiceDiaryById(clipId);
    if (!archived) return { ok: false, error: 'not_found' };

    // The archive keeps the 16-byte auth tag in its own column; WebCrypto wants it appended.
    const body = base64ToBytes(archived.cipherBase64);
    const tag = base64ToBytes(archived.authTagBase64);
    const ciphertext = new Uint8Array(body.byteLength + tag.byteLength);
    ciphertext.set(body);
    ciphertext.set(tag, body.byteLength);
    const iv = base64ToBytes(archived.ivBase64);

    const dek = await resolveDek(archived.dekId);
    if (!dek) return { ok: false, error: 'dek_unavailable' };

    const local = await localOwnerCandidates(clipId);
    const tried = new Set<string>();
    const attempt = async (owners: string[]): Promise<Uint8Array | null> => {
        for (const ownerAccountId of owners) {
            if (tried.has(ownerAccountId)) continue;
            tried.add(ownerAccountId);
            try {
                return await openVoiceClip(
                    { ciphertext, iv, wrappedDekId: archived.dekId },
                    dek,
                    { clipId: archived.clipId, ownerAccountId },
                );
            } catch {
                // Auth tag refused this binding: it is not this clip's owner. Next.
            }
        }
        return null;
    };

    let bytes = await attempt(local.owners);
    if (!bytes) bytes = await attempt(await serverOwnerCandidates());
    if (!bytes) {
        return { ok: false, error: tried.size === 0 ? 'binding_unavailable' : 'cannot_open' };
    }
    return { ok: true, bytes, mimeType: local.mimeType ?? DEFAULT_MIME };
}
