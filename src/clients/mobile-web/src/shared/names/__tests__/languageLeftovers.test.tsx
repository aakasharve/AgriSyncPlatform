// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the English-in-Marathi / Marathi-in-English leftovers
 * found in testing, each rendered in both languages, plus D-38 (the petiole test's name) and D-18 (the two money
 * settings that did nothing are gone).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CropProfile } from '../../../domain/types/farm.types';
import type { DexieTestInstance } from '../../../infrastructure/storage/DexieDatabase';

const lang = { current: 'mr' as 'mr' | 'en' };
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k }),
}));

import { QuickLogFab, quickLogLabel } from '../../../core/navigation/globalSheets';
import { REC_WORDS, autoStoppingIn } from '../../../features/voice/components/recorder/recorderWords';
import { FarmStatus } from '../../../features/reflect/overview/FarmStatus';
import { PETIOLE_TEST_EN, PETIOLE_TEST_MR, kindLine, testName, whereLine } from '../../../features/tests/components/testView';
import { mapApiInstanceToDexie } from '../../../features/tests/data/testsClient';
import { financeService } from '../../../features/finance/financeService';

const DEVANAGARI = /[ऀ-ॿ]/;
afterEach(() => { cleanup(); lang.current = 'mr'; });

describe('the "+" quick-log button is named in his language (was "Quick Log" in Marathi mode)', () => {
    it.each(['mr', 'en'] as const)('%s', language => {
        lang.current = language;
        render(<QuickLogFab onOpen={() => undefined} />);
        const label = screen.getByTestId('add-log-fab').getAttribute('aria-label') ?? '';
        expect(label).toBe(quickLogLabel(language));
        if (language === 'mr') expect(label).toMatch(DEVANAGARI);
        else expect(label).not.toMatch(DEVANAGARI);
        expect(label).not.toBe('Quick Log');
    });
});

describe('the recorder countdown follows the language (was always Marathi)', () => {
    it('both languages, the same number', () => {
        expect(autoStoppingIn(30, 'mr')).toBe(REC_WORDS.autoStopping(30));
        expect(autoStoppingIn(30, 'mr')).toMatch(DEVANAGARI);
        expect(autoStoppingIn(30, 'en')).toContain('30');
        expect(autoStoppingIn(30, 'en')).not.toMatch(DEVANAGARI);
    });
});

describe('आढावा crop cards: no "Grapes / Sugarcane" in Marathi mode', () => {
    const crop = (id: string, name: string): CropProfile => ({
        id, name, iconName: 'Sprout', color: 'bg-emerald-500', plots: [{ id: `${id}-p`, name: `${name} प्लॉट` }], supportedTasks: [], workflow: [],
    } as unknown as CropProfile);
    const crops = [crop('c1', 'Grapes'), crop('c2', 'Sugarcane')];

    it('Marathi mode', () => {
        render(<FarmStatus crops={crops} sel={{ crop: 'all', plotIds: [] }} onSel={() => undefined} />);
        expect(screen.getByText('द्राक्ष')).toBeInTheDocument();
        expect(screen.getByText('ऊस')).toBeInTheDocument();
        expect(screen.queryByText('Grapes')).toBeNull();
        expect(screen.queryByText('Sugarcane')).toBeNull();
    });

    it('English mode', () => {
        lang.current = 'en';
        render(<FarmStatus crops={crops} sel={{ crop: 'all', plotIds: [] }} onSel={() => undefined} />);
        expect(screen.getByText('Grapes')).toBeInTheDocument();
        expect(screen.getByText('All crops')).toBeInTheDocument();
        expect(screen.queryByText('द्राक्ष')).toBeNull();
    });
});

describe('D-38 — the petiole test ("PTOL") in the farmer\'s words', () => {
    const petiole = mapApiInstanceToDexie({
        testInstanceId: 't1', testProtocolId: 'a1000000-0000-0000-0000-000000000002', testProtocolName: 'Petiole monthly',
        protocolKind: 'Petiole', cropCycleId: 'cc', farmId: 'f', plotId: 'p', stageName: 'Fruit set', plannedDueDate: '2026-11-01',
        status: 'Due', results: [], attachmentIds: [], createdAtUtc: '2026-10-01T00:00:00Z', modifiedAtUtc: '2026-10-01T00:00:00Z',
    } as unknown as Parameters<typeof mapApiInstanceToDexie>[0]) as DexieTestInstance;

    it('Marathi: "पानांच्या देठाची तपासणी" (never "Petiole monthly" or "इतर तपासणी")', () => {
        expect(testName(petiole)).toBe(PETIOLE_TEST_MR);
        expect(PETIOLE_TEST_MR).toBe('पानांच्या देठाची तपासणी');
        expect(kindLine(petiole, testName(petiole))).toBe('');
    });

    it('English: "Petiole" alongside', () => {
        expect(testName(petiole, undefined, 'en')).toBe(PETIOLE_TEST_EN);
        expect(PETIOLE_TEST_EN).toContain('Petiole');
    });

    it('the reminder card\'s place line says the stage in Marathi, never the server\'s English', () => {
        expect(whereLine(petiole, 'द्राक्ष G1')).toBe('द्राक्ष G1 · फळधारणा');
    });

    it('a protocol name in English that the app does not know falls to the kind in Marathi', () => {
        expect(testName({ ...petiole, testProtocolName: 'Custom lab panel', protocolKind: 0 })).toBe('मातीची तपासणी');
        expect(testName({ ...petiole, testProtocolName: 'Custom lab panel', protocolKind: 0 }, undefined, 'en')).toBe('Custom lab panel');
    });
});

describe('D-18 — the "large amount" and "duplicate window" money settings are gone', () => {
    it('nothing reads or writes them any more', () => {
        expect('getSettings' in financeService).toBe(false);
        expect('saveSettings' in financeService).toBe(false);
    });
});
