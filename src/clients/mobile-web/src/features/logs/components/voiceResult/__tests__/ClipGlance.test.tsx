// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-24, V-5) — today's activity feed on आढावा, with
 * the recordings wired in over a real Dexie (fake-indexeddb):
 *   - ▶ on a card ONLY when that log's clip is on this phone (a log from another phone shows none, never a guess);
 *   - a snippet of his words, and a headline of what was understood (Marathi, from the real log);
 *   - pressing a card opens everything understood from that ONE recording, instead of the edit form;
 *     "बदला" there still opens the edit form (nothing lost).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../../infrastructure/voice/VoiceClipRetention', async (orig) => ({
    ...(await orig<typeof import('../../../../../infrastructure/voice/VoiceClipRetention')>()),
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { buildFeedEntries } from '../../../../../core/navigation/activityFeedEntries';
import { LogVerificationStatus, type CropProfile, type DailyLog } from '../../../../../types';
import { TodayActivityClipsSheet } from '../ClipGlance';

const SAID = 'आज चार मजूर आले आणि दोन तास पाणी दिलं';
const log = (id: string, over: Record<string, unknown> = {}): DailyLog => ({
    id, date: '2026-10-26', dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdByOperatorId: 'op1', createdAtISO: '2026-10-26T05:00:00.000Z' },
    ...over,
}) as unknown as DailyLog;

const HERE = log('LOG-HERE', {
    fullTranscript: SAID,
    labour: [{ id: 'lab', count: 4, sourceText: 'चार मजूर आले' }],
    irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
});
const ELSEWHERE = log('LOG-ELSEWHERE', {
    fullTranscript: 'फवारणी केली', cropActivities: [{ id: 'a', title: 'Spraying' }],
    meta: { createdByOperatorId: 'op2', createdAtISO: '2026-10-26T04:00:00.000Z' },
});

const clipRow = (id: string, dailyLogId: string): VoiceClipCacheRecord => ({
    id, dailyLogId, farmId: 'farm-1', plotId: 'p1', recordedAtUtc: '2026-10-26T05:00:00.000Z', durationMs: 6000,
    mimeType: 'audio/webm', sizeBytes: 3, ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek',
    status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-11-25T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord);

const crops = [{ id: 'c1', name: 'द्राक्ष', color: 'bg-purple-500', plots: [] }] as unknown as CropProfile[];
const entriesFor = (onOpenLog: (l: DailyLog) => void, logs: DailyLog[] = [HERE, ELSEWHERE]) => buildFeedEntries(logs, {
    crops, operatorNameById: new Map([['op1', 'पुर्वेश'], ['op2', 'रमेश']]), getLogContextSnapshot: () => ({ plotName: 'सोनाका', cropName: 'द्राक्ष' }), onOpenLog,
    youIds: new Set(['op1']),
});

let audios: Array<{ play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
const createAudio = () => {
    const a = { play: vi.fn(async () => undefined), pause: vi.fn(), duration: 6, currentTime: 0, onended: null, ontimeupdate: null, onloadedmetadata: null };
    audios.push(a);
    return a as unknown as HTMLAudioElement;
};

beforeEach(async () => {
    audios = [];
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await getDatabase().voiceClips.put(clipRow('clip-here', 'LOG-HERE'));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }));
});
afterEach(cleanup);

const cards = () => screen.getAllByTestId('log-list-item');

describe('the feed cards built from real logs', () => {
    it('headline = what was understood, in Marathi; snippet = his own words', () => {
        const [here, elsewhere] = entriesFor(vi.fn());
        expect(here.workDone).toBe('4 जण');
        expect(here.snippet).toBe(SAID);
        expect(elsewhere.workDone).toBe('पीक काम'); // the parser's English "Spraying" never reaches his screen
        expect(`${here.workDone} ${elsewhere.workDone}`).not.toMatch(/[A-Za-z]/);
    });
});

describe('TodayActivityClipsSheet — ▶ and the glance', () => {
    it('▶ ONLY on the card whose clip is on this phone; it plays that clip', async () => {
        render(<TodayActivityClipsSheet entries={entriesFor(vi.fn())} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[0]).getByTestId('card-play')).toBeTruthy());
        expect(within(cards()[1]).queryByTestId('card-play')).toBeNull();
        expect(within(cards()[0]).getByTestId('card-snippet').textContent).toBe(SAID);

        await act(async () => { fireEvent.click(within(cards()[0]).getByTestId('card-play')); });
        await waitFor(() => expect(audios).toHaveLength(1));
        expect(audios[0].play).toHaveBeenCalled();
        expect(screen.queryByTestId('clip-glance')).toBeNull(); // playing opens nothing
    });

    it('pressing a card opens everything understood from THAT recording, not the edit form; "बदला" still edits', async () => {
        const onOpenLog = vi.fn();
        render(<TodayActivityClipsSheet entries={entriesFor(onOpenLog)} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[0]).getByTestId('card-play')).toBeTruthy());
        fireEvent.click(within(cards()[0]).getByTestId('card-open'));
        expect(onOpenLog).not.toHaveBeenCalled();

        const glance = screen.getByTestId('clip-glance');
        expect(within(glance).getByTestId('clip-glance-understood').textContent).toContain('यातून काय समजलं');
        expect(glance.textContent).toContain('4 जण');
        expect(glance.textContent).toContain('2 तास');
        expect(within(glance).getByTestId('clip-glance-state').textContent).toBe('पक्कं नाही');
        const marks = [...within(glance).getByTestId('clip-glance-words').querySelectorAll('mark')].map(m => m.getAttribute('data-part'));
        expect(marks).toEqual(['labour', 'irrigation']);
        expect(within(glance).getByTestId('clip-glance-play')).toBeTruthy();

        fireEvent.click(within(glance).getByTestId('clip-glance-edit'));
        expect(onOpenLog).toHaveBeenCalledWith(HERE);
        expect(screen.queryByTestId('clip-glance')).toBeNull();
    });

    it('a recording from another phone opens its glance with no player (never a guessed clip)', async () => {
        render(<TodayActivityClipsSheet entries={entriesFor(vi.fn())} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[0]).getByTestId('card-play')).toBeTruthy());
        fireEvent.click(within(cards()[1]).getByTestId('card-open'));
        expect(screen.queryByTestId('clip-glance-play')).toBeNull();
        fireEvent.click(screen.getByTestId('clip-glance-back'));
        expect(screen.queryByTestId('clip-glance')).toBeNull();
        expect(screen.getByTestId('activity-feed-sheet')).toBeTruthy(); // back returns to the day
    });
});

