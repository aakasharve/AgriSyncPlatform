/**
 * Content Hasher — SHA-256 for audio blobs and idempotency keys.
 */

export class ContentHasher {
    /**
     * Compute SHA-256 hash of a Blob.
     */
    static async hashBlob(blob: Blob): Promise<string> {
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        return ContentHasher.bufferToHex(hashBuffer);
    }

    /**
     * Compute SHA-256 hash of a string.
     */
    static async hashString(input: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return ContentHasher.bufferToHex(hashBuffer);
    }

    /**
     * Compute idempotency key for a single segment.
     * Formula: SHA-256(userId|farmId|sessionId|segmentIndex|contentHash)
     */
    static async computeSegmentIdempotencyKey(
        userId: string,
        farmId: string,
        sessionId: string,
        segmentIndex: number,
        contentHash: string
    ): Promise<string> {
        const input = `${userId}|${farmId}|${sessionId}|${segmentIndex}|${contentHash}`;
        return ContentHasher.hashString(input);
    }

    /**
     * Compute session-level idempotency key.
     * Formula: SHA-256(userId|farmId|sessionId|totalSegments|SHA-256(concat(hashes)))
     */
    static async computeSessionIdempotencyKey(
        userId: string,
        farmId: string,
        sessionId: string,
        totalSegments: number,
        segmentHashes: string[]
    ): Promise<string> {
        const combinedHash = await ContentHasher.hashString(segmentHashes.join(''));
        const input = `${userId}|${farmId}|${sessionId}|${totalSegments}|${combinedHash}`;
        return ContentHasher.hashString(input);
    }

    private static bufferToHex(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        const hex: string[] = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            hex[i] = bytes[i].toString(16).padStart(2, '0');
        }
        return hex.join('');
    }
}
