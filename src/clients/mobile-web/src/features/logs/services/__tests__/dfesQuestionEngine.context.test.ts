/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionEngine — context-rich prompt resolution (Task 7).
 *
 * Founder ruling 3 (2026-08-14): a question must SPEAK the context it was
 * chosen from, not just be chosen by it. The engine has always RECEIVED
 * weather / stage / schedule / observation and used them to pick the day's
 * question; `resolvePrompt` only ever substituted {crop}, {observation} and
 * {category}, so the chosen question still spoke generically and the weather
 * never reached the farmer's ear. These tests pin the mechanism:
 *   - {weather} speaks the condition the engine already used,
 *   - {lastActivity}/{daysAgo} refer to the farmer's real previous log,
 *   - NO unfilled token can ever reach a farmer (including a repeated token,
 *     and a token this resolver does not know about).
 *
 * The shipped bank copy is agronomist-approved and is NOT touched here — the
 * token-carrying templates below are substituted fixtures, mounted with the
 * same vi.doMock + vi.resetModules() + dynamic-import isolation the Schedule
 * and WeatherReconcile tier suites in dfesQuestionEngine.test.ts already use.
 * The one suite that runs against the REAL bank is the farmer-visible
 * guarantee: every shipped prompt must resolve token-free.
 *
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-7)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectDailyQuestion, resolvePrompt, type DailyQuestionInputs } from '../dfesQuestionEngine';
import { DFES_QUESTION_BANK, type DfesQuestion } from '../dfesQuestionBank';
import { computePreviousLog } from '../dfesPreviousLog';
import type { DailyLog, VlogScore } from '../../../../domain/types/log.types';

/** Any `{token}` still visible in a resolved prompt. A farmer must never see one. */
const ANY_TOKEN = /\{[a-zA-Z]+\}/;

const scoreWithGap = (dim: string): VlogScore => ({
    score: 40, outcome: 'SCORED',
    dimensions: [{ dimension: dim, applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }],
});

/** Same fixture shape dfesQuestionEngine.test.ts's `base` uses (a single DOSE gap, no higher trigger). */
const inputsWith = (o: Partial<DailyQuestionInputs> = {}): DailyQuestionInputs => ({
    crop: 'grapes',
    todayLocalDate: '2026-08-14',
    score: scoreWithGap('DOSE'),
    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
    recentEvents: [],
    ...o,
});

describe('resolvePrompt — speaks the context the engine already knows (Task 7)', () => {
    it('substitutes {weather} with the condition the engine used to choose the question', () => {
        const resolved = resolvePrompt(
            'आज {weather} आहे — किती मात्रा वापरली?',
            inputsWith({ weather: { conditionText: 'पाऊस' } }),
        );
        expect(resolved).toBe('आज पाऊस आहे — किती मात्रा वापरली?');
    });

    it('substitutes {lastActivity} and {daysAgo} from the previous log', () => {
        const resolved = resolvePrompt(
            '{daysAgo} दिवसांपूर्वी {lastActivity} झाली होती — आता काय दिसतंय?',
            inputsWith({ previousLog: { activityMr: 'फवारणी', daysAgo: 3 } }),
        );
        expect(resolved).toBe('3 दिवसांपूर्वी फवारणी झाली होती — आता काय दिसतंय?');
    });

    it('keeps the existing {crop} / {observation} / {category} substitutions working', () => {
        expect(resolvePrompt('{crop} आता कोणत्या टप्प्यात आहे?', inputsWith({ crop: 'द्राक्ष' })))
            .toBe('द्राक्ष आता कोणत्या टप्प्यात आहे?');
        expect(resolvePrompt('"{observation}" — आता काय दिसतंय?', inputsWith({ openObservation: { summary: 'पानं पिवळी' } })))
            .toBe('"पानं पिवळी" — आता काय दिसतंय?');
        expect(resolvePrompt('आज ठरलेलं {category} काम झालं का?', inputsWith({
            scheduleContext: { category: 'IRRIGATION', categoryLabelMr: 'सिंचन' },
        }))).toBe('आज ठरलेलं सिंचन काम झालं का?');
    });

    it('replaces EVERY occurrence of a token, not just the first', () => {
        expect(resolvePrompt('{crop} — {crop}', inputsWith({ crop: 'द्राक्ष' }))).toBe('द्राक्ष — द्राक्ष');
    });

    it('leaves no SECOND occurrence behind when the context is absent either', () => {
        const resolved = resolvePrompt('अ {weather} ब {weather} क', inputsWith({ weather: undefined }));
        expect(resolved).not.toMatch(ANY_TOKEN);
    });

    it('strips a token whose context is missing instead of printing it', () => {
        const resolved = resolvePrompt('{weather} आज कसं होतं ?', inputsWith({ weather: undefined }));
        expect(resolved).toBe('आज कसं होतं?');
    });

    it('strips a token this resolver does not know about — a copy typo must never reach a farmer', () => {
        const resolved = resolvePrompt('आज {cropz} कसं आहे?', inputsWith());
        expect(resolved).not.toMatch(ANY_TOKEN);
    });

    it('P4: no previous log means NO previous-log text — nothing is invented in its place', () => {
        const resolved = resolvePrompt(
            'मागच्या वेळी {lastActivity} — आज काय केलं?',
            inputsWith({ previousLog: undefined }),
        );
        expect(resolved).toBe('मागच्या वेळी — आज काय केलं?');
        expect(resolved).not.toMatch(ANY_TOKEN);
    });
});