describe('round 2 — the feed and the glance', () => {
    it('the glance names the phone holder "तुम्ही", like the result screen; someone else by name', async () => {
        render(<TodayActivityClipsSheet entries={entriesFor(vi.fn())} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[0]).getByTestId('card-play')).toBeTruthy());
        fireEvent.click(within(cards()[0]).getByTestId('card-open'));
        expect(screen.getByTestId('clip-glance-who').textContent).toBe('तुम्ही');
        fireEvent.click(screen.getByTestId('clip-glance-back'));
        fireEvent.click(within(cards()[1]).getByTestId('card-open'));
        expect(screen.getByTestId('clip-glance-who').textContent).toBe('रमेश');
    });

    it('every plot card of ONE recording plays its clip (the link sits on the log with his words) and opens the whole recording', async () => {
        const SIBLING = log('LOG-SIBLING', {
            context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p2'], selectedPlotNames: ['थॉमसन'] }] },
            irrigation: [{ id: 'irr-2', durationHours: 1 }],
        }); // same moment, same speaker as HERE: the same recording, no words of its own
        render(<TodayActivityClipsSheet entries={entriesFor(vi.fn(), [HERE, SIBLING])} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[1]).getByTestId('card-play')).toBeTruthy());
        fireEvent.click(within(cards()[1]).getByTestId('card-open'));
        const glance = screen.getByTestId('clip-glance');
        expect(within(glance).getByTestId('clip-glance-words').textContent).toBe(SAID);
        expect(within(glance).getByTestId('clip-glance-play')).toBeTruthy();
        expect(glance.textContent).toContain('1 तास'); // the sibling's own part …
        expect(glance.textContent).toContain('4 जण'); // … and the rest of what that one recording said
    });

    it('a card never headlines what the server could not verify', () => {
        const unsure = log('LOG-UNSURE', { labour: [{ id: 'l', count: 9, provenanceVerified: false }] });
        const [entry] = entriesFor(vi.fn(), [unsure]);
        expect(entry.workDone).toBe('—');
    });
});

describe('round 4 — his clock, in Marathi, on the card and in the glance (I13-V3 M1)', () => {
    const LATIN = /[A-Za-z]/;

    it('the card and the glance read the same recording\'s time as the result screen does ("सकाळी 10:30", never "10:30 AM")', async () => {
        render(<TodayActivityClipsSheet entries={entriesFor(vi.fn())} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        await waitFor(() => expect(within(cards()[0]).getByTestId('card-play')).toBeTruthy());
        expect(within(cards()[0]).getByTestId('card-time').textContent).toBe('सकाळी 10:30');
        expect(within(cards()[1]).getByTestId('card-time').textContent).toBe('सकाळी 9:30');
        for (const card of cards()) expect(card.textContent ?? '').not.toMatch(LATIN);

        fireEvent.click(within(cards()[0]).getByTestId('card-open'));
        const glance = screen.getByTestId('clip-glance');
        expect(glance.textContent).toContain('सकाळी 10:30');
        expect(glance.textContent ?? '').not.toMatch(LATIN); // the WHOLE open sheet, not only its headline
        fireEvent.click(screen.getByTestId('clip-glance-back'));
        fireEvent.click(within(cards()[1]).getByTestId('card-open'));
        expect(screen.getByTestId('clip-glance').textContent ?? '').not.toMatch(LATIN);
    });

    it('a typed entry (no time captured) shows no time at all, never a made-up "दुपारी 12:00"', () => {
        const typed = log('LOG-TYPED', { labour: [{ id: 'l', count: 2 }], meta: { createdByOperatorId: 'op1', createdAtISO: '2026-10-26T12:00:00' } });
        const [entry] = entriesFor(vi.fn(), [typed]);
        expect(entry.timeLabel).toBe('');
        render(<TodayActivityClipsSheet entries={[entry]} dateLabel="सोमवार" onClose={vi.fn()} createAudio={createAudio} />);
        expect(within(cards()[0]).queryByTestId('card-time')).toBeNull();
        fireEvent.click(within(cards()[0]).getByTestId('card-open'));
        expect(screen.getByTestId('clip-glance').textContent).not.toContain('12:00');
    });
});
