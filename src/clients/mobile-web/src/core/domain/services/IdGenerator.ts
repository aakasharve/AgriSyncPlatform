/**
 * IdGenerator Service
 * Provides a stable source of identity for the application.
 * Defines the contract for generating unique identifiers.
 */

export interface IdGenerator {
    generate(): string;
}

/**
 * UUIDv7 Generator
 * Uses crypto.randomUUID() for now (v4), but abstracts it so we can swap to v7
 * (time-ordered) later without changing domain code.
 * 
 * TODO: Swap to real UUIDv7 implementation when 'uuid' package is upgraded or custom impl added.
 * For now, using v4 is acceptable for uniqueness, though less optimal for index locality.
 */
export class UUIDGenerator implements IdGenerator {
    generate(): string {
        // Use native crypto if available (Node and modern Browsers)
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }

        // Fallback for older environments or strict security
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

// Default instance
export const idGenerator = new UUIDGenerator();

/** 128 bits from a string (cyrb128): the same string always gives the same four words. */
function hash128(text: string): number[] {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < text.length; i++) {
        const k = text.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Lane OF fix 1 (M1) — ids DERIVED from a seed: the same seed gives the same ids in the same order (a well-formed v4-shaped
 * UUID each). Used when one capture may become logs only ONCE: a second try makes the very same log ids, so the phone can
 * see they are already written and write nothing twice.
 */
export function seededIdGenerator(seed: string): IdGenerator {
    let n = 0;
    return {
        generate(): string {
            const hex = hash128(`${seed}#${n++}`).map(w => w.toString(16).padStart(8, '0')).join('').split('');
            hex[12] = '4';
            hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
            const h = hex.join('');
            return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
        },
    };
}
