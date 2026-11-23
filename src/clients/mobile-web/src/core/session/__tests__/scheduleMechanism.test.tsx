// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - slice 1, "The switch" (the phone's reader; doctrine P5, P11).
 *
 * The server tells the phone, on every pull, which of its farms the schedule mechanism is switched on for
 * (`capabilities.scheduleMechanism.farmIds`). The reader answers one question - "is it on for THIS farm?" - and it
 * FAILS CLOSED: off, unknown (never pulled, an older server, a value it cannot read, a blocked store) and "another farm
 * is on" all read OFF, which is exactly today's screens. Nothing in this slice shows a new screen.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getActiveDatabaseName, setActiveDatabaseName } from '../../../infrastructure/storage/activeDatabaseName';
import {
    SCHEDULE_MECHANISM_META_ROW,
    isScheduleMechanismOn,
    parseScheduleMechanismFarmIds,
    readScheduleMechanismFarmIds,
    useScheduleMechanism,
    writeScheduleMechanismFarmIds,
} from '../scheduleMechanism';

const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const originalDatabase = getActiveDatabaseName();
beforeEach(async () => { await getDatabase().appMeta.clear(); });
afterEach(() => { cleanup(); setActiveDatabaseName(originalDatabase); vi.restoreAllMocks(); });

describe('the answer for one farm (pure)', () => {
    it('Off_unknown_and_on', () => {
        // on: the farm is listed
        expect(isScheduleMechanismOn([FARM_A], FARM_A)).toBe(true);
        expect(isScheduleMechanismOn(new Set([FARM_A, FARM_B]), FARM_B)).toBe(true);
        // off: nothing is switched on
        expect(isScheduleMechanismOn([], FARM_A)).toBe(false);
        // off: ANOTHER farm is on, this one is not listed
        expect(isScheduleMechanismOn([FARM_B], FARM_A)).toBe(false);
        // unknown: nothing has been read at all
        expect(isScheduleMechanismOn(null, FARM_A)).toBe(false);
        expect(isScheduleMechanismOn(undefined, FARM_A)).toBe(false);
        // unknown: the phone has no open farm to ask about
        expect(isScheduleMechanismOn([FARM_A], null)).toBe(false);
        expect(isScheduleMechanismOn([FARM_A], undefined)).toBe(false);
        expect(isScheduleMechanismOn([FARM_A], '')).toBe(false);
    });

    it('Farm_ids_are_compared_as_the_server_spells_them_(case-insensitive, trimmed)', () => {
        expect(isScheduleMechanismOn([FARM_A.toUpperCase()], FARM_A)).toBe(true);
        expect(isScheduleMechanismOn([FARM_A], ` ${FARM_A.toUpperCase()} `)).toBe(true);
    });
});

describe('what the server said, read from the pull', () => {
    it('A_list_of_farm_ids_is_read_and_anything_else_is_off', () => {
        expect(parseScheduleMechanismFarmIds({ scheduleMechanism: { farmIds: [FARM_A, FARM_B] } })).toEqual([FARM_A, FARM_B]);
        expect(parseScheduleMechanismFarmIds({ scheduleMechanism: { farmIds: [FARM_A, 7, null, '', '  ', { x: 1 }, FARM_A] } })).toEqual([FARM_A]);
        for (const unreadable of [undefined, null, 'on', 1, true, [], {}, { scheduleMechanism: null }, { scheduleMechanism: 'yes' },
            { scheduleMechanism: {} }, { scheduleMechanism: { farmIds: 'all' } }, { scheduleMechanism: { farmIds: FARM_A } },
            { scheduleMechanism: { enabled: true } }]) {
            expect(parseScheduleMechanismFarmIds(unreadable)).toEqual([]);
        }
    });
});

describe('the stored answer', () => {
    it('Nothing_stored_reads_off', async () => {
        expect(await readScheduleMechanismFarmIds()).toEqual([]);
        expect(isScheduleMechanismOn(await readScheduleMechanismFarmIds(), FARM_A)).toBe(false);
    });

    it('A_stored_list_is_read_back_and_replaced_whole', async () => {
        await writeScheduleMechanismFarmIds(getDatabase(), [FARM_A], '2026-11-23T06:00:00.000Z');
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_A]);
        expect(isScheduleMechanismOn(await readScheduleMechanismFarmIds(), FARM_A)).toBe(true);
        expect(isScheduleMechanismOn(await readScheduleMechanismFarmIds(), FARM_B)).toBe(false);

        await writeScheduleMechanismFarmIds(getDatabase(), [FARM_B], '2026-11-23T06:05:00.000Z');
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_B]);

        await writeScheduleMechanismFarmIds(getDatabase(), [], '2026-11-23T06:10:00.000Z');
        expect(await readScheduleMechanismFarmIds()).toEqual([]);
    });

    it('A_stored_value_it_cannot_read_reads_off_and_never_throws', async () => {
        for (const value of ['yes', 5, null, { farmIds: 'all' }, { receivedAtUtc: 'x' }, { farmIds: [1, 2] }]) {
            await getDatabase().appMeta.put({ key: SCHEDULE_MECHANISM_META_ROW, value, updatedAt: '' });
            expect(await readScheduleMechanismFarmIds()).toEqual([]);
        }
    });

    it('A_blocked_store_reads_off', async () => {
        const blocked = { appMeta: { get: () => Promise.reject(new Error('blocked')) } } as unknown as ReturnType<typeof getDatabase>;
        expect(await readScheduleMechanismFarmIds(blocked)).toEqual([]);
    });
});

describe('the hook the screens will use', () => {
    it('Off_before_anything_is_stored_on_after_the_pull_says_so_and_off_again_when_it_stops', async () => {
        const hook = renderHook(() => useScheduleMechanism(FARM_A));
        expect(hook.result.current).toBe(false); // unknown at first render: today's screens

        await act(async () => { await writeScheduleMechanismFarmIds(getDatabase(), [FARM_A], '2026-11-23T06:00:00.000Z'); });
        await waitFor(() => expect(hook.result.current).toBe(true));

        await act(async () => { await writeScheduleMechanismFarmIds(getDatabase(), [FARM_B], '2026-11-23T06:05:00.000Z'); });
        await waitFor(() => expect(hook.result.current).toBe(false));

        await act(async () => { await writeScheduleMechanismFarmIds(getDatabase(), [FARM_A, FARM_B], '2026-11-23T06:10:00.000Z'); });
        await waitFor(() => expect(hook.result.current).toBe(true));

        await act(async () => { await writeScheduleMechanismFarmIds(getDatabase(), [], '2026-11-23T06:15:00.000Z'); });
        await waitFor(() => expect(hook.result.current).toBe(false));
    });

    it('No_open_farm_is_always_off', async () => {
        await writeScheduleMechanismFarmIds(getDatabase(), [FARM_A], '2026-11-23T06:00:00.000Z');
        const none = renderHook(() => useScheduleMechanism(null));
        const other = renderHook(() => useScheduleMechanism(FARM_B));
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(none.result.current).toBe(false);
        expect(other.result.current).toBe(false);
    });
});
