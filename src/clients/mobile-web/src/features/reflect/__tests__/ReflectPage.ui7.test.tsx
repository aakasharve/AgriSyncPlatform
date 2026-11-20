// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-7; founder D-150, D-149 item 3)
 *
 * The आढावा page after the shared crop -> plot picker and the dark money strip:
 *   - the page STARTS on every crop and every plot (with one crop and with two), as the founder asked;
 *   - the picker is the shared one: crop photo tiles in the crop's colour, plot chips with that colour as a dot;
 *   - the closed "उत्पन्न आणि खर्च" header is a dark strip with the spent-so-far amount; it is absent (the plain header) for
 *     a seat that may not see money; tapping it folds and opens the section as before; the reorder buttons stay.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: null }) }));
const prefs = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [value, setValue] = useState<T>(prefs.has(key) ? prefs.get(key) as T : fallback);
            const update = (next: T) => { prefs.set(key, next); setValue(next); };
            return [value, update, true] as const;
        },
    };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
const ledger = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: ledger.entries, gaps: [], complete: true }) }));
vi.mock('../day/useDayListen', () => ({
    useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));
const lang = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => (lang.value ? { language: lang.value } : null),
}));

import ReflectPage from '../ReflectPage';
import { CANE, CROPS, GRAPE } from './reflectFixtures';

