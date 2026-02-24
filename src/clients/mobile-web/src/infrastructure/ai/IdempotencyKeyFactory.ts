export type AiOperationScope = 'voice' | 'receipt' | 'patti' | 'text';

export interface DeterministicKeyMaterial {
    idempotencyKey: string;
    deterministicSeed: string;
}

function normalizePart(value: string | number | undefined | null, fallback = 'unknown'): string {
    const normalized = `${value ?? ''}`.trim();
    return normalized.length > 0 ? normalized : fallback;
}

function normalizeSegmentIndex(value: number | undefined): number {
    return Number.isFinite(value) && (value as number) >= 0 ? Math.floor(value as number) : 0;
}

export class IdempotencyKeyFactory {
    static async hashBlob(blob: Blob): Promise<string> {
        const bytes = await blob.arrayBuffer();
        return IdempotencyKeyFactory.hashBuffer(bytes);
    }

    static async hashString(input: string): Promise<string> {
        const encoder = new TextEncoder();
        return IdempotencyKeyFactory.hashBuffer(encoder.encode(input));
    }

    static async buildVoiceKey(params: {
        userId?: string;
        farmId: string;
        sessionId?: string;
        segmentIndex?: number;
        contentHash: string;
    }): Promise<DeterministicKeyMaterial> {
        const userId = normalizePart(params.userId);
        const farmId = normalizePart(params.farmId);
        const contentHash = normalizePart(params.contentHash);
        const sessionId = normalizePart(params.sessionId, contentHash.slice(0, 24));
        const segmentIndex = normalizeSegmentIndex(params.segmentIndex);

        const deterministicSeed = `${userId}|${farmId}|${sessionId}|${segmentIndex}|${contentHash}`;
        return {
            idempotencyKey: await IdempotencyKeyFactory.hashString(deterministicSeed),
            deterministicSeed,
        };
    }

    static async buildOperationKey(params: {
        userId?: string;
        farmId: string;
        operation: Exclude<AiOperationScope, 'voice'>;
        contentHash: string;
    }): Promise<DeterministicKeyMaterial> {
        const userId = normalizePart(params.userId);
        const farmId = normalizePart(params.farmId);
        const operation = normalizePart(params.operation);
        const contentHash = normalizePart(params.contentHash);

        const deterministicSeed = `${userId}|${farmId}|${operation}|${contentHash}`;
        return {
            idempotencyKey: await IdempotencyKeyFactory.hashString(deterministicSeed),
            deterministicSeed,
        };
    }

    private static async hashBuffer(input: BufferSource): Promise<string> {
        const digest = await crypto.subtle.digest('SHA-256', input);
        const bytes = new Uint8Array(digest);
        const hex: string[] = new Array(bytes.length);

        for (let i = 0; i < bytes.length; i++) {
            hex[i] = bytes[i].toString(16).padStart(2, '0');
        }

        return hex.join('');
    }
}
