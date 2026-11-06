/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-31, "Play original voice".
 *
 * The original recording behind ONE record, for a reviewer of that record, opened on THIS phone:
 *   GET  /shramsafal/logs/{id}/original-voice           -> the sealed clip, or { available: false, reason }
 *   POST /shramsafal/security/tenant-dek/resolve        -> the farm's key (the server checks he is an ACTIVE member)
 *   WebCrypto AES-GCM open, bound to (clipId, the farm's owner account)   [voiceEnvelope.openVoiceClip]
 *
 * WHO MAY HEAR IT IS DECIDED BY THE SERVER, never here: the speaker himself, the primary owner, or a member holding
 * the owner's grant, and only while the speaker's "मूळ आवाज ऐकू देणे" switch is ON under the current words. This file
 * only turns the server's answer into one of four honest outcomes:
 *   - 'audio'        the recording, ready to play;
 *   - 'unavailable'  the server says there is nothing he may play (not kept, no recording, or he may not hear it) —
 *                    the screen says "मूळ आवाज उपलब्ध नाही." and the words stay on screen;
 *   - 'pending'      the server says the recording is not on the server (yet): the speaker's phone may still be
 *                    uploading it, so the screen says so and keeps the button for a retry (review S5) — never
 *                    "unavailable" for something that may arrive;
 *   - 'failed'       we could not reach or open it this time — the screen offers a retry and never claims there is
 *                    no recording (D-40: "If playback is temporarily unavailable, explain that and allow retry").
 * Nothing is stored on the phone.
 */
import { z } from 'zod';
import { agriSyncClient } from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';
import { openVoiceClip } from '../security/voiceEnvelope';
import { resolveDek } from '../security/tenantDekClient';
import { readFarmOwnerAccountId } from './VoiceClipRetention';

export type OriginalVoiceOutcome =
    | { kind: 'audio'; blob: Blob }
    | { kind: 'unavailable' }
    /** Lane MU-3 fix 1 (F3, D-66): the record mentions money and, by ShramSafal's rule, its voice is not played here. */
    | { kind: 'moneyWithheld' }
    | { kind: 'pending' }
    | { kind: 'failed' };

/** The server's reason when the recording is not (yet) in its archive (GetLogOriginalVoiceHandler). */
export const NOT_ON_SERVER_REASON = 'not_on_server';

/** Lane MU-3 fix 1 (F3) — the server's reason when the money rule withholds a record's voice (GetLogOriginalVoiceHandler). */
export const MONEY_WITHHELD_REASON = 'money_withheld';

const DEFAULT_MIME = 'audio/webm';

// Tolerant on purpose (P11, both directions): unknown keys are ignored, and an answer we cannot read is a FAILURE to
// retry, never "no recording".
const OriginalVoiceResponseSchema = z.object({
    available: z.boolean(),
    reason: z.string().nullish(),
    clipId: z.string().nullish(),
    dekId: z.string().nullish(),
    ivBase64: z.string().nullish(),
    authTagBase64: z.string().nullish(),
    cipherBase64: z.string().nullish(),
});

export const originalVoicePath = (dailyLogId: string): string =>
    `/shramsafal/logs/${encodeURIComponent(dailyLogId)}/original-voice`;

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function httpStatusOf(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    return typeof status === 'number' ? status : undefined;
}

/** The owner account the farm's recordings are sealed under: this phone's farm row first, else the server's list. */
async function ownerAccountOf(farmId: string): Promise<string | null> {
    try {
        const fromPhone = readFarmOwnerAccountId(await getDatabase().farms.get(farmId));
        if (fromPhone) return fromPhone;
    } catch {
        // fall through to the server's answer
    }
    try {
        const me = await agriSyncClient.getMeContext();
        const farm = me.farms.find(f => String(f.farmId) === farmId);
        const owner = String(farm?.ownerAccountId ?? '').trim();
        return owner || null;
    } catch {
        return null;
    }
}

export async function fetchLogOriginalVoice(dailyLogId: string, farmId: string): Promise<OriginalVoiceOutcome> {
    let body: unknown;
    try {
        body = (await agriSyncClient.http.get(originalVoicePath(dailyLogId))).data;
    } catch (error) {
        // 403 / 404: the server will not let him hear THIS record — say it is unavailable, never retry for ever.
        const status = httpStatusOf(error);
        return status === 403 || status === 404 ? { kind: 'unavailable' } : { kind: 'failed' };
    }

    const parsed = OriginalVoiceResponseSchema.safeParse(body);
    if (!parsed.success) return { kind: 'failed' };
    const voice = parsed.data;
    if (!voice.available) {
        if (voice.reason === MONEY_WITHHELD_REASON) return { kind: 'moneyWithheld' };
        return voice.reason === NOT_ON_SERVER_REASON ? { kind: 'pending' } : { kind: 'unavailable' };
    }
    if (!voice.clipId || !voice.dekId || !voice.ivBase64 || !voice.authTagBase64 || !voice.cipherBase64) {
        return { kind: 'failed' };
    }

    try {
        const ownerAccountId = await ownerAccountOf(farmId);
        const dek = ownerAccountId ? await resolveDek(voice.dekId, farmId) : null;
        if (!ownerAccountId || !dek) return { kind: 'failed' };
        // The archive keeps the 16-byte auth tag in its own column; WebCrypto wants it appended.
        const cipher = base64ToBytes(voice.cipherBase64);
        const tag = base64ToBytes(voice.authTagBase64);
        const ciphertext = new Uint8Array(cipher.byteLength + tag.byteLength);
        ciphertext.set(cipher);
        ciphertext.set(tag, cipher.byteLength);
        const bytes = await openVoiceClip(
            { ciphertext, iv: base64ToBytes(voice.ivBase64), wrappedDekId: voice.dekId },
            dek,
            { clipId: voice.clipId.toLowerCase(), ownerAccountId },
        );
        return { kind: 'audio', blob: new Blob([bytes as BlobPart], { type: DEFAULT_MIME }) };
    } catch {
        return { kind: 'failed' };
    }
}
