/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path, defect D2)
 *
 * The archive id is what lets a 64-hex local clip id cross a Guid-typed server
 * contract. These are the properties the rest of the path leans on.
 */
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { isGuidString, sha256Bytes, toArchiveClipId } from '../archiveClipId';

const HEX_ID = 'a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70';
const NIL = '00000000-0000-0000-0000-000000000000';

describe('toArchiveClipId', () => {
    it('turns the 64-hex local id the app really mints into a valid, canonical Guid', () => {
        const id = toArchiveClipId(HEX_ID);
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(isGuidString(id)).toBe(true);
        expect(id).not.toBe(NIL);
    });

    it('is deterministic: the same local id always yields the same archive id', () => {
        expect(toArchiveClipId(HEX_ID)).toBe(toArchiveClipId(HEX_ID));
        expect(toArchiveClipId(HEX_ID.toUpperCase())).toBe(toArchiveClipId(HEX_ID));
        expect(toArchiveClipId(`  ${HEX_ID}  `)).toBe(toArchiveClipId(HEX_ID));
    });

    it('is injective on distinct ids (distinct clips never collapse into one archive row)', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 500; i++) seen.add(toArchiveClipId(randomBytes(32).toString('hex')));
        expect(seen.size).toBe(500);
    });

    it('is a fixed point on Guids, so a cloud-listed archive id maps to itself', () => {
        const guid = 'c1111111-1111-4111-8111-111111111111';
        expect(toArchiveClipId(guid)).toBe(guid);
        expect(toArchiveClipId(guid.toUpperCase())).toBe(guid);
        const derived = toArchiveClipId(HEX_ID);
        expect(toArchiveClipId(derived)).toBe(derived);
    });

    it('derives a Guid for any other id shape, and never the nil Guid', () => {
        const id = toArchiveClipId('voice-session-123-abc');
        expect(isGuidString(id)).toBe(true);
        expect(toArchiveClipId('voice-session-123-abc')).toBe(id);
        expect(toArchiveClipId(NIL)).not.toBe(NIL);
        expect(isGuidString(toArchiveClipId(NIL))).toBe(true);
    });

    it('refuses an empty id instead of inventing one', () => {
        expect(() => toArchiveClipId('')).toThrow();
        expect(() => toArchiveClipId('   ')).toThrow();
    });
});

describe('sha256Bytes (used for ids that are neither Guid nor hex)', () => {
    it('matches node:crypto on lengths around the 55/56/64-byte padding boundaries', () => {
        for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000]) {
            const msg = randomBytes(n);
            const expected = createHash('sha256').update(msg).digest('hex');
            expect(Buffer.from(sha256Bytes(msg)).toString('hex')).toBe(expected);
        }
    });
});
