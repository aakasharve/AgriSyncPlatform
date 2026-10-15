// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves (voice archive path, defect D2)
 *
 * THE CLIENT HALF OF THE CROSS-STACK WIRE CONTRACT.
 *
 * Defect D2: the unit suites mocked `persistRetainedVoiceClip` / the API, so
 * nothing ever checked the BYTES the client puts on the wire against the real
 * server DTO. This test drives the REAL path - `archiveToRetainedTierIfConsented`
 * -> real seal -> real `persistRetainedVoiceClip` -> real `buildPersistRequestBody`
 * - and mocks only the HTTP transport underneath. Everything is pinned (clip id,
 * DEK, IV, plaintext, timestamps), so the JSON body is exactly reproducible.
 *
 * That JSON is committed as a fixture shared with the C# suite
 * (ShramSafal.Sync.IntegrationTests/Contract/VoiceArchive), which POSTs the
 * exact file contents to the REAL endpoint through the real ASP.NET pipeline.
 * This test FAILS when the client's output drifts from the fixture, and the
 * C# test fails when the server stops accepting the fixture: a change on either
 * side cannot pass CI alone. To regenerate after an intended change:
 *
 *     UPDATE_CONTRACT_FIXTURES=1 npx vitest run src/infrastructure/voice/__tests__/voiceArchive.wireContract.test.ts
 *
 * and commit the fixture; the C# test then proves the server accepts it.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

await vi.hoisted(async () => {
    const { Blob: NodeBlob } = await import('node:buffer');
    (globalThis as { Blob: unknown }).Blob = NodeBlob;
});

const { postMock, getMock } = vi.hoisted(() => ({ postMock: vi.fn(), getMock: vi.fn() }));

// A REAL KMS-wrapped DEK id is ~248 chars of base64url (observed on the real
// AWS-backed run); the fixture carries one so the server's column width is part of the contract.
const REAL_SIZED_DEK_ID = `AQIDAHh${'Zk3-_x9Q'.repeat(30)}AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM`.slice(0, 248);

vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: {
        http: { post: postMock, get: getMock },
        getConsent: async () => ({
            fullHistoryJournal: true,
            crossFarmAggregation: false,
            researchCorpusExport: false,
            version: 1,
            acceptedAtUtc: null,
            revokedAtUtc: null,
            fullHistoryJournalGrantedSinceUtc: '2026-01-01T00:00:00.000Z',
        }),
        getTenantDek: async () => ({
            dekId: REAL_SIZED_DEK_ID,
            dekBase64: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff))),
            expiresAtUtc: new Date(Date.now() + 3600_000).toISOString(),
        }),
    },
}));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClientError: vi.fn() }));

import { seedPulledFarm } from './seedPulledFarm';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { setActiveDatabaseName } from '../../storage/activeDatabaseName';
import { perUserDatabaseName } from '../../storage/userDatabaseName';
import { clearCachedDek } from '../../security/tenantDekClient';
import { archiveToRetainedTierIfConsented } from '../VoiceClipRetention';
import { toArchiveClipId } from '../archiveClipId';
import {
    buildPersistRequestBody,
    ByIdSchema,
    PersistResponseSchema,
    RangeResponseSchema,
} from '../../voiceDiary/voiceDiaryApiClient';

// vitest runs with cwd = src/clients/mobile-web (package root); the fixtures live beside the C# suite.
const FIXTURE_DIR = resolve(process.cwd(), '../../tests/ShramSafal.Sync.IntegrationTests/Contract/VoiceArchive');
const REQUEST_FIXTURE = resolve(FIXTURE_DIR, 'persist-request.json');
const RESPONSES_FIXTURE = resolve(FIXTURE_DIR, 'responses.json');

const LOCAL_ID = 'a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70';
const FARM = 'f1111111-1111-4111-8111-111111111111';
/** base64 of 16 zero bytes: a valid AES-GCM tag width, low entropy. */
const PLACEHOLDER_TAG = 'AAAAAAAAAAAAAAAAAAAAAA==';
const PLAINTEXT = Uint8Array.from({ length: 96 }, (_, i) => (i * 5 + 1) & 0xff);

