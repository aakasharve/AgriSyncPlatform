/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane AI-2 (register F71) — the ONE mic decides which entry the words spoken now change: only a "बदला" request
 * (`correctEntry` with its entry) gives the parse a correction context; every other purpose gives none, so its words
 * are parsed exactly as before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { requestSpeak, resetSpeakStoreForTests, SPEAK_PURPOSES } from '../speakStore';
import { correctionEntryNow } from '../speakFlow';
import { correctionParseContext, setCorrectionParseContext } from '../../../infrastructure/ai/correctionParseContext';
import type { DailyLog } from '../../../types';

const LOG = {
    id: 'log-1',
    date: '2026-10-31',
    context: { selection: [] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [{ id: 'i1', method: 'Drip', durationHours: 2 }],
    labour: [],
    inputs: [],
    machinery: [],
} as unknown as DailyLog;
const RETURN = { route: 'main', mainView: 'log' } as const;

afterEach(() => { resetSpeakStoreForTests(); setCorrectionParseContext(() => null); });

describe('correctionEntryNow', () => {
    it('a "बदला" request gives the entry it changes', () => {
        requestSpeak({ purpose: 'correctEntry', context: { logId: 'log-1' }, returnTo: RETURN });

        expect(correctionEntryNow([LOG])).toEqual({ irrigation: [{ method: 'Drip', durationHours: 2 }] });
    });

    it.each(SPEAK_PURPOSES.filter(p => p !== 'correctEntry'))('a "%s" request gives none', purpose => {
        requestSpeak({ purpose, context: { logId: 'log-1' }, returnTo: RETURN });

        expect(correctionEntryNow([LOG])).toBeNull();
    });

    it('no request, or an entry no longer on this phone, gives none', () => {
        expect(correctionEntryNow([LOG])).toBeNull();
        requestSpeak({ purpose: 'correctEntry', context: { logId: 'gone' }, returnTo: RETURN });
        expect(correctionEntryNow([LOG])).toBeNull();
    });

    it('wired as the parse seam (as compositionRoot does), the parse sees it only during the correction', () => {
        setCorrectionParseContext(() => correctionEntryNow([LOG]));

        expect(correctionParseContext()).toBeNull();
        requestSpeak({ purpose: 'correctEntry', context: { logId: 'log-1' }, returnTo: RETURN });
        expect(correctionParseContext()).toEqual({ irrigation: [{ method: 'Drip', durationHours: 2 }] });
    });
});
