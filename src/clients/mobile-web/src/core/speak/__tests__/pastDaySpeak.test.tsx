// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-60 = 4A) — "त्या दिवसाचं काम सांगा" opens the
 * app's normal crop → plot steps with the DATE shown and the question worded for that day ("21 ऑक्टो ला कोणत्या पिकावर
 * काम झालं ?"), then the mic (typing kept: it is the recorder's own). Both languages.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
const flowProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('../../../features/logs/components/entry/LogEntryFlow', () => ({
    LogEntryFlow: (p: Record<string, unknown>) => { flowProps.last = p; return <div data-testid="picker-flow">{p.micLead as React.ReactNode}</div>; },
}));
vi.mock('../../navigation/logRecorder', () => ({ renderLogRecorder: () => <div data-testid="the-recorder" />, renderProcessingScreen: () => null }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));

import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost } from '../SpeakHost';
import { requestSpeak, resetSpeakStoreForTests } from '../speakStore';
import { speakWords } from '../speakWords';
import { SathiAskBand } from '../../../features/logs/components/entry/SathiAskBand';

afterEach(() => { cleanup(); resetSpeakStoreForTests(); lang.value = 'mr'; flowProps.last = null; });

const ctx = {
    status: 'idle', draftLog: null, lastSavedLogIds: [], logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
    crops: [], history: [], farmerProfile: { operators: [], activeOperatorId: 'me' }, currentRoute: 'main', mainView: 'reflect',
    handleReset: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setLogScope: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
} as unknown as AppRouterContext;

describe.each(['mr', 'en'] as const)('a past day: the crop → plot steps say the date (%s)', language => {
    it('the ONE mic, asked for a past day with no place, opens the crop → plot steps for THAT day, the band naming it', () => {
        lang.value = language;
        render(<SpeakHost ctx={ctx} />);
        act(() => { requestSpeak({ purpose: 'addToDay', context: { date: '2026-10-21' }, returnTo: { route: 'main', mainView: 'reflect' } }); });
        expect(screen.getByTestId('picker-flow')).toBeInTheDocument();
        expect(flowProps.last?.forDay).toBe(language === 'en' ? '21 Oct' : '21 ऑक्टो');
        expect(flowProps.last?.startAt).toBe('entry');
        expect(screen.getByTestId('speak-band-title')).toHaveTextContent(language === 'en' ? "Tell that day's work" : 'त्या दिवसाचं काम सांगा');
        expect(screen.getByTestId('speak-band-hint')).toHaveTextContent(language === 'en' ? 'For 21 Oct' : '21 ऑक्टो साठी');
    });

    it("Sathi's two questions name the day, with a chip", () => {
        lang.value = language;
        const day = language === 'en' ? '21 Oct' : '21 ऑक्टो';
        const { rerender } = render(<SathiAskBand step="crop" cropNames={[]} global={false} forDay={day} />);
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent(language === 'en' ? 'Which crop was worked on 21 Oct?' : '21 ऑक्टो ला कोणत्या पिकावर काम झालं ?');
        expect(screen.getByTestId('flow-sathi-day')).toHaveTextContent(language === 'en' ? 'For 21 Oct' : '21 ऑक्टो साठी');
        rerender(<SathiAskBand step="plot" cropNames={[language === 'en' ? 'Grapes' : 'द्राक्ष']} global={false} forDay={day} />);
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent(language === 'en' ? 'Which Grapes plot was worked on 21 Oct?' : 'द्राक्ष मधील 21 ऑक्टो ला कोणत्या प्लॉट वर काम झालं ?');
    });
});

describe('today is unchanged', () => {
    it('no day: the founder\'s own questions, no chip; the band says "आणखी सांगा"', () => {
        render(<SathiAskBand step="crop" cropNames={[]} global={false} />);
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        expect(screen.queryByTestId('flow-sathi-day')).toBeNull();
        expect(speakWords('mr').band('addToDay', {}).title).toBe('आणखी सांगा');
    });
});
