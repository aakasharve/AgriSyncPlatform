// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4 + CMP-D3; D-68 round 2/3, D-66, D-69, R12; P3, P4, P10)
 *
 * The optional reason on "तुमचं स्वतःचं काम": three picture choices, his typed words, the mic. Only the edges are mocked: the outbox
 * (`mutationQueue.enqueue`, so the REAL `SetLogReasonCommand` builds the payload), the mic recorder and the voice parse. A reason is a write of
 * ONE kind - `logreason.set` - and nothing else is written, offline included.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FarmCompareResult } from '../data/compareClient';
import { FARM, PLOT_ID, answerOf } from './compareFixtures';

const SAID = 'वेलीला आधार हवा होता';
const parsed = (transcript?: string) => ({ success: true, data: { plannedTasks: [{ title: 'दुसरंच काम', dueHint: 'उद्या' }], fullTranscript: transcript }, rawTranscript: transcript });
// the REAL `understandPlanSpeech` runs; only the network-side parse (the batch voice-parse client) is faked
const h = vi.hoisted(() => ({ parse: undefined as unknown, parseInput: vi.fn() }));
const enqueue = vi.hoisted(() => vi.fn(async () => 'ok'));

vi.mock('../../../infrastructure/sync/MutationQueue', () => ({ mutationQueue: { enqueue } }));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn(), true] as const }));
vi.mock('../../../infrastructure/ai/BackendAiClient', () => ({ BackendAiClient: class { parseInput(...a: unknown[]) { return h.parseInput(...a); } } }));
vi.mock('../../plannedWork/components/PlanMic', () => ({
    default: ({ onAudio }: { onAudio: (a: unknown) => void }) => (
        <button type="button" data-testid="plan-mic" onClick={() => onAudio({ base64: 'eA==', mimeType: 'audio/webm', recordedAtUtc: '2026-11-14T06:30:00.000Z' })}>mic</button>
    ),
}));

import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { CompareView } from '../CompareView';

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

function openOwn(change?: Parameters<typeof answerOf>[0]) {
    const compare = answerOf(change);
    const result = { kind: 'compare', compare, source: 'server', asOfUtc: compare.serverTimeUtc } as Extract<FarmCompareResult, { kind: 'compare' }>;
    const plot = compare.plots.find(p => p.plotId === PLOT_ID)!;
    render(<CompareView result={result} plot={plot} farmId={FARM} chip="द्राक्ष · सोनाका" language="mr" crops={[]} onChange={() => undefined} />);
    fireEvent.click(screen.getByTestId('compare-tile-work'));
    fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
}
const kept = () => enqueue.mock.calls as unknown as [string, Record<string, unknown>, { clientRequestId: string }][];

beforeEach(() => { enqueue.mockClear(); h.parse = parsed(SAID); h.parseInput.mockReset(); h.parseInput.mockImplementation(async () => h.parse); setOnline(true); });
afterEach(() => { cleanup(); setOnline(true); });

