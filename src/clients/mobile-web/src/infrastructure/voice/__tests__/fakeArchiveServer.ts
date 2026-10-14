// Test double for the server half of the voice archive, shared by the voice
// archive tests. It models ONLY what the real contracts promise:
//   - persist: consent-gated, idempotent per (user, clip), echoes the clip id
//   - by-id / by-range: scoped to the signed-in user, never across users
//   - tenant DEK issue / resolve: a per-owner-account key, resolvable only by
//     a caller whose tenant is that owner account (KMS EncryptionContext)
// The server NEVER sees plaintext: `stored` holds exactly what was POSTed, so a
// test can assert the audio was not sent in the clear.

import type {
    PersistVoiceClipRetainedRequest,
    VoiceDiaryByIdResult,
    VoiceDiaryListItem,
} from '../../voiceDiary/voiceDiaryApiClient';

function bytesToBase64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function deterministicKey(seed: string): Uint8Array {
    const out = new Uint8Array(32);
    for (let i = 0; i < out.length; i++) out[i] = (seed.charCodeAt(i % seed.length) * 31 + i * 7) & 0xff;
    return out;
}

class FakeArchiveServer {
    /** Signed-in user and the owner account of their JWT tenant claim. */
    user = 'user-a';
    tenantOwner = 'owner-a';
    consent = new Map<string, boolean>();
    /**
     * What GET /consent/me reports as the start of the CURRENT continuous grant.
     * Unset => a long-ago start (does not constrain). `null` => the server could
     * not say (older server / unreadable ledger): the field is absent.
     */
    grantSince = new Map<string, string | null>();
    /** Owner accounts of the farms each user belongs to (for /me/context). */
    memberships = new Map<string, string[]>();
    stored = new Map<string, Map<string, PersistVoiceClipRetainedRequest>>();
    persistCalls: PersistVoiceClipRetainedRequest[] = [];
    dekFetches = 0;
    /** Make the next N persist calls fail like a dropped connection. */
    failPersist = 0;
    /** When set, persist throws THIS (e.g. an HTTP-response error) instead of a dropped connection. */
    failPersistWith: unknown = null;
    /** Make persist answer 200 but with a different clip id (a broken ack). */
    ackWrongId = false;
    /** Held open to observe the in-flight state; resolved by the test. */
    holdPersist: Promise<void> | null = null;

    reset(): void {
        this.user = 'user-a';
        this.tenantOwner = 'owner-a';
        this.consent.clear();
        this.grantSince.clear();
        this.memberships.clear();
        this.stored.clear();
        this.persistCalls = [];
        this.dekFetches = 0;
        this.failPersist = 0;
        this.failPersistWith = null;
        this.ackWrongId = false;
        this.holdPersist = null;
    }

    private dekIdFor(owner: string): string {
        return `dek-${owner}-v1`;
    }

    private mine(): Map<string, PersistVoiceClipRetainedRequest> {
        let m = this.stored.get(this.user);
        if (!m) {
            m = new Map();
            this.stored.set(this.user, m);
        }
        return m;
    }

    client = {
        getConsent: async () => {
            const granted = this.consent.get(this.user) === true;
            const since = this.grantSince.has(this.user) ? this.grantSince.get(this.user) : '2026-01-01T00:00:00.000Z';
            return {
                fullHistoryJournal: granted,
                crossFarmAggregation: false,
                researchCorpusExport: false,
                version: 1,
                acceptedAtUtc: null,
                revokedAtUtc: null,
                ...(granted && since ? { fullHistoryJournalGrantedSinceUtc: since } : {}),
            };
        },
        getTenantDek: async () => {
            this.dekFetches += 1;
            return {
                dekId: this.dekIdFor(this.tenantOwner),
                dekBase64: bytesToBase64(deterministicKey(this.tenantOwner)),
                expiresAtUtc: new Date(Date.now() + 3600_000).toISOString(),
            };
        },
        resolveDek: async (dekId: string) => {
            // KMS EncryptionContext: only the owning tenant may unwrap.
            if (dekId !== this.dekIdFor(this.tenantOwner)) return null;
            return { dekBase64: bytesToBase64(deterministicKey(this.tenantOwner)) };
        },
        getMeContext: async () => ({
            farms: (this.memberships.get(this.user) ?? []).map(ownerAccountId => ({ ownerAccountId })),
        }),
    };

    api = {
        persistRetainedVoiceClip: async (req: PersistVoiceClipRetainedRequest) => {
            this.persistCalls.push(req);
            if (this.holdPersist) await this.holdPersist;
            if (this.failPersistWith) throw this.failPersistWith;
            if (this.failPersist > 0) {
                this.failPersist -= 1;
                throw new Error('Network Error');
            }
            if (this.consent.get(this.user) !== true) {
                throw new Error('ShramSafal.ConsentRequired');
            }
            const mine = this.mine();
            if (!mine.has(req.clipId)) mine.set(req.clipId, req);
            return { clipId: this.ackWrongId ? '99999999-9999-4999-8999-999999999999' : req.clipId };
        },
        getVoiceDiaryById: async (clipId: string): Promise<VoiceDiaryByIdResult | null> => {
            const row = this.mine().get(clipId);
            if (!row) return null; // not found OR not owned: the endpoint conflates both
            return {
                clipId: row.clipId,
                recordedAtUtc: row.recordedAtUtc,
                durationSeconds: row.durationSeconds,
                language: row.language,
                dekId: row.dekId,
                ivBase64: row.ivBase64,
                authTagBase64: row.authTagBase64,
                cipherBase64: row.cipherBase64,
            };
        },
        getVoiceDiaryByRange: async (): Promise<VoiceDiaryListItem[]> =>
            Array.from(this.mine().values()).map(row => ({
                clipId: row.clipId,
                recordedAtUtc: row.recordedAtUtc,
                durationSeconds: row.durationSeconds,
                language: row.language,
                s3Key: `retained/${this.user}/${row.clipId}.bin`,
            })),
    };
}

export const fakeArchiveServer = new FakeArchiveServer();
