// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6) — the calm step list on screen: it ticks live, only on the signal's events;
 * events of an earlier recording never tick it; the bar moves in whole steps and no percentage is written; the finished
 * list (every tick + the chips) is held on screen for 1.2 s before the result screen replaces it.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const haptic = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('../../../../../shared/utils/haptics', async orig => ({
    ...(await orig<typeof import('../../../../../shared/utils/haptics')>()),
    hapticFeedback: { success: haptic.success, light: vi.fn(), medium: vi.fn(), heavy: vi.fn(), selection: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: 'mr' }), useLanguage: () => ({ language: 'mr' }) }));

import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../../../types';
import { noteVoiceJourney, resetVoiceJourneyForTests } from '../../../../../infrastructure/voice/voiceJourneySignal';
import { VoiceJourney } from '../VoiceJourney';
import { HOLD_MS, releaseHoldForTests } from '../holdOnScreen';

const crops = [{
    id: 'crop-g', name: 'Grapes', iconName: 'grapes', color: 'purple', supportedTasks: [], workflow: [],
    plots: [{ id: 'plot-a', name: 'सोनाका', baseline: { unit: 'Acre' } }],
}] as unknown as CropProfile[];
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const scope: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-g'], mode: 'single', applyPolicy: 'broadcast' };
const DRAFT = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], machinery: [], activityExpenses: [], missingSegments: [],
    fullTranscript: 'कॉन्फिडॉर अडीचशे एमएल फवारलं, दहा मजूर होते',
    inputs: [{ id: 'ev', method: 'Spray', sourceText: 'कॉन्फिडॉर अडीचशे एमएल', mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }] }],
    labour: [{ id: 'lab', type: 'HIRED', count: 10, sourceText: 'दहा मजूर होते' }],
} as unknown as AgriLogResponse;

const view = () => render(<VoiceJourney crops={crops} farmerProfile={profile} logScope={scope} />);
const state = (key: string) => screen.getByTestId(`vj-step-${key}`).getAttribute('data-state');
const barWidth = () => parseFloat(screen.getByTestId('vj-bar').style.width);
const drawnCount = () => document.querySelectorAll('[data-testid^="vj-step-"]:not([data-state="skipped"])').length;
const wholeStep = () => {
    const n = drawnCount();
    const k = (barWidth() / 100) * n;
    return Math.abs(k - Math.round(k)) < 1e-9;
};
const finish = () => act(() => {
    noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 12_000 });
    noteVoiceJourney({ kind: 'understood', draft: DRAFT });
    noteVoiceJourney({ kind: 'placeChecked', result: 'same' });
    noteVoiceJourney({ kind: 'written', logIds: ['LOG-1'] });
});

beforeEach(() => { resetVoiceJourneyForTests(); releaseHoldForTests(); haptic.success.mockClear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); });
afterEach(() => { cleanup(); releaseHoldForTests(); resetVoiceJourneyForTests(); vi.useRealTimers(); });

describe('VoiceJourney — ticks live, only on real events', () => {
    it('each event ticks its steps; the bar moves in whole steps; no percentage is written', () => {
        const { container } = view();
        expect(screen.getByTestId('voice-journey')).toBeInTheDocument();
        expect(state('kept')).toBe('active');
        expect(barWidth()).toBe(0);

        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 12_000 }));
        expect(state('kept')).toBe('done');
        expect(state('words')).toBe('active');
        expect(screen.getByTestId('vj-step-kept')).toHaveTextContent('१२ सेकंदांचा आवाज · फोनवर सुरक्षित');
        expect(wholeStep()).toBe(true);

        act(() => noteVoiceJourney({ kind: 'understood', draft: DRAFT }));
        expect([state('words'), state('parts'), state('products')]).toEqual(['done', 'done', 'done']);
        expect(state('place')).toBe('active');
        expect(screen.getByTestId('vj-step-products')).toHaveTextContent('कॉन्फिडॉर');
        expect(screen.getByTestId('vj-step-words')).toHaveTextContent('“कॉन्फिडॉर'); // his words in quotes, as the design
        expect(wholeStep()).toBe(true);
        expect(haptic.success).not.toHaveBeenCalled();

        act(() => noteVoiceJourney({ kind: 'placeChecked', result: 'same' }));
        expect(screen.getByTestId('vj-step-place')).toHaveTextContent('तुम्ही निवडलेला: सोनाका ✓');
        act(() => noteVoiceJourney({ kind: 'written', logIds: ['LOG-1'] }));
        expect(state('saved')).toBe('done');
        expect(barWidth()).toBe(100);
        expect(haptic.success).toHaveBeenCalledTimes(1); // the save REALLY completed
        expect(container.textContent).not.toContain('%');
    });

    it('a journey from an earlier recording never ticks the new screen, nor do its late events', () => {
        act(() => {
            noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 9000 });
            noteVoiceJourney({ kind: 'understood', draft: DRAFT });
        });
        vi.advanceTimersByTime(5000); // he looked at the result, then spoke again
        view();
        expect(state('kept')).toBe('active');
        act(() => {
            noteVoiceJourney({ kind: 'placeChecked', result: 'same' });
            noteVoiceJourney({ kind: 'written', logIds: ['OLD'] });
        });
        expect(state('kept')).toBe('active');
        expect(state('saved')).toBe('waiting');
        expect(haptic.success).not.toHaveBeenCalled();

        act(() => noteVoiceJourney({ kind: 'kept', input: 'text' }));
        expect(state('kept')).toBe('done');
        expect(screen.getByTestId('vj-step-kept')).toHaveTextContent('तुम्ही लिहिलेलं मिळालं');
    });
});

