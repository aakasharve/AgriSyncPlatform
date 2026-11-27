// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.2; CTO ruling Q3 A) - a recording that holds ONLY kinds of work
 * this person may not record on the farm writes no empty record: the voice auto-save hands it back (`bindDraftDecline`, reason `kindsClosed`,
 * with the kinds), nothing is saved, the clip is not linked to any record (it stays in आवाज नोंदी), and "तपासा आणि जतन करा" says why with no save
 * button. A recording that holds an allowed kind too is saved as today (the save path takes the closed part out).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useVoiceAutoSave, type UseVoiceAutoSaveProps } from '../useVoiceAutoSave';
import type { AgriLogResponse, DailyLog } from '../../../types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { ACCESS_SCOPES_META_KEY } from '../../../infrastructure/storage/accessScopeStore';
import { draftDecline } from '../../../features/voice/draftFacts';
import { checkCaseOf } from '../../../features/logs/components/checkSave/checkSaveModel';
import CheckSaveScreen from '../../../features/logs/components/checkSave/CheckSaveScreen';

vi.mock('../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }), useLanguage: () => ({ language: 'mr' }) }));

const FARM = '66666666-6666-4666-8666-666666666666';
const parse = (over: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [{ id: 'a1', title: 'खुरपणी' }], irrigation: [], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [], questionsForUser: [], labour: [], fullTranscript: 'आज खुरपणी केली', ...over,
} as unknown as AgriLogResponse);
const rec = { recordedAtUtc: '2026-11-27T05:00:00.000Z', clipId: 'clip-k' };

const limitTo = async (kinds: string[]) => {
    await getDatabase().appMeta.put({
        key: ACCESS_SCOPES_META_KEY,
        value: { receivedAtUtc: 'x', scopes: [{ farmId: FARM, ownRecordsOnly: true, seeMoney: false, seeWages: false, seeAttendance: false, seeTests: false, seeCompliance: false, seeFarmOverview: false, workKinds: kinds }] },
        updatedAt: 'x',
    });
};

type SaveFn = UseVoiceAutoSaveProps['handleAutoSave'];
const setup = (handleAutoSave: SaveFn) => {
    const linkClip = vi.fn(async () => 'clip-k');
    const hook = renderHook((p: UseVoiceAutoSaveProps) => useVoiceAutoSave(p), {
        initialProps: { handleAutoSave, logIntent: null, setStatus: vi.fn(), linkClip, archiveIdOf: async () => undefined, emitClosure: vi.fn(), farmId: FARM } as UseVoiceAutoSaveProps,
    });
    return { ...hook, linkClip };
};

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('PERM S4.2 - a recording of only closed kinds', () => {
    it('saves no empty record and keeps the clip: handed back with the kinds, nothing saved, no clip linked', async () => {
        await limitTo(['irrigation']);
        const save = vi.fn<SaveFn>(async () => [{ id: 'never' } as unknown as DailyLog]);
        const { result, linkClip } = setup(save);
        const draft = parse();
        let took = true;
        await act(async () => { took = await result.current.sink(draft, undefined, rec); });
        expect(took).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(linkClip).not.toHaveBeenCalled();
        expect(result.current.voiceResult).toBeNull();
        expect(draftDecline(draft)).toEqual({ reason: 'kindsClosed', recording: rec, kinds: ['cropActivities'] });
        expect(checkCaseOf(draft, draftDecline(draft)?.reason)).toBe('kindsClosed');
    });

    it('a recording that holds an allowed kind too is saved as today', async () => {
        await limitTo(['irrigation']);
        const save = vi.fn<SaveFn>(async () => [{ id: 'saved' } as unknown as DailyLog]);
        const { result } = setup(save);
        let took = false;
        await act(async () => { took = await result.current.sink(parse({ irrigation: [{ id: 'i1', durationHours: 2 }] } as unknown as Partial<AgriLogResponse>), undefined, rec); });
        expect(took).toBe(true);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('"तपासा आणि जतन करा" says which kinds, offers no save, and keeps his words', () => {
        render(React.createElement(CheckSaveScreen, {
            kind: 'kindsClosed', closedKinds: ['cropActivities', 'labour'], transcript: 'आज खुरपणी केली', typed: false,
            understood: { entries: [], blockers: [] }, placeLabel: 'संपूर्ण शेत', dayLabel: 'आज', saving: false, saveFailed: false, kept: true,
            onSayAgain: vi.fn(), onType: vi.fn(), onPickPlace: vi.fn(), onPickDay: vi.fn(), onSave: vi.fn(),
        }));
        expect(screen.getByTestId('check-title').textContent).toBe('हे जतन झालं नाही');
        expect(screen.getByTestId('check-kinds-closed').textContent).toBe('पीक काम, मजूर नोंदवण्याची परवानगी नाही — मालकाला सांगा');
        expect(screen.getByTestId('check-said').textContent).toContain('आज खुरपणी केली');
        expect(screen.queryByTestId('check-save-button')).toBeNull();
        expect(screen.getByTestId('check-say-again')).toBeTruthy();
        expect(screen.getByTestId('check-kept').textContent).toBe('जे बोललात ते फोनमध्ये ठेवलं आहे — काही हरवत नाही.');
    });
});