// The engine-level half: the question the ENGINE picked must come back
// already speaking its context. Only `promptMr` differs from the real
// gap.dose entry, so any difference in `resolvedPromptMr` can only come from
// the resolver, not from some other substituted property.
describe('selectDailyQuestion — the chosen question SPEAKS its context (Task 7)', () => {
    afterEach(() => {
        vi.doUnmock('../dfesQuestionBank');
        vi.resetModules();
    });

    const tokenised = (promptMr: string): DfesQuestion => ({
        questionKey: 'gap.dose', crop: '*', triggerType: 'Gap', questionType: 'gap_fill',
        lens: 'Execution', depthLevel: 1, priority: 6, cooldownDays: 3, answerModes: 'voice',
        safetyClass: 'informational', anchorDateType: 'log_date',
        promptMr, agronomistApproved: true, marathiApproved: true,
    });

    async function selectWithPrompt(promptMr: string, extra: Partial<DailyQuestionInputs> = {}) {
        vi.resetModules();
        vi.doMock('../dfesQuestionBank', async () => {
            const actual = await vi.importActual<typeof import('../dfesQuestionBank')>('../dfesQuestionBank');
            return {
                ...actual,
                findGapQuestion: (dimension: string) =>
                    dimension === 'DOSE' ? tokenised(promptMr) : actual.findGapQuestion(dimension),
            };
        });
        const { selectDailyQuestion: selectMocked } = await import('../dfesQuestionEngine');
        return selectMocked(inputsWith(extra));
    }

    it('speaks the weather it already used to choose the question', async () => {
        const picked = await selectWithPrompt('आज {weather} आहे — किती मात्रा वापरली?', {
            weather: { conditionText: 'पाऊस' },
        });
        expect(picked!.resolvedPromptMr).toContain('पाऊस');
    });

    it('refers to what the farmer did last time', async () => {
        const picked = await selectWithPrompt('{daysAgo} दिवसांपूर्वी {lastActivity} — किती मात्रा वापरली?', {
            previousLog: { activityMr: 'फवारणी', daysAgo: 3 },
        });
        expect(picked!.resolvedPromptMr).toContain('फवारणी');
        expect(picked!.resolvedPromptMr).toContain('3');
    });

    it('never leaves an unfilled token visible to the farmer', async () => {
        const picked = await selectWithPrompt(
            'आज {weather} — {daysAgo} दिवसांपूर्वी {lastActivity} — {weather} किती मात्रा वापरली?',
            { weather: undefined, previousLog: undefined },
        );
        expect(picked!.resolvedPromptMr).not.toMatch(ANY_TOKEN);
    });
});

