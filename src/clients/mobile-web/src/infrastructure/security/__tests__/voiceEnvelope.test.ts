// spec: data-principle-spine-2026-05-05/05.3
//
// voiceEnvelope contract tests — round-trip + wrong-DEK rejection.
//
// vitest runs with the `node` environment (see vitest.config.ts). Node
// 19+ exposes the same `crypto.subtle` Web Crypto API as the browser
// via `globalThis.crypto` (we verified: Node v24.x). No polyfill needed.

import { describe, it, expect } from 'vitest';
import { sealVoiceClip, openVoiceClip } from '../voiceEnvelope';

describe('voiceEnvelope', () => {
    it('round-trips plaintext through seal+open', async () => {
        const dek = crypto.getRandomValues(new Uint8Array(32));
        const dekId = 'test-dek-1';
        const plaintext = new TextEncoder().encode('hello voice clip');

        const sealed = await sealVoiceClip(plaintext, dek, dekId);
        expect(sealed.wrappedDekId).toBe(dekId);
        expect(sealed.iv.byteLength).toBe(12);
        // Sanity: ciphertext is at least plaintext + 16-byte GCM tag.
        expect(sealed.ciphertext.byteLength).toBeGreaterThanOrEqual(plaintext.byteLength + 16);
        // Ciphertext bytes must not match plaintext bytes (different content
        // and length; the contract is that the ciphertext is opaque).
        expect(Array.from(sealed.ciphertext)).not.toEqual(Array.from(plaintext));

        const opened = await openVoiceClip(sealed, dek);
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
        const sealed = await sealVoiceClip(plaintext, dek1, 'd1');

        await expect(openVoiceClip(sealed, dek2)).rejects.toThrow();
    });
});
