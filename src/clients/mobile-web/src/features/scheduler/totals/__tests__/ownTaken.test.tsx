// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half) - "तुम्ही घेतलेली N कामं": THIS farmer's own works taken from that schedule for this plot-season, counted
 * from what the phone holds (own works whose origin is a version of the schedule's chain). It is his own data, so no five-farmer rule; a 0 only when the phone really holds the
 * own list of the season, else no line.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

const language = { current: 'mr' as 'mr' | 'en' };
vi.mock('../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: language.current }) }));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { chainVersionIds, countOwnTaken, OwnTakenLine } from '../ownTaken';
import { ScheduleProfileCard } from '../../schedulePage/ScheduleProfileCard';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';

const V1 = '30000000-0000-4000-8000-000000000001';
const V2 = '30000000-0000-4000-8000-000000000002';
const OTHER = '30000000-0000-4000-8000-0000000000ff';
const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const OTHER_CYCLE = 'c2c2c2c2-0000-4000-8000-0000000000c2';
const hex = (id: string) => id.replace(/-/g, '');

const ROWS = [{ id: V1, previousVersionId: null }, { id: V2, previousVersionId: V1 }, { id: OTHER, previousVersionId: null }];

const task = (key: string): ScheduleTaskContent => ({ taskKey: key, name: key, kind: 'work', basis: 'experience', stageIndex: 0, order: 0 } as unknown as ScheduleTaskContent);
const put = (cropCycleId: string, key: string, origin: string | null, state: 'active' | 'removed' = 'active') => getDatabase().ownScheduleItems.put({
    id: `${cropCycleId}-${key}`, farmId: 'f', plotId: 'p', cropCycleId, taskKey: key, revision: 1, state, task: task(key), contentHash: 'h', origin, mainVersionId: null, updatedAtUtc: '2026-11-24T00:00:00Z',
} as never);

beforeEach(async () => { language.current = 'mr'; await getDatabase().ownScheduleItems.clear(); });
afterEach(() => cleanup());

describe('the chain of a schedule', () => {
    it('every version row linked to it, both ways, as 32-digit ids', () => {
        const ids = chainVersionIds(ROWS, V2, null);
        expect([...ids].sort()).toEqual([hex(V1), hex(V2)].sort());
        expect(ids.has(hex(OTHER))).toBe(false);
    });
    it('the chain id the server names is part of it even when the phone holds no row', () => {
        const ids = chainVersionIds([], V2, V1);
        expect([...ids].sort()).toEqual([hex(V1), hex(V2)].sort());
    });
});

describe('countOwnTaken', () => {
    const ids = new Set([hex(V1), hex(V2)]);
    it('counts only active works whose origin is in the chain', () => {
        expect(countOwnTaken([
            { state: 'active', origin: `take:${hex(V1)}` }, { state: 'active', origin: `take:${hex(V2)}` }, { state: 'removed', origin: `take:${hex(V1)}` },
            { state: 'active', origin: `take:${hex(OTHER)}` }, { state: 'active', origin: null },
        ], ids)).toBe(2);
    });
});

describe('the profile line', () => {
    const line = (cycle: string, rows = ROWS) => render(<OwnTakenLine cropCycleId={cycle} versionId={V2} chainId={null} templateRows={rows} />);
    it('says N from the own works of THIS season that came from the schedule\'s chain', async () => {
        await put(CYCLE, 'a', `take:${hex(V1)}`); await put(CYCLE, 'b', `take:${hex(V2)}`); await put(CYCLE, 'c', `take:${hex(OTHER)}`); await put(CYCLE, 'd', null);
        await put(OTHER_CYCLE, 'z', `take:${hex(V1)}`);
        line(CYCLE);
        expect(await screen.findByTestId('own-taken-line')).toHaveTextContent('तुम्ही घेतलेली २ कामं');
    });
    it('a 0 is shown when the phone holds the season\'s own list and none came from this schedule', async () => {
        await put(CYCLE, 'c', `take:${hex(OTHER)}`);
        line(CYCLE);
        expect(await screen.findByTestId('own-taken-line')).toHaveTextContent('तुम्ही घेतलेली ० कामं');
    });
    it('with no own list held for the season there is no line at all', async () => {
        await put(OTHER_CYCLE, 'z', `take:${hex(V1)}`);
        line(CYCLE);
        await new Promise(r => setTimeout(r, 50));
        expect(screen.queryByTestId('own-taken-line')).toBeNull();
    });
    it('English mode: English words and ASCII digits', async () => {
        language.current = 'en';
        await put(CYCLE, 'a', `take:${hex(V1)}`);
        line(CYCLE);
        const el = await screen.findByTestId('own-taken-line');
        expect(el).toHaveTextContent('You have taken 1 work from this schedule');
        expect(el.textContent).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('on the profile card', () => {
    const detail = { templateId: V2, chainId: V1, version: 2, contentHash: 'h', kind: 'reference', name: 'द्राक्ष', cropKey: 'grape', madeBy: { ownerType: 'INSTITUTION', label: null },
        check: { state: 'NotChecked', isChecked: false, checkedBy: null, checkedAtUtc: null }, stages: [], tasks: [], challenges: [], skipped: 0 };
    const load = async () => ({ ok: true as const, detail: detail as never, source: 'phone' as const, stale: false });
    it('a followed schedule says how many of his own works came from its chain (the chain id counts); with no ownTakenFor there is no such line', async () => {
        await put(CYCLE, 'a', `take:${hex(V1)}`);
        const { unmount } = render(<ScheduleProfileCard templateId={V2} plotName="G1" load={load} ownTakenFor={{ cropCycleId: CYCLE }} />);
        expect(await screen.findByTestId('own-taken-line')).toHaveTextContent('तुम्ही घेतलेली १ कामं');
        unmount();
        render(<ScheduleProfileCard templateId={V2} plotName="G1" load={load} />);
        await screen.findByTestId('profile-name');
        expect(screen.queryByTestId('own-taken-line')).toBeNull();
    });
});