function readFixture(path: string): string {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

describe('voice archive wire contract - client half', () => {
    beforeEach(async () => {
        setActiveDatabaseName(perUserDatabaseName('wire-contract-user'));
        try { await getDatabase().delete(); } catch { /* never created */ }
        await resetDatabase();
        clearCachedDek();
        postMock.mockReset();
        getMock.mockReset();
        postMock.mockImplementation(async (_url: string, body: { clipId: string }) => ({ data: { clipId: body.clipId } }));
        // A pinned IV makes AES-GCM deterministic, hence the whole body reproducible.
        vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((arr: Uint8Array) => {
            arr.set(Array.from({ length: arr.length }, (_, i) => i + 1));
            return arr;
        }) as never);
    });
    afterEach(() => vi.restoreAllMocks());

    async function archiveRealClip() {
        await seedPulledFarm(FARM, 'owner-a');
        await getDatabase().appMeta.put({ key: 'voice_archive_consent_since', value: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        await getDatabase().voiceClips.put({
            id: LOCAL_ID,
            farmId: FARM,
            recordedAtUtc: '2026-10-10T09:00:00.000Z',
            durationMs: 4000,
            mimeType: 'audio/webm',
            sizeBytes: PLAINTEXT.byteLength,
            localBlob: new Blob([PLAINTEXT], { type: 'audio/webm' }),
            status: 'parsed',
            retentionPolicy: 'processing_30d',
            expiresAtUtc: '2026-11-09T09:00:00.000Z',
            createdAt: '2026-10-10T09:00:00.000Z',
            updatedAt: '2026-10-10T09:00:00.000Z',
        } as never);
        return archiveToRetainedTierIfConsented(LOCAL_ID);
    }

    it('POSTs the exact fixture body to /shramsafal/voice-diary/persist, and the old local-id body is refused before the wire', async () => {
        const outcome = await archiveRealClip();
        expect(outcome.status).toBe('archived');
        expect(postMock).toHaveBeenCalledTimes(1);
        const [url, body] = postMock.mock.calls[0];
        expect(url).toBe('/shramsafal/voice-diary/persist');

        // The body is the real thing: archive Guid, no plaintext, no local id.
        expect((body as { clipId: string }).clipId).toBe(toArchiveClipId(LOCAL_ID));
        expect(JSON.stringify(body)).not.toContain(LOCAL_ID);
        expect(Object.keys(body as object).sort()).toEqual([
            'authTagBase64', 'cipherBase64', 'clipId', 'dekId', 'durationSeconds', 'ivBase64', 'language', 'recordedAtUtc',
        ]);

        // The REAL tag must be a 16-byte std-base64 value; the committed fixture carries a
        // low-entropy 16-zero-byte placeholder in its place (a real GCM tag is random-looking
        // and trips secret scanners). The server stores the tag and never verifies it, and
        // every other field is compared byte-for-byte against the real client output.
        const realTag = (body as { authTagBase64: string }).authTagBase64;
        expect(realTag).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(atob(realTag)).toHaveLength(16);
        expect(realTag).not.toBe(PLACEHOLDER_TAG);
        const produced = `${JSON.stringify({ ...(body as object), authTagBase64: PLACEHOLDER_TAG }, null, 2)}\n`;
        if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
            mkdirSync(dirname(REQUEST_FIXTURE), { recursive: true });
            writeFileSync(REQUEST_FIXTURE, produced, 'utf8');
        }
        expect(existsSync(REQUEST_FIXTURE)).toBe(true);
        expect(produced).toBe(readFixture(REQUEST_FIXTURE));

        // The pre-fix request (raw 64-hex local id) can no longer be built at all.
        expect(() => buildPersistRequestBody({ ...(body as Record<string, unknown>), clipId: LOCAL_ID } as never)).toThrow(/archive Guid/);
    });

    it('never sends a removed or unknown language, a fractional/zero duration, or a malformed envelope field', () => {
        const base = JSON.parse(readFixture(REQUEST_FIXTURE)) as Parameters<typeof buildPersistRequestBody>[0];
        expect(() => buildPersistRequestBody({ ...base, language: 'hi' as never })).toThrow(/language/);
        expect(() => buildPersistRequestBody({ ...base, language: 'hi-IN' as never })).toThrow(/language/);
        expect(() => buildPersistRequestBody({ ...base, durationSeconds: 0 })).toThrow(/durationSeconds/);
        expect(() => buildPersistRequestBody({ ...base, durationSeconds: 2.5 })).toThrow(/durationSeconds/);
        expect(() => buildPersistRequestBody({ ...base, durationSeconds: Number.NaN })).toThrow(/durationSeconds/);
        expect(() => buildPersistRequestBody({ ...base, recordedAtUtc: 'yesterday' })).toThrow(/recordedAtUtc/);
        expect(() => buildPersistRequestBody({ ...base, dekId: '' })).toThrow(/dekId/);
        expect(() => buildPersistRequestBody({ ...base, dekId: 'x'.repeat(513) })).toThrow(/dekId/);
        expect(() => buildPersistRequestBody({ ...base, ivBase64: '' })).toThrow(/ivBase64/);
        expect(() => buildPersistRequestBody({ ...base, ivBase64: 'a'.repeat(65) })).toThrow(/ivBase64/);
        expect(() => buildPersistRequestBody({ ...base, authTagBase64: 'not base64!' })).toThrow(/authTagBase64/);
        expect(() => buildPersistRequestBody({ ...base, cipherBase64: 'abc-_def' })).toThrow(/cipherBase64/); // url-safe variant
        expect(buildPersistRequestBody({ ...base, language: 'en-IN' }).language).toBe('en-IN');
        // Whatever the clip row holds, the archive sends a language the app offers.
        expect(base.language).toBe('mr-IN');
    });

    it('the server response shapes in the shared fixture satisfy the client zod schemas', () => {
        const responses = JSON.parse(readFixture(RESPONSES_FIXTURE)) as {
            persist: unknown; byRange: unknown; byId: unknown;
        };
        expect(PersistResponseSchema.safeParse(responses.persist).success).toBe(true);
        expect(RangeResponseSchema.safeParse(responses.byRange).success).toBe(true);
        expect(ByIdSchema.safeParse(responses.byId).success).toBe(true);
    });
});
