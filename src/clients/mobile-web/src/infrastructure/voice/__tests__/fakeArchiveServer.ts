// Test double for the server half of the voice archive, shared by the voice
// archive tests. It models ONLY what the real contracts promise:
//   - persist: consent-gated, idempotent per (user, clip), echoes the clip id
//   - by-id / by-range: scoped to the signed-in user, never across users
//   - tenant DEK issue / resolve (D1): the caller names a FARM; the server derives
//     the owner account from that farm and the key is per-owner-account, resolvable
//     only under that owner account (KMS EncryptionContext). A call with no farm id
//     is refused, as the real route does (400).
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
    /** Every farm id the client named on a DEK issue / resolve call (D1: it must always name one). */
    dekFarmIds: Array<string | undefined> = [];
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
        this.dekFarmIds = [];
        this.failPersist = 0;
        this.failPersistWith = null;
        this.ackWrongId = false;
        this.holdPersist = null;
    }

    private dekIdFor(owner: string): string {
        return `dek-${owner}-v1`;
    }

    /**
     * The owner account the SERVER would derive from a farm id. Farms a test never mapped
     * belong to the signed-in tenant's account; the `farm-for-<owner>` ids the /me/context
     * fake mints belong to that owner.
     */
    private ownerOfFarm(farmId: string): string {
        return farmId.startsWith('farm-for-') ? farmId.slice('farm-for-'.length) : this.tenantOwner;
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
        getTenantDek: async (farmId?: string) => {
            this.dekFetches += 1;
            this.dekFarmIds.push(farmId);
            if (!farmId) throw new Error('400: farmId is required');
            const owner = this.ownerOfFarm(farmId);
            return {
                dekId: this.dekIdFor(owner),
                dekBase64: bytesToBase64(deterministicKey(owner)),
                expiresAtUtc: new Date(Date.now() + 3600_000).toISOString(),
            };
        },
        resolveDek: async (dekId: string, farmId?: string) => {
            this.dekFarmIds.push(farmId);
            if (!farmId) throw new Error('400: farmId is required');
            // KMS EncryptionContext: only the owning account (derived from the farm) may unwrap.
            const owner = this.ownerOfFarm(farmId);
            if (dekId !== this.dekIdFor(owner)) return null;
            return { dekBase64: bytesToBase64(deterministicKey(owner)) };
        },
        getMeContext: async () => ({
            farms: (this.memberships.get(this.user) ?? []).map(ownerAccountId => ({
                ownerAccountId,
                farmId: `farm-for-${ownerAccountId}`,
            })),
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
