// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 7; founder D-H 2026-11-21 "Sorry My bad Dfes Must ask them")
 * - the why-not answer card, and the host writing his reason in ONE insert and opening that day.
 */
import React from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { MissedCard } from '../../services/dfesWhyNot';

const useDfesQuestionMock = vi.fn();
const recordOutcome = vi.fn();

vi.mock('../../hooks/useDfesQuestion', () => ({ useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args) }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));
vi.mock('../../services/dfesQuestionApi', () => ({
    recordQuestionEvent: vi.fn().mockResolvedValue({ id: 'qe-1' }),
    fetchRecentQuestionEvents: vi.fn().mockResolvedValue([]),
}));

const card: MissedCard = {
    cardRef: 'plot-1:tpl:2026-11-01:ot_spray', plotId: 'plot-1', category: 'FOLIAR_SPRAY',
    dayNumber: 10, dateKey: '2026-11-11', workMr: 'फवारणी', dateMr: '११ नोव्हेंबर',
};
const PROMPT = 'तुमच्या वेळापत्रकात ११ नोव्हेंबर ला फवारणी होतं. ते राहिलं, असं दिसतं. काय झालं?';
const FOUNDER_LABELS = [
    'पाऊस आला', 'औषध मिळालं नाही', 'मजूर मिळाले नाहीत', 'पैसे कमी पडले', 'वेळ गेली-विसरलो',
    'दुकानदार किंवा तज्ज्ञाने वेगळं सांगितलं', 'केलं, पण नोंद केली नाही', 'दुसरं काही',
];

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('lane DFES-Q - WhyNotAnswer', () => {
    async function renderCard(over: Partial<React.ComponentProps<typeof import('../WhyNotAnswer').WhyNotAnswer>> = {}) {
        const { WhyNotAnswer } = await import('../WhyNotAnswer');
        const handlers = { onReason: vi.fn(), onDidItNotLogged: vi.fn(), onSpeak: vi.fn(), onLater: vi.fn() };
        render(<WhyNotAnswer card={card} prompt={PROMPT} {...handlers} {...over} />);
        return handlers;
    }

    it('shows the founder\'s eight reasons in his words and order, the mic first, the अडचण box and नंतर; Marathi only', async () => {
        await renderCard();

        expect(screen.getAllByTestId('why-not-reason').map(b => b.textContent)).toEqual(FOUNDER_LABELS);
        expect(screen.getByTestId('why-not-speak')).toBeInTheDocument();
        expect(screen.getByLabelText('अडचण')).toBeInTheDocument();
        expect(screen.getByTestId('why-not-answer').textContent).not.toMatch(/[A-Za-z]/);
    });

    it('a tapped reason is sent with what he typed in अडचण, trimmed', async () => {
        const h = await renderCard();
        fireEvent.change(screen.getByTestId('why-not-challenge'), { target: { value: '  दुकानात औषध संपलं होतं  ' } });
        fireEvent.click(screen.getByText('औषध मिळालं नाही'));

        expect(h.onReason).toHaveBeenCalledWith('input_unavailable', 'दुकानात औषध संपलं होतं');
    });

    it('with nothing typed, the challenge is null, never an empty string', async () => {
        const h = await renderCard();
        fireEvent.click(screen.getByText('पाऊस आला'));

        expect(h.onReason).toHaveBeenCalledWith('rain', null);
    });

    it('"केलं, पण नोंद केली नाही" asks to open that day, and is not sent as a plain reason', async () => {
        const h = await renderCard();
        fireEvent.click(screen.getByText('केलं, पण नोंद केली नाही'));

        expect(h.onDidItNotLogged).toHaveBeenCalledWith('2026-11-11', null);
        expect(h.onReason).not.toHaveBeenCalled();
    });

    it('no route to the microphone draws no mic button', async () => {
        await renderCard({ onSpeak: undefined });
        expect(screen.queryByTestId('why-not-speak')).toBeNull();
    });
});

describe('lane DFES-Q - the host writes the why-not answer in ONE insert and opens that day', () => {
    const whyNot = {
        question: {
            questionKey: 'schedule.why_not', crop: '*', triggerType: 'Schedule', questionType: 'why_not', lens: 'Execution',
            depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'choice,voice', safetyClass: 'informational',
            anchorDateType: 'log_date', agronomistApproved: false, marathiApproved: true, promptMr: PROMPT,
        },
        resolvedPromptMr: PROMPT, triggerReason: `why-not: ${card.cardRef}`, weatherContext: null, expectedStage: null,
        actualStageApplicability: 'any', promptOrigin: 'bank', lookLineIds: [], scheduleCardRef: card.cardRef, missedCard: card,
    };

    beforeEach(() => {
        useDfesQuestionMock.mockReset();
        recordOutcome.mockReset();
        useDfesQuestionMock.mockReturnValue({ selected: whyNot, loading: false, recordOutcome, shownAtUtc: '2026-11-14T04:00:00.000Z' });
    });

    async function loadHost() {
        vi.resetModules();
        vi.doMock('../../../../app/featureFlags', () => ({
            FEATURE_FLAGS: { understandingMeter: true, stageQuestions: true, unlockCounterPaused: true },
            isEnabled: () => true,
        }));
        return (await import('../MeterQuestionHost')).MeterQuestionHost;
    }

    const props = {
        farmId: 'farm-1', plotId: 'plot-1', look: 'sathi' as const,
        questionInputs: { crop: 'grape', todayLocalDate: '2026-11-14', sourceLogId: 'log-9', engagement: { totalRichDays: 0, unlockStatus: 'locked' as const } },
    };

    it('a reason is recorded with its code, his words for it and his अडचण, against the log the question was about', async () => {
        const MeterQuestionHost = await loadHost();
        render(<MeterQuestionHost {...props} onTellPastDay={vi.fn()} />);
        fireEvent.change(screen.getByTestId('why-not-challenge'), { target: { value: 'मजूर दुसऱ्या बागेत गेले' } });
        fireEvent.click(screen.getByText('मजूर मिळाले नाहीत'));

        expect(recordOutcome).toHaveBeenCalledTimes(1);
        expect(recordOutcome).toHaveBeenCalledWith({
            skipped: false, response: 'मजूर मिळाले नाहीत', dailyLogId: 'log-9',
            deviationReasonCode: 'labour_unavailable', deviationChallenge: 'मजूर दुसऱ्या बागेत गेले',
        });
    });

    it('"केलं, पण नोंद केली नाही" records done_not_logged and opens that day\'s past-day flow', async () => {
        const MeterQuestionHost = await loadHost();
        const tellPastDay = vi.fn();
        render(<MeterQuestionHost {...props} onTellPastDay={tellPastDay} />);
        fireEvent.click(screen.getByText('केलं, पण नोंद केली नाही'));

        expect(recordOutcome).toHaveBeenCalledWith(expect.objectContaining({ deviationReasonCode: 'done_not_logged', skipped: false }));
        expect(tellPastDay).toHaveBeenCalledWith('2026-11-11');
    });

    it('नंतर is the engine\'s own skip', async () => {
        const MeterQuestionHost = await loadHost();
        render(<MeterQuestionHost {...props} />);
        fireEvent.click(screen.getByTestId('why-not-later'));

        expect(recordOutcome).toHaveBeenCalledWith({ skipped: true, dailyLogId: 'log-9' });
    });
});
