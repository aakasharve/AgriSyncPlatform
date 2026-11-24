// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - the viewer: opens on the shown day, steps through the days, always has a back, keeps sound and buzz
 * off until the farmer turns them on, shows what an answer changes, says so when the cards are not on the phone, and drops a copy the server no longer knows (P10).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { DayCardsViewer } from '../DayCardsViewer';
import type { DayCardsLoad } from '../dayCardsStore';
import { shownDayOfStored, type DayCardsDetail } from '../dayCardsTypes';

const task = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({ taskKey: 't', name: 'काम', kind: 'work', basis: 'stated', timing: { timer: 'day', fromDay: 0, toDay: 0, repeat: 'once' }, sources: [{ document: 'पुस्तिका' }], ...over });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

const A = task({ taskKey: 'a', name: 'पहिलं काम', steps: ['एक'], timing: { timer: 'day', fromDay: 0, toDay: 0, repeat: 'once' } });
const B = task({ taskKey: 'b', name: 'मणी पाहणी', kind: 'observe', timing: { timer: 'day', fromDay: 1, toDay: 1, repeat: 'once' }, ask: { question: 'पाहिलं का?', answers: [{ answer: 'yes', changes: 'पुढे जा' }] } });

const detail: DayCardsDetail = {
    templateId: '11111111-1111-4111-8111-111111111111', chainId: null, version: 1, contentHash: 'h', kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'संस्था' }, check: { state: 'Checked', isChecked: true, checkedBy: 'तपासनीस', checkedAtUtc: null },
    stages: [{ index: 0, name: 'छाटणी', from: shownDayOfStored(0)!, to: shownDayOfStored(2)!, startSign: null, endSign: null }],
    tasks: [A, B].map(t => ({ task: t, contentHash: 'x', shown: { from: shownDayOfStored(t.timing.fromDay), to: shownDayOfStored(t.timing.toDay), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: true })),
    challenges: [], skipped: 0,
};

const ok = (): Promise<DayCardsLoad> => Promise.resolve({ ok: true, detail, source: 'network', stale: false });

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('DayCardsViewer', () => {
    it('opens on the shown day, steps to the next and back, and stops at the ends', async () => {
        render(<DayCardsViewer source={{ templateId: detail.templateId }} target={{ day: 1 }} onClose={() => undefined} load={ok} />);
        await waitFor(() => expect(screen.getAllByText('पहिलं काम', { selector: 'h2' }).length).toBeGreaterThan(0));
        expect(screen.getByTestId('day-prev')).toHaveProperty('disabled', true);
        fireEvent.click(screen.getByTestId('day-next'));
        await waitFor(() => expect(screen.getAllByText('मणी पाहणी', { selector: 'h2' }).length).toBeGreaterThan(0));
        expect(screen.queryAllByText('पहिलं काम', { selector: 'h2' })).toHaveLength(0);
        expect(screen.getByTestId('day-stepper-day').textContent).toBe('दिवस २');
        fireEvent.click(screen.getByTestId('day-next'));
        await waitFor(() => expect(screen.getByTestId('day-stepper-day').textContent).toBe('दिवस ३'));
        expect(screen.getByTestId('day-next')).toHaveProperty('disabled', true);
        expect(screen.getByText('आज ठरलेलं काम नाही')).toBeTruthy();
    });

    it('always has a back that closes it', async () => {
        const onClose = vi.fn();
        render(<DayCardsViewer source={{ templateId: detail.templateId }} target={{ day: 1 }} onClose={onClose} load={ok} />);
        fireEvent.click(screen.getByTestId('day-cards-back'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a work target opens that one work, with no day stepper', async () => {
        render(<DayCardsViewer source={{ detail }} target={{ taskKey: 'b' }} onClose={() => undefined} />);
        expect(screen.getAllByText('मणी पाहणी', { selector: 'h2' }).length).toBeGreaterThan(0);
        expect(screen.queryByTestId('day-stepper')).toBeNull();
    });

    it('sound and buzz are off until the farmer turns them on, and the choice is kept', async () => {
        render(<DayCardsViewer source={{ detail }} target={{ taskKey: 'a' }} onClose={() => undefined} />);
        expect(screen.getByTestId('switch-sound').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('switch-buzz').getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(screen.getByTestId('switch-buzz'));
        expect(screen.getByTestId('switch-buzz').getAttribute('aria-pressed')).toBe('true');
        await waitFor(async () => expect((await getDatabase().uiPrefs.get('dayCards.buzz'))?.value).toBe(true));
        expect((await getDatabase().uiPrefs.get('dayCards.sound'))?.value ?? false).toBe(false);
    });

    it('an answer shows what it changes and changes nothing by itself', () => {
        render(<DayCardsViewer source={{ detail }} target={{ taskKey: 'b' }} onClose={() => undefined} />);
        fireEvent.click(screen.getByTestId('ask-yes'));
        expect(screen.getByTestId('answer-sheet').textContent).toContain('पुढे जा');
        fireEvent.click(screen.getByTestId('ask-no'));
        expect(screen.getByTestId('answer-sheet').textContent).toContain('यावर काही बदलत नाही');
    });

    it('says so, with a way to try again, when the cards are not on the phone', async () => {
        const none = (): Promise<DayCardsLoad> => Promise.resolve({ ok: false, reason: 'offline-no-copy' });
        render(<DayCardsViewer source={{ templateId: detail.templateId }} target={{ day: 1 }} onClose={() => undefined} load={none} />);
        await waitFor(() => expect(screen.getByTestId('day-cards-unavailable')).toBeTruthy());
        expect(screen.getByText('पुन्हा पाहा')).toBeTruthy();
    });
});
