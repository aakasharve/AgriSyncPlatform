// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; P4, P10) - the totals as the phone holds them: exactly what the server sent, kept per schedule
 * with no new store, opened with no signal, never invented.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { loadScheduleTotals, parseScheduleTotals } from '../scheduleTotalsStore';
import { FULL_ANSWER, NULL_ANSWER, OWN_ANSWER, SAMPLE_ANSWER, SCHED_A, json, setOnline } from './totalsFixtures';

beforeEach(async () => { setOnline(true); await getDatabase().referenceData.clear(); });
afterEach(() => setOnline(true));

describe('parseScheduleTotals', () => {
    it('reads every field exactly as sent', () => {
        expect(parseScheduleTotals(FULL_ANSWER)).toEqual(FULL_ANSWER);
    });
    it('a sample and an own schedule carry no number whatever the body says', () => {
        expect(parseScheduleTotals({ ...FULL_ANSWER, kind: 'sample' })).toMatchObject({ kind: 'sample', following: null, having: null, worksTaken: null, doneJobs: null, heard: null, works: [] });
        expect(parseScheduleTotals({ ...FULL_ANSWER, kind: 'own' })).toMatchObject({ kind: 'own', following: null, works: [] });
    });
    it('a number that is not a whole number is a null, never a guess; an unknown kind is no answer', () => {
        expect(parseScheduleTotals({ ...FULL_ANSWER, following: '37', having: -2, heard: 1.5 })).toMatchObject({ following: null, having: null, heard: null });
        expect(parseScheduleTotals({ ...FULL_ANSWER, kind: 'mystery' })).toBeNull();
        expect(parseScheduleTotals(null)).toBeNull();
    });
});

describe('loadScheduleTotals', () => {
    it('keeps the answer under one key per schedule, then opens it with no signal marked as the phone copy', async () => {
        const first = await loadScheduleTotals(SCHED_A, json(200, FULL_ANSWER));
        expect(first).toMatchObject({ ok: true, source: 'network', totals: FULL_ANSWER });
        expect(await getDatabase().referenceData.get(`scheduleTotals:${SCHED_A}` as never)).toBeTruthy();
        setOnline(false);
        const off = await loadScheduleTotals(SCHED_A, async () => { throw new Error('no network must be needed'); });
        expect(off).toMatchObject({ ok: true, source: 'phone', totals: FULL_ANSWER });
    });
    it('with no signal and no kept answer nothing is returned to draw', async () => {
        setOnline(false);
        expect(await loadScheduleTotals(SCHED_A, json(200, FULL_ANSWER))).toEqual({ ok: false, reason: 'offline-no-copy' });
    });
    it('a failed request falls back to the kept answer; with none it fails', async () => {
        expect(await loadScheduleTotals(SCHED_A, json(500))).toEqual({ ok: false, reason: 'failed' });
        await loadScheduleTotals(SCHED_A, json(200, NULL_ANSWER));
        expect(await loadScheduleTotals(SCHED_A, json(500))).toMatchObject({ ok: true, source: 'phone' });
    });
    it('a schedule the server no longer shows this person loses its kept numbers', async () => {
        await loadScheduleTotals(SCHED_A, json(200, FULL_ANSWER));
        expect(await loadScheduleTotals(SCHED_A, json(404))).toEqual({ ok: false, reason: 'not-found' });
        expect(await getDatabase().referenceData.get(`scheduleTotals:${SCHED_A}` as never)).toBeUndefined();
    });
    it('a sample or an own answer is kept as such, with no number', async () => {
        expect(await loadScheduleTotals(SCHED_A, json(200, SAMPLE_ANSWER))).toMatchObject({ ok: true, totals: { kind: 'sample', following: null } });
        expect(await loadScheduleTotals(SCHED_A, json(200, OWN_ANSWER))).toMatchObject({ ok: true, totals: { kind: 'own', following: null } });
    });
});
