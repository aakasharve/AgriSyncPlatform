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
//   POST /shramsafal/security/tenant-dek/resolve    -> the DEK (KMS unwrap, server-side, under the
//                                                      owner account of the named farm - D1)
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
import { readFarmOwnerAccountId } from './VoiceClipRetention';
import { getVoiceDiaryById } from '../voiceDiary/voiceDiaryApiClient';
import { toArchiveClipId } from './archiveClipId';

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

/**
 * One owner account to try, with a farm of the farmer's that belongs to it.
 * The server learns the owner account only from the farm (D1): it checks the
 * farmer is an active member of that farm and unwraps the key under THAT farm's
 * owner account. So a candidate account is tried through one of its farms.
 */
interface OwnerCandidate {
    ownerAccountId: string;
    farmId: string;
}

/** Owner accounts of the farms THIS farmer's own database holds, the clip's own farm first. */
async function localOwnerCandidates(clipId: string): Promise<{ owners: OwnerCandidate[]; mimeType?: string }> {
    const db = getDatabase();
    const owners: OwnerCandidate[] = [];
    const push = (ownerValue: unknown, farmValue: unknown) => {
        const ownerAccountId = ownerValue == null ? '' : String(ownerValue).trim();
        const farmId = farmValue == null ? '' : String(farmValue).trim();
        if (ownerAccountId && farmId && !owners.some(o => o.ownerAccountId === ownerAccountId)) {
            owners.push({ ownerAccountId, farmId });
        }
    };
    const row = await db.voiceClips.get(clipId);
    if (row) {
        const farm = await db.farms.get(row.farmId);
        push(readFarmOwnerAccountId(farm), row.farmId);
    }
    for (const farm of await db.farms.toArray()) push(readFarmOwnerAccountId(farm), (farm as { id?: unknown }).id);
    return { owners, mimeType: row?.mimeType };
}

/** Same set, from the server, for a device whose farm cache has not filled yet. */
async function serverOwnerCandidates(): Promise<OwnerCandidate[]> {
    try {
        const me = await agriSyncClient.getMeContext();
        const owners: OwnerCandidate[] = [];
        for (const farm of me.farms) {
            const ownerAccountId = String(farm.ownerAccountId ?? '').trim();
            const farmId = String(farm.farmId ?? '').trim();
            if (ownerAccountId && farmId && !owners.some(o => o.ownerAccountId === ownerAccountId)) {
                owners.push({ ownerAccountId, farmId });
            }
        }
        return owners;
    } catch {
        return [];
    }
}

/**
 * `clipId` may be the local clip id (a clip this phone recorded) or the archive
 * Guid the server lists (a clip only the archive holds): `toArchiveClipId` maps
 * both to the same Guid, which is the id the clip was sealed under (AAD), stored
 * under and is fetched by.
 */
export async function openRetainedClip(clipId: string): Promise<RetainedClipReadResult> {
    const archiveId = toArchiveClipId(clipId);
    const archived = await getVoiceDiaryById(archiveId);
    if (!archived) return { ok: false, error: 'not_found' };
    // The server must hand back the clip we asked for; the AAD below is built from
    // OUR archive id, never from whatever a reply claims.
    if (String(archived.clipId).toLowerCase() !== archiveId) return { ok: false, error: 'not_found' };

    // The archive keeps the 16-byte auth tag in its own column; WebCrypto wants it appended.
    const body = base64ToBytes(archived.cipherBase64);
    const tag = base64ToBytes(archived.authTagBase64);
    const ciphertext = new Uint8Array(body.byteLength + tag.byteLength);
    ciphertext.set(body);
    ciphertext.set(tag, body.byteLength);
    const iv = base64ToBytes(archived.ivBase64);

    // The key is unwrapped PER candidate account: KMS refuses a wrap made under another
    // account, and that refusal (404) is how a wrong candidate is told apart from a right one
    // before the AES-GCM tag has the last word.
    const local = await localOwnerCandidates(clipId);
    const tried = new Set<string>();
    let anyKeyResolved = false;
    const attempt = async (owners: OwnerCandidate[]): Promise<Uint8Array | null> => {
        for (const { ownerAccountId, farmId } of owners) {
            if (tried.has(ownerAccountId)) continue;
            tried.add(ownerAccountId);
            const dek = await resolveDek(archived.dekId, farmId);
            if (!dek) continue; // not this account's key (or not a farm the farmer may use)
            anyKeyResolved = true;
            try {
                return await openVoiceClip(
                    { ciphertext, iv, wrappedDekId: archived.dekId },
                    dek,
                    { clipId: archiveId, ownerAccountId },
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
        if (tried.size === 0) return { ok: false, error: 'binding_unavailable' };
        return { ok: false, error: anyKeyResolved ? 'cannot_open' : 'dek_unavailable' };
    }
    return { ok: true, bytes, mimeType: local.mimeType ?? DEFAULT_MIME };
}
