// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.3; founder 27 Nov: the saved screen shows a short read-only
 * "हे दिसतं: मालक, मुकादम" and, "if something that is important, keep one redirect button ... change your setting") - the line is built from the
 * pull's name-free `seenBy` (asked with `seenBy=1`) only: no summary stored, no line (P4: never guessed). The farm's registrant is implied first
 * ("तुम्ही" when he is reading); a chosen-plots seat is listed only when the record is on one of his plots. A record that states money adds who
 * sees its money ("फक्त मालक" while the farm's money is private). Only the registrant gets "सेटिंग बदला", which opens माझी टीम.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));

import { SeenByLine } from '../SeenByLine';
import { HUB_FOCUS_KEY, HUB_OPEN_TAB_KEY, OPEN_TEAM_SETTING_EVENT } from '../teamSettingLink';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import { pullSyncChanges } from '../../../infrastructure/api/resources/SyncResource';
import type { FarmAccessScopeDto, SeenByDto } from '../../../infrastructure/api/accessScopeDtos';
import type { DailyLog } from '../../../types';

const FARM = '3d030000-0000-4000-8000-0000000000c3';
const OWNER = 'a1a1a1a1-0000-4000-8000-0000000000c1';
const WORKER = 'b2b2b2b2-0000-4000-8000-0000000000c2';
const log = (plots: string[], over: Partial<DailyLog> = {}): DailyLog => ({
    id: 'l1', date: '2026-11-27', context: { selection: [{ cropId: plots.length ? 'c1' : 'FARM_GLOBAL', cropName: 'द्राक्ष', selectedPlotIds: plots, selectedPlotNames: [] }] },
    cropActivities: [{ id: 'c' }], irrigation: [], labour: [], inputs: [], machinery: [], ...over,
}) as unknown as DailyLog;
const store = async (seenBy: SeenByDto | undefined, over: Partial<FarmAccessScopeDto> = {}) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: { receivedAtUtc: 'x', scopes: [{ farmId: FARM, ownRecordsOnly: false, seeMoney: true, seeWages: false, seeAttendance: true, seeTests: false, seeCompliance: false, seeFarmOverview: true, ...(seenBy && { seenBy }), ...over }] },
        updatedAt: 'x',
    });
};
const SEEN: SeenByDto = {
    work: [{ who: 'Mukadam' }, { who: 'Worker', plotIds: ['p-9'] }],
    attendance: [{ who: 'Mukadam' }],
    money: [{ who: 'CoOwner' }],
};

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().appMeta.clear();
    await getDatabase().farms.put({ id: FARM, payload: { id: FARM, ownerUserId: OWNER }, updatedAt: 'T' });
    window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe('PERM S5.3 - "हे दिसतं" on the saved screen', () => {
    it('the phone asks for seenBy on every pull (seenBy=1, beside farmSetup)', async () => {
        const get = vi.fn(async () => ({ data: {} }));
        await pullSyncChanges({ http: { get } } as never, undefined, []);
        expect(get).toHaveBeenCalledWith('/sync/pull', { params: { farms: '', scheduleFormat: 2, farmSetup: 1, seenBy: 1 } });
    });

    it('a worker\'s saved screen reads हे दिसतं: मालक, मुकादम and has no button', async () => {
        await store(SEEN);
        render(<SeenByLine farmId={FARM} logs={[log(['p-1'])]} selfUserId={WORKER} />);
        await waitFor(() => expect(screen.getByTestId('seen-by-line')).toHaveTextContent('हे दिसतं: मालक, मुकादम'));
        expect(screen.getByTestId('seen-by-line').textContent).not.toContain('कामगार'); // a chosen-plots worker on another plot
        await act(async () => { await new Promise(r => setTimeout(r, 30)); });
        expect(screen.queryByTestId('seen-by-change')).toBeNull();
    });

    it('with no seenBy stored the line is not drawn', async () => {
        await store(undefined);
        const { container } = render(<SeenByLine farmId={FARM} logs={[log(['p-1'])]} selfUserId={OWNER} />);
        await act(async () => { await new Promise(r => setTimeout(r, 40)); });
        expect(container).toBeEmptyDOMElement();
    });

    it('a record that states money says who sees its money; "फक्त" the holder while the farm\'s money is private', async () => {
        await store(SEEN);
        const withMoney = log(['p-9'], { labour: [{ id: 'lab', count: 4, totalCost: 1600 }] } as unknown as Partial<DailyLog>);
        const { unmount } = render(<SeenByLine farmId={FARM} logs={[withMoney]} selfUserId={WORKER} />);
        await waitFor(() => expect(screen.getByTestId('seen-by-line')).toHaveTextContent('हे दिसतं: मालक, मुकादम, कामगार · पैसे: मालक, सहमालक'));
        unmount();
        await store({ ...SEEN, money: [] }, { moneyPrivate: true });
        render(<SeenByLine farmId={FARM} logs={[withMoney]} selfUserId={WORKER} />);
        await waitFor(() => expect(screen.getByTestId('seen-by-line')).toHaveTextContent('हे दिसतं: मालक, मुकादम, कामगार · पैसे: फक्त मालक'));
    });

    it('the owner\'s सेटिंग बदला opens माझी टीम', async () => {
        await store(SEEN, { moneyPrivate: true });
        const opened = vi.fn();
        window.addEventListener(OPEN_TEAM_SETTING_EVENT, opened);
        render(<SeenByLine farmId={FARM} logs={[log([], { labour: [{ id: 'lab', count: 2, totalCost: 800 }] } as unknown as Partial<DailyLog>)]} selfUserId={OWNER} />);
        await waitFor(() => expect(screen.getByTestId('seen-by-line')).toHaveTextContent('हे दिसतं: तुम्ही, मुकादम, कामगार · पैसे: फक्त तुम्ही'));
        fireEvent.click(await screen.findByTestId('seen-by-change'));
        expect(screen.getByTestId('seen-by-change')).toHaveTextContent('सेटिंग बदला');
        expect(opened).toHaveBeenCalledTimes(1);
        expect(window.sessionStorage.getItem(HUB_OPEN_TAB_KEY)).toBe('team');
        expect(window.sessionStorage.getItem(HUB_FOCUS_KEY)).toBe('money');
        window.removeEventListener(OPEN_TEAM_SETTING_EVENT, opened);
    });
});
