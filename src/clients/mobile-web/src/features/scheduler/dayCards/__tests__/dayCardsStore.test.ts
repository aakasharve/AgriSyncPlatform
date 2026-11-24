// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8; P10, P11) - the phone's copy of the day cards is a disposable cache: kept when the server answers, used
 * with no signal, replaced when the content hash changes, dropped when the server no longer knows the version or the copy cannot be read.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { loadDayCards, readCachedDayCards } from '../dayCardsStore';

const ID = '22222222-2222-4222-8222-222222222222';

const body = (hash: string) => ({
    templateId: ID, chainId: ID, version: 1, contentHash: hash, kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'संस्था' }, check: { state: 'NotChecked', isChecked: false, checkedBy: null, checkedAtUtc: null },
    stages: [], challenges: [],
    tasks: [{ taskKey: 't', contentHash: 'x', doseChecked: false, shown: {}, task: { taskKey: 't', name: 'काम', kind: 'work', basis: 'stated', timing: { timer: 'day', fromDay: 0, toDay: 0, repeat: 'once' } } }],
});

const answer = (status: number, json?: unknown) => async () => new Response(json === undefined ? null : JSON.stringify(json), { status });
const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

beforeEach(async () => { setOnline(true); await getDatabase().scheduleDayCards.clear(); });
afterEach(() => setOnline(true));

describe('the day-card cache', () => {
    it('keeps the server answer, then opens it with no signal, marked stale', async () => {
        const first = await loadDayCards(ID, answer(200, body('h1')));
        expect(first).toMatchObject({ ok: true, source: 'network', stale: false });
        expect((await getDatabase().scheduleDayCards.get(ID))?.contentHash).toBe('h1');

        setOnline(false);
        const off = await loadDayCards(ID, async () => { throw new Error('no network must be needed'); });
        expect(off).toMatchObject({ ok: true, source: 'phone', stale: true });
        if (off.ok) expect(off.detail.tasks[0].doseChecked).toBe(false);
    });

    it('with no signal and no copy it says so', async () => {
        setOnline(false);
        expect(await loadDayCards(ID, answer(200, body('h1')))).toEqual({ ok: false, reason: 'offline-no-copy' });
    });

    it('replaces the copy when the content hash changes, and keeps it when the hash is the same', async () => {
        await loadDayCards(ID, answer(200, body('h1')));
        const at = (await getDatabase().scheduleDayCards.get(ID))?.fetchedAtUtc;
        await loadDayCards(ID, answer(200, body('h1')));
        expect((await getDatabase().scheduleDayCards.get(ID))?.fetchedAtUtc).toBe(at);
        await loadDayCards(ID, answer(200, body('h2')));
        expect((await getDatabase().scheduleDayCards.get(ID))?.contentHash).toBe('h2');
    });

    it('a version the server no longer knows for this caller is dropped from the phone, never drawn from the old copy', async () => {
        await loadDayCards(ID, answer(200, body('h1')));
        expect(await loadDayCards(ID, answer(404))).toEqual({ ok: false, reason: 'not-found' });
        expect(await readCachedDayCards(ID)).toBeNull();
    });

    it('a server error falls back to the copy; an unreadable copy is deleted', async () => {
        await loadDayCards(ID, answer(200, body('h1')));
        expect(await loadDayCards(ID, answer(500))).toMatchObject({ ok: true, source: 'phone', stale: true });
        await getDatabase().scheduleDayCards.put({ templateId: ID, contentHash: 'bad', fetchedAtUtc: 'x', detail: { nonsense: true } });
        expect(await readCachedDayCards(ID)).toBeNull();
        expect(await getDatabase().scheduleDayCards.get(ID)).toBeUndefined();
    });

    it('a version id that is not an id is never asked for', async () => {
        expect(await loadDayCards('../../x', answer(200, body('h1')))).toEqual({ ok: false, reason: 'not-found' });
    });
});
