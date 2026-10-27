// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the phone-side link from a recording to the log it
 * became, over a REAL Dexie (fake-indexeddb). The link is what lets the result screen and the day's feed play
 * a log's own recording; a log without a linked clip on this phone shows no ▶ — never a guessed clip.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../storage/DexieDatabase';
import { clipScanFloor, clipsForLogs, hasAudio, linkClipToLog } from '../clipLogLink';

const AT = '2026-10-26T05:00:00.000Z';

const clip = (id: string, over: Partial<VoiceClipCacheRecord> = {}): VoiceClipCacheRecord => ({
    id,
    farmId: 'farm-1',
    plotId: 'plot-1',
    recordedAtUtc: AT,
    durationMs: 4000,
    mimeType: 'audio/webm',
    sizeBytes: 4,
    // A sealed copy, as `persistVoiceClip` writes it (the bytes themselves do not matter here).
    ciphertext: new Uint8Array([1, 2, 3, 4]).buffer,
    iv: new Uint8Array([9, 9, 9]),
    wrappedDekId: 'dek-1',
    status: 'parsed',
    retentionPolicy: 'processing_30d',
    expiresAtUtc: '2026-11-25T05:00:00.000Z',
    createdAt: AT,
    updatedAt: AT,
    ...over,
} as unknown as VoiceClipCacheRecord);

describe('clipLogLink — recording ↔ log on this phone', () => {
    beforeEach(async () => { await getDatabase().voiceClips.clear(); });

    it('stamps the log on the clip found by its key, and nothing else', async () => {
        await getDatabase().voiceClips.bulkPut([clip('clip-1'), clip('clip-2', { recordedAtUtc: '2026-10-26T06:00:00.000Z' })]);
        expect(await linkClipToLog({ clipId: 'clip-1', recordedAtUtc: AT }, 'LOG-1')).toBe('clip-1');
        expect((await getDatabase().voiceClips.get('clip-1'))?.dailyLogId).toBe('LOG-1');
        expect((await getDatabase().voiceClips.get('clip-2'))?.dailyLogId).toBeUndefined();
    });

    it('with no key, the ONE unlinked clip recorded at that very instant is used', async () => {
        await getDatabase().voiceClips.bulkPut([clip('parser-minted-key'), clip('older', { recordedAtUtc: '2026-10-26T04:00:00.000Z' })]);
        expect(await linkClipToLog({ recordedAtUtc: AT }, 'LOG-1')).toBe('parser-minted-key');
    });

    it('two unlinked clips at the same instant are ambiguous: NEITHER is linked (no guess)', async () => {
        await getDatabase().voiceClips.bulkPut([clip('a'), clip('b')]);
        expect(await linkClipToLog({ recordedAtUtc: AT }, 'LOG-1')).toBeNull();
        expect((await getDatabase().voiceClips.toArray()).every(c => !c.dailyLogId)).toBe(true);
    });

    it('a clip already linked to another log is never re-used for a new one', async () => {
        await getDatabase().voiceClips.put(clip('taken', { dailyLogId: 'LOG-OLD' }));
        expect(await linkClipToLog({ recordedAtUtc: AT }, 'LOG-NEW')).toBeNull();
        expect((await getDatabase().voiceClips.get('taken'))?.dailyLogId).toBe('LOG-OLD');
    });

    it('no clip on this phone: nothing is linked', async () => {
        expect(await linkClipToLog({ clipId: 'missing', recordedAtUtc: AT }, 'LOG-1')).toBeNull();
    });

    it('clipsForLogs returns only the asked logs whose clip bytes are on this phone', async () => {
        await getDatabase().voiceClips.bulkPut([
            clip('c1', { dailyLogId: 'LOG-1' }),
            clip('c2', { dailyLogId: 'LOG-2', ciphertext: undefined, iv: undefined, wrappedDekId: undefined }), // bytes swept
            clip('c3', { dailyLogId: 'LOG-3' }),
            clip('c4'),
        ]);
        const found = await clipsForLogs(['LOG-1', 'LOG-2', 'LOG-9']);
        expect([...found.keys()]).toEqual(['LOG-1']);
        expect(found.get('LOG-1')?.id).toBe('c1');
        expect(hasAudio(clip('x', { ciphertext: undefined }))).toBe(false);
        expect(await clipsForLogs([])).toEqual(new Map());
    });

    it('the link is a NON-indexed field: the clips table schema is unchanged (no Dexie version bump)', () => {
        const indexes = getDatabase().voiceClips.schema.indexes.map(i => i.name);
        expect(indexes).not.toContain('dailyLogId');
    });

    it('clipsForLogs with a floor walks only clips recorded since then (through the recordedAtUtc index)', async () => {
        await getDatabase().voiceClips.bulkPut([
            clip('today', { dailyLogId: 'LOG-1' }),
            clip('weeks-ago', { dailyLogId: 'LOG-2', recordedAtUtc: '2026-10-01T05:00:00.000Z' }),
        ]);
        const floor = '2026-10-25T05:00:00.000Z';
        expect([...(await clipsForLogs(['LOG-1', 'LOG-2'], floor)).keys()]).toEqual(['LOG-1']);
        expect([...(await clipsForLogs(['LOG-1', 'LOG-2'])).keys()].sort()).toEqual(['LOG-1', 'LOG-2']);
    });

    it('clipScanFloor: a day before the earliest log was saved; unknown when any log has no time (scan all)', () => {
        expect(clipScanFloor([
            { meta: { createdAtISO: '2026-10-26T09:00:00.000Z' } },
            { meta: { createdAtISO: '2026-10-26T05:00:00.000Z' } },
        ])).toBe('2026-10-25T05:00:00.000Z');
        expect(clipScanFloor([{ meta: { createdAtISO: '2026-10-26T05:00:00.000Z' } }, { meta: {} }])).toBeUndefined();
        expect(clipScanFloor([])).toBeUndefined();
    });
});
