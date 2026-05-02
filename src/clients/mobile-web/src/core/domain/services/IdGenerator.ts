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
