// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; decision 5, slice 9 finding) - the tab's same-work card: two followed schedules, one shared work,
 * ONE card with a source pick; take records the PICKED source; an unchecked source is marked with no dose and no take; a seat without the right sees no take.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { parseScheduleTask } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownDayOfStored, type DayCardsDetail } from '../../dayCards/dayCardsTypes';
import type { TakeHost } from '../../ownSchedule/TakeIntoMyScheduleButton';
import { SameWorkSection } from '../SameWorkSection';

const A = 'd0d0d0d0-0000-4000-8000-0000000000a1';
const B = 'd0d0d0d0-0000-4000-8000-0000000000b2';
const task = (from: number) => {
    const r = parseScheduleTask({ taskKey: 'spray-1', name: 'फवारणी १', kind: 'spray', basis: 'stated', timing: { timer: 'day', fromDay: from, toDay: from, repeat: 'once' }, sources: [{ document: 'पुस्तिका' }], products: [{ name: 'औषध', dose: '२ ग्रॅम', per: 'लिटर' }] });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};
const detail = (id: string, name: string, checked: boolean, from: number): DayCardsDetail => ({
    templateId: id, chainId: null, version: 1, contentHash: 'h' + id, kind: 'reference', name, cropKey: 'grape', madeBy: { ownerType: null, label: null },
    check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: null, checkedAtUtc: null }, stages: [],
    tasks: [{ task: task(from), contentHash: 'x', shown: { from: shownDayOfStored(from), to: shownDayOfStored(from), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked }],
    challenges: [], skipped: 0,
});
const load = (a: boolean, b: boolean) => async (id: string) => ({ ok: true as const, detail: id === A ? detail(A, 'संस्था', a, 12) : detail(B, 'तज्ज्ञ', b, 14), source: 'phone' as const, stale: false });
const host = (mayTake = true): TakeHost => ({
    place: { farmId: 'f0f0f0f0-0000-4000-8000-0000000000f1', plotId: 'a1a1a1a1-0000-4000-8000-0000000000a1', cropCycleId: 'c1c1c1c1-0000-4000-8000-0000000000c1' },
    mayTake, planning: { mayAssign: false, assignees: [], myUserId: 'b0b0b0b0-0000-4000-8000-0000000000b1' }, todayStored: 10,
});

afterEach(() => cleanup());
beforeEach(async () => { await resetDatabase(); await getDatabase().mutationQueue.clear(); });

describe('the tab same-work card', () => {
    it('two followed schedules, one shared work: ONE card with both sources and each own day', async () => {
        render(<SameWorkSection versionIds={[A, B]} load={load(true, true)} take={host()} />);
        expect(await screen.findAllByTestId('same-work-card')).toHaveLength(1);
        expect(screen.getByTestId(`same-work-source-${A}`)).toHaveTextContent('१३');
        expect(screen.getByTestId(`same-work-source-${B}`)).toHaveTextContent('१५');
        expect(await screen.findAllByTestId('take-btn-spray-1')).toHaveLength(1);
    });
    it('take records the PICKED source', async () => {
        render(<SameWorkSection versionIds={[A, B]} load={load(true, true)} take={host()} />);
        fireEvent.click(await screen.findByTestId(`same-work-source-${B}`));
        fireEvent.click(await screen.findByTestId('take-btn-spray-1'));
        await waitFor(async () => {
            const rows = await getDatabase().mutationQueue.toArray();
            expect(rows).toHaveLength(1);
            expect((rows[0].payload as any).sourceVersionId).toBe(B);
        });
    });
    it('an unchecked source is marked, shows no dose, and picking it offers no take', async () => {
        render(<SameWorkSection versionIds={[A, B]} load={load(true, false)} take={host()} />);
        fireEvent.click(await screen.findByTestId(`same-work-source-${B}`));
        expect(screen.getByTestId('same-work-unchecked')).toBeInTheDocument();
        expect(screen.queryByTestId('take-btn-spray-1')).toBeNull();
        expect(screen.queryByText(/२ ग्रॅम/)).toBeNull();
    });
    it('a seat without the right (a worker) sees the card but no take and no plan', async () => {
        render(<SameWorkSection versionIds={[A, B]} load={load(true, true)} take={host(false)} />);
        await screen.findByTestId('same-work-card');
        expect(screen.queryByTestId('take-btn-spray-1')).toBeNull();
        cleanup();
        render(<SameWorkSection versionIds={[A, B]} load={load(true, true)} />);
        await screen.findByTestId('same-work-card');
        expect(screen.queryByTestId('take-btn-spray-1')).toBeNull();
    });
    it('draws nothing when there is no shared work (one followed schedule)', async () => {
        const { container } = render(<SameWorkSection versionIds={[A]} load={load(true, true)} take={host()} />);
        await new Promise(r => setTimeout(r, 30));
        expect(container).toBeEmptyDOMElement();
    });
});