describe('VoiceJourney — the heading says it is saved', () => {
    it('reads the journey title until the save completes, then "जतन झालं ✓" (seen even when the list is taller than the screen)', () => {
        view();
        expect(screen.getByTestId('vj-title')).toHaveTextContent('साथी तुमचं काम लावून ठेवतोय');
        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 5_000 }));
        expect(screen.getByTestId('vj-title')).not.toHaveTextContent('जतन झालं');
        finish();
        expect(screen.getByTestId('vj-title')).toHaveTextContent('जतन झालं ✓');
    });
});

describe('VoiceJourney — full screen, Sathi\'s mood and his field', () => {
    it('in the v2 frame; Sathi ponders while it works and is happy once saved', () => {
        render(<VoiceJourney crops={crops} farmerProfile={profile} logScope={scope} placeLabel={() => 'द्राक्ष · सोनाका'} days={4} />);
        expect(screen.getByTestId('vj-shell')).toBeInTheDocument();
        expect(screen.getByTestId('v2-place')).toHaveTextContent('द्राक्ष · सोनाका');
        expect(screen.getByTestId('vj-waiting')).toBeInTheDocument();
        expect(screen.getByTestId('vj-sathi')).toHaveAttribute('data-mood', 'ponder');
        finish();
        expect(screen.getByTestId('vj-sathi')).toHaveAttribute('data-mood', 'happy');
    });

    it('the field card shows only after the real "understood", filled from the parse alone (P4)', () => {
        render(<VoiceJourney crops={crops} farmerProfile={profile} logScope={scope} plotLabel={() => 'सोनाका'} />);
        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 12_000 }));
        expect(screen.queryByTestId('field-card')).toBeNull();
        act(() => noteVoiceJourney({ kind: 'understood', draft: DRAFT }));
        expect(screen.getByTestId('field-card')).toHaveAttribute('data-filled', 'yes');
        expect(screen.getByTestId('field-title')).toHaveTextContent('तुमचं शेत · सोनाका');
        expect(screen.getAllByTestId('field-worker')).toHaveLength(10); // the ten he named
        expect(screen.getByTestId('field-sprayer')).toBeInTheDocument();
        expect(screen.getByTestId('field-spray')).toBeInTheDocument();
        expect(screen.queryByTestId('field-tractor')).toBeNull();
        expect(screen.queryByTestId('field-drip')).toBeNull();
    });
});

describe('VoiceJourney — the finished list is held for 1.2 s', () => {
    it('saved, then the result screen replaces it: a still copy stays 1.2 s with every tick and chip, then goes', () => {
        const { unmount } = view();
        finish();
        unmount();
        const hold = screen.getByTestId('voice-journey-hold');
        expect(hold).toHaveAttribute('aria-hidden', 'true');
        expect(hold).toHaveTextContent('जतन झालं');
        expect(hold).toHaveTextContent('कॉन्फिडॉर');
        expect(hold.querySelectorAll('[data-state="done"]').length).toBe(6);
        act(() => { vi.advanceTimersByTime(HOLD_MS - 1); });
        expect(screen.getByTestId('voice-journey-hold')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.queryByTestId('voice-journey-hold')).toBeNull();
    });

    it('left before it was saved (another plot, unclear, the हजेरी door): nothing is held', () => {
        const { unmount } = view();
        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 3000 }));
        unmount();
        expect(screen.queryByTestId('voice-journey-hold')).toBeNull();
    });

    it('a list that stayed finished on screen longer than the hold is not held again', () => {
        const { unmount } = view();
        finish();
        act(() => { vi.advanceTimersByTime(HOLD_MS + 1); });
        unmount();
        expect(screen.queryByTestId('voice-journey-hold')).toBeNull();
    });
});