describe('the three picture choices', () => {
    it.each([['Practice', 'माझी पद्धत'], ['Extra', 'जास्तीचं काम'], ['Weather', 'हवामानामुळे बदल']] as const)(
        'a tap on "%s" queues ONE logreason.set with the record\'s id and key, that kind, no words, not by voice - and writes nothing else',
        async (kind, label) => {
            openOwn();
            expect(screen.getByTestId(`compare-reason-${kind}`).textContent).toBe(label);
            fireEvent.click(screen.getByTestId(`compare-reason-${kind}`));
            await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
            const [name, payload, options] = kept()[0];
            expect(name).toBe(SyncMutationName.LogreasonSet);
            expect(payload).toMatchObject({ farmId: FARM, dailyLogId: 'log-1', workKey: 'work:vine-tying', kind, saidByVoice: false });
            expect(payload).not.toHaveProperty('words');
            expect(String(payload.reasonId)).toMatch(/\S/);
            expect(options.clientRequestId).toBe(`logreason.set:${String(payload.reasonId)}`);
            await waitFor(() => expect(screen.getByTestId('compare-own-saved').textContent).toContain(label));
            expect(screen.getByTestId(`compare-reason-${kind}`)).toHaveAttribute('aria-checked', 'true');
        },
    );

    it('the same picture again is not a new reason (nothing is queued twice)', async () => {
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await new Promise(r => setTimeout(r, 20));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('P006: two quick taps on the same picture (before the first save returns) queue ONE reason', async () => {
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await new Promise(r => setTimeout(r, 30));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('P006: a save that failed can be tried again with the same picture', async () => {
        enqueue.mockRejectedValueOnce(new Error('queue closed'));
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await waitFor(() => expect(screen.getByTestId('compare-reason-failed')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('compare-reason-Weather'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
        enqueue.mockRejectedValueOnce(new Error('queue closed'));
        fireEvent.click(screen.getByTestId('compare-reason-Practice'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(3));
        await waitFor(() => expect(screen.getByTestId('compare-reason-failed')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('compare-reason-Practice'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(4));
    });

    it('another picture is a NEW reason (the server keeps the latest)', async () => {
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByTestId('compare-reason-Weather'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
        expect(kept()[1][1]).toMatchObject({ kind: 'Weather' });
        expect(kept()[1][1].reasonId).not.toBe(kept()[0][1].reasonId);
    });

    it('the picture is a radio group with names; the choices are 44 px or more', () => {
        openOwn();
        const group = screen.getByRole('radiogroup', { name: 'का केलं' });
        expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
        for (const k of ['Practice', 'Extra', 'Weather']) expect(screen.getByTestId(`compare-reason-${k}`).className).toMatch(/min-h-\[(7\d)px\]/);
    });
});

describe('typed words', () => {
    it('words with no picture yet wait for a picture ("आधी एक चित्र निवडा."); nothing is queued', () => {
        openOwn();
        fireEvent.change(screen.getByTestId('compare-reason-words'), { target: { value: 'वेलीला आधार हवा होता' } });
        expect(screen.getByTestId('compare-pick-first').textContent).toBe('आधी एक चित्र निवडा.');
        expect(screen.getByTestId('compare-reason-save')).toBeDisabled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('a picture, then his words and "जतन करा": the second reason carries the words, typed (not by voice)', async () => {
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByTestId('compare-reason-words'), { target: { value: '  वेलीला आधार हवा होता  ' } });
        fireEvent.click(screen.getByTestId('compare-reason-save'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
        expect(kept()[1][1]).toMatchObject({ kind: 'Extra', words: 'वेलीला आधार हवा होता', saidByVoice: false, dailyLogId: 'log-1', workKey: 'work:vine-tying' });
        await waitFor(() => expect(screen.getByTestId('compare-own-saved-words').textContent).toContain('वेलीला आधार हवा होता'));
    });

    it('words typed first travel with the picture that is chosen next', async () => {
        openOwn();
        fireEvent.change(screen.getByTestId('compare-reason-words'), { target: { value: 'पावसामुळे' } });
        fireEvent.click(screen.getByTestId('compare-reason-Weather'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(kept()[0][1]).toMatchObject({ kind: 'Weather', words: 'पावसामुळे', saidByVoice: false });
    });

    it('a write that fails says so plainly and shows no saved reason', async () => {
        enqueue.mockRejectedValueOnce(new Error('queue closed'));
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Practice'));
        await waitFor(() => expect(screen.getByTestId('compare-reason-failed').textContent).toBe('जतन झालं नाही. पुन्हा करा.'));
        expect(screen.queryByTestId('compare-own-saved')).toBeNull();
    });
});

describe('the mic: online only, the transcript only', () => {
    it('online: the mic is offered; what he says lands in the words box as the transcript ONLY (the parse\'s task title is dropped) and saves as by voice', async () => {
        openOwn();
        expect(screen.getByTestId('compare-mic-block')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).toBe('वेलीला आधार हवा होता'));
        expect(h.parseInput).toHaveBeenCalledTimes(1);
        expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).not.toContain('दुसरंच काम');
        fireEvent.click(screen.getByTestId('compare-reason-Practice'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(kept()[0][1]).toMatchObject({ kind: 'Practice', words: 'वेलीला आधार हवा होता', saidByVoice: true });
        expect(screen.getByTestId('compare-own-saved').textContent).toContain('बोलून सांगितलं');
    });

    it('words he changed after the mic are his typed words: not "by voice"', async () => {
        openOwn();
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).not.toBe(''));
        fireEvent.change(screen.getByTestId('compare-reason-words'), { target: { value: 'वेलीला आधार हवा होता, वारा होता' } });
        fireEvent.click(screen.getByTestId('compare-reason-Weather'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(kept()[0][1]).toMatchObject({ words: 'वेलीला आधार हवा होता, वारा होता', saidByVoice: false });
    });

    it('a parse that fails says so and leaves the words box alone', async () => {
        h.parse = { success: false, error: 'x' };
        openOwn();
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('compare-mic-failed')).toBeInTheDocument());
        expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).toBe('');
    });

    it('P004: a parse that heard NO words but found a task title is "not understood": the box stays empty, the task title never reaches it, nothing is kept as voice', async () => {
        h.parse = parsed(undefined);
        openOwn();
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect(screen.getByTestId('compare-mic-failed')).toBeInTheDocument());
        expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).toBe('');
        fireEvent.click(screen.getByTestId('compare-reason-Practice'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(kept()[0][1]).toMatchObject({ saidByVoice: false });
        expect(kept()[0][1]).not.toHaveProperty('words');
    });

    it('P007: a transcript longer than the 1000-character limit is cut to it, so the save still goes through', async () => {
        h.parse = parsed('क'.repeat(1200));
        openOwn();
        fireEvent.click(screen.getByTestId('plan-mic'));
        await waitFor(() => expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value.length).toBe(1000));
        fireEvent.click(screen.getByTestId('compare-reason-Extra'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(String(kept()[0][1].words).length).toBe(1000);
        expect(kept()[0][1]).toMatchObject({ saidByVoice: true });
    });

    it('offline: the mic is NOT offered, the sheet says plainly the spoken words need the internet, and never promises the words will wait', () => {
        setOnline(false);
        openOwn();
        expect(screen.queryByTestId('plan-mic')).toBeNull();
        expect(screen.queryByTestId('compare-mic-block')).toBeNull();
        const note = screen.getByTestId('compare-mic-offline').textContent ?? '';
        expect(note).toBe('इंटरनेट नाही, म्हणून बोलून सांगता येत नाही. चित्र निवडलं की पुरेसं आहे.');
        expect(note).not.toMatch(/नंतर|वाट|आल्यावर|जतन|साठव/);
        expect(h.parseInput).not.toHaveBeenCalled();
    });

    it('offline: a picture still saves - it is queued in the outbox as logreason.set and nothing else is written', async () => {
        setOnline(false);
        openOwn();
        fireEvent.click(screen.getByTestId('compare-reason-Weather'));
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(kept().map(c => c[0])).toEqual([SyncMutationName.LogreasonSet]);
        expect(kept()[0][1]).toMatchObject({ farmId: FARM, dailyLogId: 'log-1', workKey: 'work:vine-tying', kind: 'Weather' });
    });
});

describe('English mode', () => {
    it('the reason sheet speaks English only', async () => {
        const compare = answerOf(a => { a.plots[0].stages[1].name = 'Flowering'; a.plots[0].ownWork[0].stageName = 'Flowering'; a.plots[0].ownWork[0].title = 'Vine tying'; });
        const result = { kind: 'compare', compare, source: 'server', asOfUtc: compare.serverTimeUtc } as Extract<FarmCompareResult, { kind: 'compare' }>;
        render(<CompareView result={result} plot={compare.plots[0]} farmId={FARM} chip="Grape · Sonaka" language="en" crops={[]} onChange={() => undefined} />);
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
        const sheet = screen.getByTestId('compare-own-sheet');
        expect(sheet.textContent).toContain('None of your schedules had this in this stage. It may be your own practice.');
        expect(sheet.textContent).toContain('My method');
        expect(sheet.textContent).toContain('Extra work');
        expect(sheet.textContent).toContain('Changed for weather');
        expect(sheet.textContent).toContain('Say why you did it');
        expect(sheet.textContent?.match(/[ऀ-ॿ]/g)).toBeNull();
    });
});
