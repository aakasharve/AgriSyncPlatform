import { ContentHasher } from './ContentHasher';

export interface VoiceIdempotencyMaterial {
    sessionId: string;
    segmentIndex: number;
    contentHash: string;
    deterministicSeed: string;
    deterministicKey: string;
}

export interface VoiceSessionIdempotencyMaterial {
    sessionId: string;
    totalSegments: number;
    combinedContentHash: string;
    deterministicSeed: string;
    deterministicKey: string;
}

function normalizeScopePart(input: string | number | undefined | null): string {
    const normalized = `${input ?? ''}`.trim();
    return normalized.length > 0 ? normalized : 'unknown';
}

export class VoiceIdempotency {
    static createSessionId(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return `voice-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    static async buildSegmentMaterial(params: {
        userId?: string;
        farmId?: string;
        sessionId: string;
        segmentIndex: number;
        contentHash: string;
    }): Promise<VoiceIdempotencyMaterial> {
        const userId = normalizeScopePart(params.userId);
        const farmId = normalizeScopePart(params.farmId);
        const sessionId = normalizeScopePart(params.sessionId);
        const contentHash = normalizeScopePart(params.contentHash);
        const segmentIndex = Number.isFinite(params.segmentIndex) ? params.segmentIndex : 0;

        const deterministicSeed = `${userId}|${farmId}|${sessionId}|${segmentIndex}|${contentHash}`;
        const deterministicKey = await ContentHasher.hashString(deterministicSeed);

        return {
            sessionId,
            segmentIndex,
            contentHash,
            deterministicSeed,
            deterministicKey,
        };
    }

    static async buildSessionMaterial(params: {
        userId?: string;
        farmId?: string;
        sessionId: string;
        segmentContentHashes: string[];
    }): Promise<VoiceSessionIdempotencyMaterial> {
        const userId = normalizeScopePart(params.userId);
        const farmId = normalizeScopePart(params.farmId);
        const sessionId = normalizeScopePart(params.sessionId);
        const segmentContentHashes = params.segmentContentHashes.map(item => normalizeScopePart(item));
        const combinedContentHash = await ContentHasher.hashString(segmentContentHashes.join('|'));
        const totalSegments = segmentContentHashes.length;
        const deterministicSeed = `${userId}|${farmId}|${sessionId}|${totalSegments}|${combinedContentHash}`;
        const deterministicKey = await ContentHasher.hashString(deterministicSeed);

        return {
            sessionId,
            totalSegments,
            combinedContentHash,
            deterministicSeed,
            deterministicKey,
        };
    }
}