const SPENT = { id: 'e1', plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense', category: 'Labour', amount: 1500 };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    prefs.clear();
    ledger.entries = [SPENT];
    lang.value = undefined;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPage = (crops = CROPS, over: Partial<React.ComponentProps<typeof ReflectPage>> = {}) => {
    render(<ReflectPage history={[]} crops={crops} tasks={[]} onUpdateTask={vi.fn()} onAddTask={vi.fn()} navigate={vi.fn()} onOpenLog={vi.fn()} onSpeak={vi.fn()}
        sessionUserId="me" ownName="प्रकाश" farmRole="PrimaryOwner" {...over} />);
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);

describe('आढावा page — starts on every crop and every plot', () => {
    it('two crops: "सर्व पिकं" is chosen, every plot chip is chosen, every plot has its card', () => {
        renderPage(CROPS);
        expect(screen.getByTestId('farm-crop-all')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-crop-all')).toHaveTextContent('3 पैकी 3 प्लॉट');
        for (const id of ['g1', 'g2', 'c1']) expect(screen.getByTestId(`farm-plot-${id}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-crop-grape')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getAllByTestId(/^plot-card-[^:]+:/)).toHaveLength(3);
    });

    it('one crop: that crop\'s tile is the chosen one (there is no "सर्व पिकं"), all its plots are chosen and have their cards', () => {
        renderPage([GRAPE]);
        expect(screen.queryByTestId('farm-crop-all')).toBeNull();
        expect(screen.getByTestId('farm-crop-grape')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-crop-grape')).toHaveTextContent('2 पैकी 2 प्लॉट');
        for (const id of ['g1', 'g2']) expect(screen.getByTestId(`farm-plot-${id}`)).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByTestId(/^plot-card-[^:]+:/)).toHaveLength(2);
    });

    it('one crop with one plot: still all of it chosen', () => {
        renderPage([CANE]);
        expect(screen.getByTestId('farm-crop-cane')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-plot-c1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByTestId(/^plot-card-[^:]+:/)).toHaveLength(1);
    });

    it('choosing a crop narrows the page to it; "सर्व पिकं" widens it back to everything', () => {
        renderPage(CROPS);
        fireEvent.click(screen.getByTestId('farm-crop-cane'));
        expect(screen.queryByTestId('farm-plot-g1')).toBeNull();
        expect(screen.getAllByTestId(/^plot-card-[^:]+:/)).toHaveLength(1);
        fireEvent.click(screen.getByTestId('farm-crop-all'));
        expect(screen.getAllByTestId(/^farm-plot-/)).toHaveLength(3);
        expect(screen.getAllByTestId(/^plot-card-[^:]+:/)).toHaveLength(3);
        expect(screen.getByTestId('farm-crop-all')).toHaveAttribute('aria-pressed', 'true');
    });

    it('the picker is the shared one: tiles and chips wear the crop\'s own colour', () => {
        renderPage(CROPS);
        expect(part(screen.getByTestId('farm-crop-grape'), 'accent')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('farm-crop-cane'), 'accent')?.className).toContain('bg-emerald-500');
        expect(part(screen.getByTestId('farm-plot-g1'), 'dot')?.className).toContain('bg-purple-500');
        expect(part(screen.getByTestId('farm-plot-c1'), 'dot')?.className).toContain('bg-emerald-500');
    });

    it('English: the same picker says "All crops" and counts in English', () => {
        lang.value = 'en';
        renderPage(CROPS);
        expect(screen.getByTestId('farm-crop-all')).toHaveTextContent('All crops');
        expect(screen.getByTestId('farm-crop-all')).toHaveTextContent('3 of 3 plots');
    });
});

describe('आढावा page — the money strip', () => {
    it('the closed money section shows a white strip with the spent-so-far amount from the ledger (founder pick M2)', () => {
        renderPage(CROPS);
        const toggle = screen.getByTestId('reflect-section-cost-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false'); // first use: folded (D-4)
        const strip = screen.getByTestId('cost-strip');
        expect(toggle).toContainElement(strip);
        expect(within(strip).getByTestId('cost-strip-amount')).toHaveTextContent('₹ 1,500');
        expect(strip).toHaveTextContent('उत्पन्न आणि खर्च');
        // white strip (no black), dark amount, amber rupee circle
        expect(toggle.className).not.toContain('bg-stone-900');
        expect(within(strip).getByTestId('cost-strip-amount').className).toContain('text-stone-900');
        expect(part(strip, 'rupee')?.className).toContain('bg-amber-500');
    });

    it('it is the same figure the section\'s first card holds, narrowed with the page', () => {
        renderPage(CROPS);
        fireEvent.click(screen.getByTestId('reflect-section-cost-toggle'));
        expect(screen.getByTestId('season-cost')).toHaveTextContent('₹ 1,500');
        expect(screen.getByTestId('cost-strip-amount')).toHaveTextContent('₹ 1,500');
        // narrowed to the cane crop: that plot spent nothing, so no amount (a dash), never ₹ 0
        fireEvent.click(screen.getByTestId('farm-crop-cane'));
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(screen.getByTestId('cost-strip-amount')).toHaveTextContent('—');
    });

    it('tapping the strip opens and folds the section as before, and the strip stays', () => {
        renderPage(CROPS);
        const toggle = screen.getByTestId('reflect-section-cost-toggle');
        expect(screen.queryByTestId('cost-section')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('cost-section')).toBeInTheDocument();
        expect(screen.getByTestId('cost-strip')).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('cost-section')).toBeNull();
    });

    it('the remembered fold is written under the same key as before (the strip changes the look, not the memory)', () => {
        renderPage(CROPS);
        fireEvent.click(screen.getByTestId('reflect-section-cost-toggle'));
        const remembered = JSON.stringify([...prefs.entries()]);
        expect(remembered).toContain('cost');
    });

    it('the reorder buttons stay on the money section', () => {
        renderPage(CROPS);
        fireEvent.click(screen.getByTestId('reflect-reorder-toggle'));
        expect(screen.getByTestId('reflect-section-cost-up')).toBeInTheDocument();
        expect(screen.getByTestId('reflect-section-cost-down')).toBeInTheDocument();
        expect(screen.getByTestId('cost-strip')).toBeInTheDocument();
    });

    it('nothing recorded: a dash, never ₹ 0', () => {
        ledger.entries = [];
        renderPage(CROPS);
        expect(screen.getByTestId('cost-strip-amount')).toHaveTextContent('—');
        expect(screen.getByTestId('cost-strip').textContent).not.toContain('₹ 0');
    });

    it('a seat that may not see money gets no strip: the plain header, exactly as today', () => {
        renderPage(CROPS, { farmRole: 'Worker' });
        expect(screen.queryByTestId('cost-strip')).toBeNull();
        expect(screen.queryByTestId('cost-strip-amount')).toBeNull();
        const toggle = screen.getByTestId('reflect-section-cost-toggle');
        expect(toggle.className).not.toContain('bg-stone-900');
        expect(toggle).toHaveTextContent('उत्पन्न आणि खर्च');
        expect(toggle).not.toHaveTextContent('1,500');
    });

    it('maySeeMoney=false overrides the role: no strip', () => {
        renderPage(CROPS, { maySeeMoney: false });
        expect(screen.queryByTestId('cost-strip')).toBeNull();
    });

    it('English: the strip speaks English only', () => {
        lang.value = 'en';
        renderPage(CROPS);
        const strip = screen.getByTestId('cost-strip');
        expect(strip.textContent).not.toMatch(/[ऀ-ॿ]/);
        expect(within(strip).getByTestId('cost-strip-amount')).toHaveTextContent('₹ 1,500');
    });
});