// The one suite that runs against the REAL, shipped, agronomist-approved bank:
// whatever the copy says, resolving it with NO context available must never
// leave a token on screen.
describe('every SHIPPED bank prompt resolves token-free with no context (farmer-visible guarantee)', () => {
    const noContext = inputsWith({
        crop: '',
        weather: undefined,
        previousLog: undefined,
        openObservation: undefined,
        scheduleContext: undefined,
    });

    it.each(DFES_QUESTION_BANK.map(q => [q.questionKey, q.promptMr] as const))(
        '%s leaves no token behind',
        (_questionKey, promptMr) => {
            expect(resolvePrompt(promptMr, noContext)).not.toMatch(ANY_TOKEN);
        },
    );

    // End-to-end through the REAL bank and the REAL selector (no mocks): the
    // stage question carries {crop}, and a saved log can genuinely arrive with
    // no crop name (mainView passes `selection?.cropName ?? ''`).
    it('the REAL engine, on a REAL bank entry with its context missing, still hands back a token-free prompt', () => {
        const picked = selectDailyQuestion(inputsWith({
            crop: '',
            score: { score: 90, outcome: 'SCORED', dimensions: [] },
            stageContext: { crop: '', expectedStage: 'flowering' },
            lastStageConfirm: null,
        }));
        expect(picked!.question.questionKey).toBe('stage.confirm_current');
        expect(picked!.resolvedPromptMr).not.toMatch(ANY_TOKEN);
        expect(picked!.resolvedPromptMr).toBe('आता कोणत्या टप्प्यात आहे?');
    });
});

// P4 / anti-fabrication: `previousLog` must come from a real prior log or not
// exist at all. These tests drive the derivation the call site
// (LedgerRecognitionPanel) uses to build it.
describe('computePreviousLog — the real previous log, never an invented one (Task 7)', () => {
    const TODAY = '2026-08-14';

    const makeLog = (o: Partial<DailyLog> = {}): DailyLog => ({
        id: 'log-1',
        date: '2026-08-11',
        context: { selection: [{ cropId: 'crop-1', cropName: 'grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['Plot 1'] }] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...o,
    });

    const sprayLog = (date: string) => makeLog({ id: `spray-${date}`, date, inputs: [{ id: 'i1', method: 'Spray', mix: [] }] });

    it('returns the most recent PRIOR log as a Marathi activity + how many days ago', () => {
        const result = computePreviousLog([sprayLog('2026-08-08'), sprayLog('2026-08-11')], 'plot-1', TODAY);
        expect(result).toEqual({ activityMr: 'फवारणी', daysAgo: 3 });
    });

    it('never cites TODAY\'s own log — "last time" means before today', () => {
        expect(computePreviousLog([sprayLog(TODAY)], 'plot-1', TODAY)).toBeNull();
    });

    it('P4: no prior log at all → null, so no previous-log clause is ever invented', () => {
        expect(computePreviousLog([], 'plot-1', TODAY)).toBeNull();
    });

    it('scopes to the plot the farmer just logged against', () => {
        const otherPlot = makeLog({
            id: 'other', date: '2026-08-13',
            context: { selection: [{ cropId: 'crop-2', cropName: 'cane', selectedPlotIds: ['plot-2'], selectedPlotNames: ['Plot 2'] }] },
            inputs: [{ id: 'i9', method: 'Spray', mix: [] }],
        });
        const result = computePreviousLog([otherPlot, sprayLog('2026-08-11')], 'plot-1', TODAY);
        expect(result).toEqual({ activityMr: 'फवारणी', daysAgo: 3 });
    });

    it('reads every category through the app\'s existing Marathi labels — never a new word', () => {
        const irrigation = makeLog({ date: '2026-08-13', irrigation: [{ id: 'ir1', method: 'Drip', source: 'well' }] });
        expect(computePreviousLog([irrigation], 'plot-1', TODAY)!.activityMr).toBe('सिंचन');

        const fertigation = makeLog({ date: '2026-08-13', inputs: [{ id: 'i2', method: 'Drip', mix: [] }] });
        expect(computePreviousLog([fertigation], 'plot-1', TODAY)!.activityMr).toBe('खत');

        const activity = makeLog({ date: '2026-08-13', cropActivities: [{ id: 'a1', title: 'Pruning' }] });
        expect(computePreviousLog([activity], 'plot-1', TODAY)!.activityMr).toBe('कामे');
    });

    it('skips a prior day with no recorded work and refers to the last day that actually had some', () => {
        const emptyDay = makeLog({ id: 'empty', date: '2026-08-13' });
        const result = computePreviousLog([emptyDay, sprayLog('2026-08-11')], 'plot-1', TODAY);
        expect(result).toEqual({ activityMr: 'फवारणी', daysAgo: 3 });
    });

    it('returns null when the only prior logs recorded no work at all', () => {
        expect(computePreviousLog([makeLog({ date: '2026-08-13' })], 'plot-1', TODAY)).toBeNull();
    });
});
