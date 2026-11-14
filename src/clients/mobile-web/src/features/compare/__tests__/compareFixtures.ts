/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4) - the server's answer (`FarmCompareDto`) for the founder-picked v4 page's
 * worked plot G1 (द्राक्ष, सोनाका, stage "फुलोरा ते फळधारणा", day 50 of 31 to 60, 10 days left), built through the REAL parser so the
 * fixture can never drift from the contract's shape. Own plan is the main schedule: asked 3, done 2, not yet 1; the university schedule 15 / 10 / 5;
 * Dr. Patil 4 पैकी 3 and 1 more; own work "वेली बांधणी", one record on day 41.
 */
import { parseFarmCompare, type FarmCompareDto } from '../data/compareDtos';

export const FARM = '11111111-1111-4111-8111-111111111111';
export const CROP_ID = 'crop-grape';
export const PLOT_ID = '22222222-2222-4222-8222-222222222222';
export const STAGE_NAME = 'फुलोरा ते फळधारणा';

const item = (id: string, title: string, asked: number | null, done: number, notYet: number | null, saidNotDone = 0, moreThanAsked = 0) =>
    ({ activityId: id, title, asked, done, notYet, saidNotDone, moreThanAsked });
const part = (name: string, ...items: ReturnType<typeof item>[]) => ({ part: name, items });
const counts = (asked: number | null, done: number | null, notYet: number | null, said: number, more: number, ...parts: ReturnType<typeof part>[]) =>
    ({ asked, done, notYet, saidNotDone: said, moreThanAsked: more, parts });

export const OWN_COUNTS = counts(3, 2, 1, 0, 0, part('work', item('a-weed', 'खुरपणी (गवत काढणे)', 3, 2, 1)));
export const UNIVERSITY_COUNTS = counts(15, 10, 5, 0, 0,
    part('irrigation', item('u-drip', 'ठिबक सिंचन', 6, 4, 2)),
    part('work', item('u-thin', 'घड विरळणी', 1, 1, 0)),
    part('nutrition', item('u-fert', 'विद्राव्य खत 0:52:34 (ठिबकातून)', 3, 1, 2)),
    part('spray', item('u-fung', 'बुरशीनाशक फवारणी', 4, 3, 1), item('u-ga', 'जीए (संजीवक) बुडवणी', 1, 1, 0)));
export const PATIL_COUNTS = counts(4, 3, 1, 0, 1,
    part('work', item('p-leaf', 'पानांची तपासणी', 1, 0, 1)),
    part('spray', item('p-fung', 'बुरशीनाशक फवारणी', 2, 2, 0, 0, 1), item('p-ins', 'कीटकनाशक फवारणी', 1, 1, 0)));
export const FULORA_COUNTS = counts(1, 1, 0, 0, 0, part('spray', item('b-bor', 'बोरॉन फवारणी', 1, 1, 0)));

export interface FxOwnWork { dailyLogId: string; workKey: string; day: number; stageName: string; part: string; title: string | null; matchedWords: string[]; reason: { kind: string; words: string | null; saidByVoice: boolean } | null }
export interface FxLost { dailyLogId: string; workKey: string; day: number; stageName: string; title: string | null }
export interface FxOrder { firstTitle: string; thenTitle: string; firstDay: number | null; thenDay: number }
export interface FxSchedule { subscriptionId: string; templateId: string; name: string; check: unknown; slot: number; origin: string; isMain: boolean; stages: unknown[]; order: FxOrder[] }
export interface FxStage { name: string; state: string; startDay: number; endDay: number; daysLeft: number | null }
export interface FxPlot { plotId: string; cropCycleId: string; inTrial: boolean; day: number; totalDays: number; stages: FxStage[]; schedules: FxSchedule[]; ownWork: FxOwnWork[]; notRecognised: FxLost[] }
export interface FxAnswer { serverTimeUtc: string; recogniserVersions: { vocabulary: string; catalog: string }; plots: FxPlot[] }

const schedule = (id: string, name: string, slot: number, origin: 'Own' | 'Outside', isMain: boolean, stageCounts: unknown, order: FxOrder[] = []): FxSchedule => ({
    subscriptionId: `sub-${id}`, templateId: `tpl-${id}`, name, check: origin === 'Own' ? null : { state: 'Checked', checkerDisplayName: null, checkedAtUtc: null, note: null },
    slot, origin, isMain, stages: [null, stageCounts, null], order,
});

const freshAnswer = (): FxAnswer => ({
    serverTimeUtc: '2026-11-14T06:30:00.000Z',
    recogniserVersions: { vocabulary: 'v1', catalog: 'c1' },
    plots: [{
        plotId: PLOT_ID, cropCycleId: 'cycle-1', inTrial: false, day: 50, totalDays: 90,
        stages: [
            { name: 'फुटवा वाढ', state: 'passed', startDay: 0, endDay: 30, daysLeft: null },
            { name: STAGE_NAME, state: 'current', startDay: 31, endDay: 60, daysLeft: 10 },
            { name: 'फळवाढ', state: 'ahead', startDay: 61, endDay: 90, daysLeft: null },
        ],
        schedules: [
            schedule('own', 'माझं द्राक्ष शेड्यूल', 0, 'Own', true, OWN_COUNTS),
            schedule('uni', 'कृषी विद्यापीठ शेड्यूल', 1, 'Outside', false, UNIVERSITY_COUNTS,
                [{ firstTitle: 'बुरशीनाशक फवारणी', thenTitle: 'जीए (संजीवक) बुडवणी', firstDay: null, thenDay: 44 }]),
            schedule('patil', 'डॉ. पाटील यांचं शेड्यूल', 2, 'Outside', false, PATIL_COUNTS),
            schedule('fulora', 'फुलोरा काळजी शेड्यूल', 3, 'Outside', false, FULORA_COUNTS),
        ],
        ownWork: [{ dailyLogId: 'log-1', workKey: 'work:vine-tying', day: 41, stageName: STAGE_NAME, part: 'work', title: 'वेली बांधणी', matchedWords: [], reason: null }],
        notRecognised: [],
    }],
});

/** A fresh deep copy every time: a test that edits it can never leak into the next one. */
export const baseAnswer = (): FxAnswer => JSON.parse(JSON.stringify(freshAnswer())) as FxAnswer;

export type Answer = FxAnswer;
export type AnswerPlot = FxPlot;

/** The answer through the real parser (whole-or-nothing): a shape the contract refuses fails the test, not the screen. */
export function answerOf(change?: (a: Answer) => void): FarmCompareDto {
    const raw = baseAnswer();
    change?.(raw);
    const parsed = parseFarmCompare(raw);
    if (!parsed) throw new Error('the fixture is not a readable answer');
    return parsed;
}

/** The crops of the phone, shaped like `CropProfile` (what the selector reads). */
export const cropsOf = (extra: unknown[] = []) => ([
    { id: CROP_ID, name: 'द्राक्ष', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT_ID, name: 'सोनाका' }, { id: 'plot-2', name: 'प्लॉट 2' }] },
    { id: 'crop-pom', name: 'डाळिंब', iconName: 'Pomegranate', color: 'rose', plots: [{ id: 'plot-3', name: 'प्लॉट 3' }] },
    ...extra,
]) as never;
