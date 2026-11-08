// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4; founder 2026-10-26 language-strict, 2026-11-06 real names) - the new
 * parts of the result screen speak ONE language: English mode shows no Devanagari, Marathi mode shows no English letters; the
 * product facts are labelled with the library's name (never the dosage guide's); no emoji, no "AI", no "तुम्ही" for who said it.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { lng } = vi.hoisted(() => ({ lng: { v: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: vi.fn(async () => undefined) } }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});
vi.mock('../../../../../core/session/FarmContext', () => ({ useOptionalFarmContext: () => null }));

import referenceRules from '../../../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import type { MixRule } from '../../../../../domain/inputs/mixRules';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const NOW = 'c3c3c3c3-0000-4000-8000-000000000003';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const REVIEWED: MixRule[] = (referenceRules as { rules: MixRule[] }).rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));
const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u;

const record: DailyLog = {
    id: NOW, date: '2026-10-26', dayOutcome: 'WORK_RECORDED', fullTranscript: 'Confidor and Prem Gold sprayed, calcium nitrate and 19:19:19 by drip',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Plot 1'] }] },
    cropActivities: [], irrigation: [], labour: [], machinery: [],
    inputs: [
        { id: 'ev-spray', method: 'Spray', mix: [{ id: 'm-conf', productName: 'Confidor', dose: 1, unit: 'ml' }, { id: 'm-prem', productName: 'Prem Gold' }] },
        { id: 'ev-drip', method: 'Drip', mix: [{ id: 'd-can', productName: 'Calcium Nitrate', dose: 2, unit: 'kg' }, { id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' }] },
    ],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: FARM },
} as unknown as DailyLog;

const props = (over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => ({
    result: { logIds: [NOW], clipId: null, key: 'k|T', unclear: [] },
    history: [record],
    farmerProfile: { name: 'Sunil', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
    operatorNameById: new Map(),
    farmId: FARM, farmRole: 'PrimaryOwner', placeLabel: 'Grapes · Plot 1',
    syncQueuedById: new Map([[NOW, true]]),
    onEdit: vi.fn(), onBack: vi.fn(), onAddAnother: vi.fn(), mixRules: REVIEWED, ...over,
});

beforeEach(async () => {
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); clearAuthSession(); lng.v = 'mr'; });

describe('the new parts of the result screen speak one language (lane IT4)', () => {
    it('English mode: the banner, the lines, the rows, the card and the mix box show English only, with the holder named', () => {
        lng.v = 'en';
        render(<VoiceResultContainer {...props()} />);
        fireEvent.click(screen.getByTestId('vr-mix-banner'));
        fireEvent.click(screen.getByTestId('vr-line-row-inputs:ev-spray'));
        const scope = [screen.getByTestId('vr-mix-banner'), screen.getByTestId('vr-lines'), screen.getByTestId('vr-latest-who')];
        // The recording's clock label ("दुपारी 3:30", `formatFarmerLogTime`) is the app's one fixed Marathi time word, in English mode
        // too - older than this lane and shared with आढावा - so it is left out of this letters check.
        const withoutClock = (s: string | null) => (s ?? '').replace(/[ऀ-ॿ]+\s*\d{1,2}:\d{2}/g, '');
        for (const el of scope) {
            expect(withoutClock(el.textContent), el.getAttribute('data-testid') ?? '').not.toMatch(DEVANAGARI);
            expect(el.textContent).not.toMatch(EMOJI);
        }
        expect(screen.getByTestId('vr-latest-who').textContent).toBe('Sunil');
        expect(screen.getByTestId('vr-mix-banner').textContent).toContain('One mix is wrong');
        expect(within(screen.getByTestId('vr-line-body-inputs:ev-drip')).getByTestId('vr-mix-title').textContent).toBe('This mix is wrong');

        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        const card = screen.getByTestId('vr-product-card');
        expect(card.textContent).not.toMatch(DEVANAGARI);
        expect(card.textContent).not.toMatch(EMOJI);
        expect(screen.getByTestId('vr-card-source').textContent).toBe('Source: ShramSafal Library');
        expect(within(card).getByTestId('vr-card-type').textContent).toBe('Insecticide');
        expect(screen.getByTestId('vr-card-question').textContent).toBe('Was this the product used?');
        expect(card.textContent).not.toMatch(/\bAI\b|dosage guide|guide/i);
    });

    it('Marathi mode: the same parts hold no English letters, no emoji, no "AI", no "तुम्ही" for who said it', () => {
        lng.v = 'mr';
        render(<VoiceResultContainer {...props({ farmerProfile: { name: 'सुनील', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile })} />);
        fireEvent.click(screen.getByTestId('vr-mix-banner'));
        fireEvent.click(screen.getByTestId('vr-line-row-inputs:ev-spray'));
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        for (const el of [screen.getByTestId('vr-mix-banner'), screen.getByTestId('vr-product-card'), ...screen.getAllByTestId('vr-mixbox')]) {
            // The product names he said are his own words ("Confidor" is written as he said it): only the library's and the screen's words are checked.
            // The cited source's title is a publication's own name (in English), shown as published; it is left out of the letters check.
            const source = el.querySelector('[data-testid="vr-mix-source"]')?.textContent ?? '';
            const text = (el.textContent ?? '').replace(source, '').replace(/Confidor|Prem Gold|Calcium Nitrate|19:19:19/g, '');
            expect(text, el.getAttribute('data-testid') ?? '').not.toMatch(LATIN);
            expect(text).not.toMatch(EMOJI);
        }
        expect(screen.getByTestId('vr-speakers').textContent).toContain('सुनील');
        expect(screen.getByTestId('voice-result').textContent).not.toMatch(/AI|मार्गदर्शिका/);
        expect(screen.getByTestId('vr-latest-who').textContent).not.toBe('तुम्ही');
    });
});
