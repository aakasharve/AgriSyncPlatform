// spec: data-principle-spine-2026-05-05/05.3
// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.9 — bind AAD into the seal
//
// voiceEnvelope contract tests — round-trip, wrong-DEK rejection, and the
// row-binding (AAD) guarantees.
//
// vitest runs with the `node` environment (see vitest.config.ts). Node
// 19+ exposes the same `crypto.subtle` Web Crypto API as the browser
// via `globalThis.crypto` (we verified: Node v24.x). No polyfill needed.

import { describe, it, expect } from 'vitest';
import { sealVoiceClip, openVoiceClip, voiceClipAad, type VoiceClipBinding } from '../voiceEnvelope';

const CLIP_A = 'a1111111-1111-4111-8111-111111111111';
const CLIP_B = 'b2222222-2222-4222-8222-222222222222';
const OWNER_A = '00000000-0000-0000-0000-0000000000c2';
const OWNER_B = '00000000-0000-0000-0000-0000000000d3';

const bindingA: VoiceClipBinding = { clipId: CLIP_A, ownerAccountId: OWNER_A };

describe('voiceEnvelope', () => {
    it('round-trips plaintext through seal+open', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const dekId = 'test-dek-1';
        const plaintext = new TextEncoder().encode('hello voice clip');

        const sealed = await sealVoiceClip(plaintext, dek, dekId, bindingA);
        expect(sealed.wrappedDekId).toBe(dekId);
        expect(sealed.iv.byteLength).toBe(12);
        // Sanity: ciphertext is at least plaintext + 16-byte GCM tag.
        expect(sealed.ciphertext.byteLength).toBeGreaterThanOrEqual(plaintext.byteLength + 16);
        // Ciphertext bytes must not match plaintext bytes (different content
        // and length; the contract is that the ciphertext is opaque).
        expect(Array.from(sealed.ciphertext)).not.toEqual(Array.from(plaintext));

        const opened = await openVoiceClip(sealed, dek, bindingA);
        expect(new TextDecoder().decode(opened)).toBe('hello voice clip');
    });

    it('open with wrong dek throws', async () => {
        const dek1 = crypto.getRandomValues(new Uint8Array(32));
        let dek2 = crypto.getRandomValues(new Uint8Array(32));
        // 1-in-2^256 collision is theoretical, but make the test deterministic.
        while (Array.from(dek1).every((b, i) => b === dek2[i])) {
            dek2 = crypto.getRandomValues(new Uint8Array(32));
        }

        const plaintext = new TextEncoder().encode('x');
        const sealed = await sealVoiceClip(plaintext, dek1, 'd1', bindingA);

        await expect(openVoiceClip(sealed, dek2, bindingA)).rejects.toThrow();
    });

    // =====================================================================
    // ROW BINDING (§P0.9)
    //
    // The defect: with no AAD the sealed triple is a free-floating token.
    // Lift it out of clip A's row, drop it into clip B's row under the SAME
    // tenant DEK, and it opened silently — the farmer heard one recording
    // presented as another with nothing anywhere signalling the swap.
    // =====================================================================

    it('a ciphertext moved into a different clip row fails to open', async () => {
        // One tenant, one DEK — exactly the case a per-tenant key cannot catch.
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const dekId = 'tenant-dek';
        const plaintext = new TextEncoder().encode("clip A's recording");

        const sealedForA = await sealVoiceClip(plaintext, dek, dekId, {
            clipId: CLIP_A,
            ownerAccountId: OWNER_A,
        });

        // Verbatim relocation: same bytes, same iv, same dek id, same tenant —
        // only the row it is presented as changes.
        const relocatedToB = {
            ciphertext: sealedForA.ciphertext,
            iv: sealedForA.iv,
            wrappedDekId: sealedForA.wrappedDekId,
        };

        await expect(
            openVoiceClip(relocatedToB, dek, { clipId: CLIP_B, ownerAccountId: OWNER_A }),
        ).rejects.toThrow();

        // And it still opens in the row it actually belongs to, so the
        // rejection above is the binding working, not the clip being broken.
        const opened = await openVoiceClip(relocatedToB, dek, {
            clipId: CLIP_A,
            ownerAccountId: OWNER_A,
        });
        expect(new TextDecoder().decode(opened)).toBe("clip A's recording");
    });

    it('a ciphertext presented under a different owner account fails to open', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const plaintext = new TextEncoder().encode('owner A audio');
        const sealed = await sealVoiceClip(plaintext, dek, 'dek', {
            clipId: CLIP_A,
            ownerAccountId: OWNER_A,
        });

        await expect(
            openVoiceClip(sealed, dek, { clipId: CLIP_A, ownerAccountId: OWNER_B }),
        ).rejects.toThrow();
    });

    it('refuses to seal or open under a blank binding', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const plaintext = new TextEncoder().encode('x');

        await expect(
            sealVoiceClip(plaintext, dek, 'dek', { clipId: '', ownerAccountId: OWNER_A }),
        ).rejects.toThrow(/clipId is required/);
        await expect(
            sealVoiceClip(plaintext, dek, 'dek', { clipId: CLIP_A, ownerAccountId: '   ' }),
        ).rejects.toThrow(/ownerAccountId is required/);

        const sealed = await sealVoiceClip(plaintext, dek, 'dek', bindingA);
        await expect(
            openVoiceClip(sealed, dek, { clipId: CLIP_A, ownerAccountId: '' }),
        ).rejects.toThrow(/ownerAccountId is required/);
    });

    it('canonical AAD bytes are versioned and cannot collide across bindings', () => {
        const decoder = new TextDecoder();
        expect(decoder.decode(voiceClipAad(bindingA)))
            .toBe(`agrisync.voiceclip.aad.v1\nclip:${CLIP_A.length}:${CLIP_A}\nowner:${OWNER_A.length}:${OWNER_A}`);

        // Without length prefixes these two distinct bindings would
        // canonicalise to the same bytes once a separator appears in an id.
        const left = voiceClipAad({ clipId: 'ab', ownerAccountId: 'c' });
        const right = voiceClipAad({ clipId: 'a', ownerAccountId: 'bc' });
        expect(Array.from(left)).not.toEqual(Array.from(right));
    });
});
