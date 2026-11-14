// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-104, D-139 fifth note / F259; R10, R33, R34; P4, P9)
 *
 * तुलना as the founder picked it (compare-redesign-v4): the log page's crop -> plot selector, then ONE primary card (his own plan), the other
 * schedules as name + count (never ranked), four category tiles, and the sheets - all DRAWN FROM THE SERVER'S ANSWER (the fixture is the v4 page's
 * worked plot G1, built through the real parser). The page imports no comparison engine of its own; every number on it is a number the answer holds
 * (change a number in the fixture and the screen changes). Only the edges are mocked: the answer's hook, the language, the farm, the "seen"
 * flag, the mic recorder and the voice parse.
 *
 * What replaced the old tests: the previous `ComparePage.render.test.tsx` drove the page through the phone's own comparison engine (a mocked
 * `generatePlotComparison`, a 7-day week, "झालं, सांगा" rows); that page and its words are gone, so those cases were deleted with it. The engine's
 * own tests (compareChecklist / compareText / compareWeek / plotComparisonService.fertigation) stay: the engine files stay until the clean-up lane.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FarmCompareResult } from '../data/compareClient';
import type { FarmCompareDto } from '../data/compareDtos';
import { CROP_ID, FARM, PLOT_ID, STAGE_NAME, answerOf, cropsOf, type Answer } from './compareFixtures';

const h = vi.hoisted(() => ({
    lang: 'mr' as 'mr' | 'en',
    result: undefined as unknown,
    seen: true,
    setSeen: vi.fn(),
    farm: null as string | null,
}));

vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../core/session/FarmContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: h.farm }),
}));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [h.seen, h.setSeen, true] as const }));
vi.mock('../data/compareClient', () => ({ useFarmCompare: () => h.result }));
vi.mock('../../plannedWork/components/PlanMic', () => ({ default: () => <div data-testid="plan-mic" />, PlanMic: () => <div data-testid="plan-mic" /> }));
vi.mock('../../plannedWork/data/planVoice', () => ({ understandPlanSpeech: vi.fn() }));

import { ComparePage } from '../ComparePage';

const served = (compare: FarmCompareDto, source: 'server' | 'cache' = 'server'): FarmCompareResult =>
    ({ kind: 'compare', compare, source, asOfUtc: compare.serverTimeUtc });

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });

function openPlot(onOpenSchedule?: () => void) {
    const view = render(<ComparePage crops={cropsOf()} onOpenSchedule={onOpenSchedule} />);
    fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
    fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
    return view;
}
const screenText = () => screen.getByTestId('compare-screen').textContent ?? '';
const ahead = () => fireEvent.click(screen.getByTestId('compare-stage-next'));
const previous = () => fireEvent.click(screen.getByTestId('compare-stage-prev'));
const own = (a: Answer) => a.plots[0].schedules[0];
const ANY_DIGIT = /[0-9०-९]/;

beforeEach(() => { h.lang = 'mr'; h.farm = FARM; h.seen = true; h.setSeen.mockReset(); h.result = served(answerOf()); setOnline(true); });
afterEach(() => { cleanup(); setOnline(true); });

describe('screen 1: the selector (the log page\'s own CropSelector)', () => {
    it('asks "कोणत्या पिकाची तुलना पाहायची ?", draws the crop cards and no "संपूर्ण शेत" card (a compare is per plot)', () => {
        render(<ComparePage crops={cropsOf()} />);
        expect(screen.getByTestId('flow-sathi-question').textContent).toBe('कोणत्या पिकाची तुलना पाहायची ?');
        expect(screen.getByTestId(`flow-crop-${CROP_ID}`)).toBeInTheDocument();
        expect(screen.getByTestId('flow-crop-crop-pom')).toBeInTheDocument();
        expect(screen.queryByTestId('flow-crop-whole-farm')).toBeNull();
        expect(screen.queryByTestId('compare-screen')).toBeNull();
    });

    it('a crop with ONE plot opens the compare straight away', () => {
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId('flow-crop-crop-pom'));
        expect(screen.getByTestId('compare-screen')).toBeInTheDocument();
        expect(screen.getByTestId('compare-chip').textContent).toContain('डाळिंब · प्लॉट 3');
    });

    it('a crop with several plots asks the plot, and the plot tap opens the compare; the chip goes back to the selector', () => {
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        expect(screen.getByTestId('flow-sathi-hint').textContent).toBe('प्लॉट निवडला की तुलना उघडेल.');
        expect(screen.queryByTestId('compare-screen')).toBeNull();
        fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
        expect(screen.getByTestId('compare-chip').textContent).toContain('द्राक्ष · सोनाका');
        fireEvent.click(screen.getByTestId('compare-chip'));
        expect(screen.getByTestId('compare-selector')).toBeInTheDocument();
        expect(screen.queryByTestId('compare-screen')).toBeNull();
    });

    it('a crop with no plots says so in a plain line', () => {
        const empty = { id: 'crop-x', name: 'ऊस', iconName: 'Sugarcane', color: 'emerald', plots: [] };
        render(<ComparePage crops={cropsOf([empty])} />);
        fireEvent.click(screen.getByTestId('flow-crop-crop-x'));
        expect(screen.getByTestId('compare-crop-no-plots').textContent).toBe('या पिकाचा अजून प्लॉट नाही.');
    });

    it('no crop at all: the old page\'s plain words, no selector', () => {
        render(<ComparePage crops={[]} />);
        expect(screen.getByTestId('compare-no-plots')).toBeInTheDocument();
        expect(screen.queryByTestId('compare-selector')).toBeNull();
    });
});

describe('screen 2: the primary card and the stage (normal, mid-stage)', () => {
    it('his own plan is the primary card: title, headline, story bar and the plain line, all from the server\'s totals', () => {
        openPlot();
        expect(screen.getByTestId('compare-primary-tag').textContent).toBe('माझं नियोजन · मुख्य');
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('१');
        expect(screen.getByTestId('compare-headline').textContent).toContain('कामाची अजून नोंद नाही');
        expect(screen.getByTestId('compare-story-done').textContent).toBe('२');
        expect(screen.getByTestId('compare-story-asked').textContent).toBe('३');
        expect(screen.getByTestId('compare-story-none').textContent).toBe('१');
        expect(screen.getByTestId('compare-plain-line').textContent).toBe('नोंद नाही, म्हणजे काम झालं नाही असं नाही.');
        expect(screen.getByTestId('compare-fresh').textContent).toBe('अपडेट: आत्ताच');
    });

    it('the stage line: the server\'s current stage and its days left; previous and next step to the neighbours', () => {
        openPlot();
        expect(screen.getByTestId('compare-stage-name').textContent).toBe(STAGE_NAME);
        expect(screen.getByTestId('compare-stage-sub').textContent).toBe('स्टेज संपायला १० दिवस');
        previous();
        expect(screen.getByTestId('compare-stage-name').textContent).toBe('फुटवा वाढ');
        expect(screen.getByTestId('compare-stage-sub').textContent).toBe('संपलेली स्टेज');
        expect(screen.getByTestId('compare-stage-prev')).toBeDisabled();
    });

    it('a main schedule that is NOT his own is titled with its name and "मुख्य"', () => {
        h.result = served(answerOf(a => {
            a.plots[0].schedules[0].isMain = false;
            a.plots[0].schedules[1].isMain = true;
        }));
        openPlot();
        expect(screen.getByTestId('compare-primary-tag').textContent).toBe('कृषी विद्यापीठ शेड्यूल · मुख्य');
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('५');
    });

    it('every shown number equals the answer\'s number: change the fixture and the screen changes (nothing is recomputed)', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { asked: number; done: number; notYet: number };
            c.asked = 7; c.done = 3; c.notYet = 4;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('४');
        expect(screen.getByTestId('compare-story-done').textContent).toBe('३');
        expect(screen.getByTestId('compare-story-asked').textContent).toBe('७');
        // a total that disagrees with its own works is still drawn as the server sent it (the phone adds no check of its own)
        expect(screen.getByTestId('compare-story').getAttribute('aria-label')).toBe('सांगितलं ७, केलं ३');
    });

    it('nothing recorded yet: "अजून नोंद नाही", no big number of what is "left"', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { done: number; notYet: number };
            c.done = 0; c.notYet = 3;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline').textContent).toBe('अजून नोंद नाही');
        expect(screen.queryByTestId('compare-headline-number')).toBeNull();
    });

    it('everything matched: "सगळं जुळलं"', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { done: number; notYet: number };
            c.done = 3; c.notYet = 0;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline').textContent).toBe('सगळं जुळलं');
    });

    it('one record says "not done": the line is the plan\'s word, and it is not counted as "no record"', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { saidNotDone: number; parts: { items: { saidNotDone: number }[] }[] };
            c.saidNotDone = 1; c.parts[0].items[0].saidNotDone = 1;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline').textContent).toBe('१नोंदीत: झालं नाही असं सांगितलं');
        expect(screen.getByTestId('compare-story-none').textContent).toBe('०');
    });

    it('a said-not-done AND a work with no record: both are told, each with its own number', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { asked: number; notYet: number; saidNotDone: number };
            c.asked = 4; c.notYet = 2; c.saidNotDone = 1;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('१');
        expect(screen.getByTestId('compare-headline').textContent).toContain('आणि १ नोंदीत: झालं नाही असं सांगितलं');
    });

    it('a stage with no stored days: the schedule asks no count, so the card says what came, never a made-up total', () => {
        h.result = served(answerOf(a => {
            own(a).stages[1] = { asked: null, done: null, notYet: null, saidNotDone: 0, moreThanAsked: 0, parts: [{ part: 'work', items: [{ activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: null, done: 2, notYet: null, saidNotDone: 0, moreThanAsked: 0 }] }] } as never;
        }));
        openPlot();
        expect(screen.getByTestId('compare-headline').textContent).toBe('नोंदीत आलं: २');
        expect(screen.queryByTestId('compare-story')).toBeNull();
    });
});

describe('the stages the server gave no numbers for', () => {
    it('an ahead stage: its name and "अजून सुरू झालेला नाही", NO number anywhere, the other schedules by name only', () => {
        openPlot();
        ahead();
        expect(screen.getByTestId('compare-stage-ahead').textContent).toContain('फळवाढ');
        expect(screenText()).toContain('अजून सुरू झालेला नाही');
        expect(screen.queryByTestId('compare-primary-card')).toBeNull();
        expect(screen.queryByTestId('compare-tiles')).toBeNull();
        expect(screen.queryAllByTestId('compare-schedule-count')).toHaveLength(0);
        expect(screen.getByTestId('compare-stage-line').textContent).not.toMatch(ANY_DIGIT);
        expect(screen.getByTestId('compare-stage-ahead').textContent).not.toMatch(ANY_DIGIT);
        // the one count left is how many schedules there are (structure), never a stage number
        const rest = screenText().split(screen.getByTestId('compare-others').querySelector('b')!.textContent ?? '').join('');
        expect(rest).not.toMatch(ANY_DIGIT);
        expect(screen.getByTestId('compare-others').textContent).toContain('कृषी विद्यापीठ शेड्यूल');
    });

    it('a passed stage the server sent as null (the trial: only today\'s stage is counted, R10): no number, a plain line', () => {
        openPlot();
        previous();
        expect(screen.getByTestId('compare-stage-no-numbers').textContent).toBe('या स्टेजचे आकडे इथे दिसत नाहीत.');
        expect(screen.queryByTestId('compare-primary-card')).toBeNull();
    });

    it('a passed stage that carries numbers says "नोंदीत आलं नाही", never "अजून नोंद नाही", and shows no days left', () => {
        h.result = served(answerOf(a => {
            const p = a.plots[0];
            p.schedules.forEach(s => { s.stages[0] = JSON.parse(JSON.stringify(s.stages[1])); });
            p.ownWork = [];
        }));
        openPlot();
        previous();
        expect(screen.getByTestId('compare-headline').textContent).toContain('काम नोंदीत आलं नाही');
        expect(screen.getByTestId('compare-headline').textContent).not.toContain('अजून नोंद नाही');
        expect(screen.getByTestId('compare-stage-sub').textContent).toBe('संपलेली स्टेज');
    });
});

describe('after the trial with nothing followed (D-83 = 1)', () => {
    const nothing = () => answerOf(a => { a.plots[0].stages = []; a.plots[0].schedules = []; a.plots[0].ownWork = []; });

    it('the answer has no stages and no schedules: the screen only says "आधी शेड्यूल निवडा", with a door to the schedule page, and no number', () => {
        h.result = served(nothing());
        const toSchedule = vi.fn();
        openPlot(toSchedule);
        expect(screen.getByTestId('compare-choose-schedule').textContent).toContain('आधी शेड्यूल निवडा');
        expect(screenText()).not.toMatch(ANY_DIGIT);
        fireEvent.click(screen.getByTestId('compare-choose-schedule-button'));
        expect(toSchedule).toHaveBeenCalledTimes(1);
    });

    it('no door to open: no dead button is drawn (P5)', () => {
        h.result = served(nothing());
        openPlot();
        expect(screen.queryByTestId('compare-choose-schedule-button')).toBeNull();
    });
});

describe('the other schedules: name + count, never ranked, never a best', () => {
    it('the three others carry their server counts, "शेड्यूलपेक्षा N जास्त" is neutral text, "इतर ३ शेड्यूल" and "फक्त संदर्भासाठी"', () => {
        openPlot();
        const card = screen.getByTestId('compare-others');
        expect(card.textContent).toContain('इतर ३ शेड्यूल');
        expect(card.textContent).toContain('फक्त संदर्भासाठी');
        expect(within(screen.getByTestId('compare-other-sub-uni')).getByTestId('compare-schedule-count').textContent).toBe('१५ पैकी १० जुळलं');
        expect(within(screen.getByTestId('compare-other-sub-patil')).getByTestId('compare-schedule-count').textContent).toBe('४ पैकी ३ जुळलं');
        expect(screen.getByTestId('compare-other-sub-patil').textContent).toContain('शेड्यूलपेक्षा १ जास्त');
        expect(within(screen.getByTestId('compare-other-sub-fulora')).getByTestId('compare-schedule-count').textContent).toBe('१ पैकी १ जुळलं');
    });

    it('they stay in the server\'s order (not sorted by match) and nothing says "best"', () => {
        h.result = served(answerOf(a => { const [o, uni, patil, fulora] = a.plots[0].schedules; a.plots[0].schedules = [o, fulora, patil, uni]; }));
        openPlot();
        const names = within(screen.getByTestId('compare-others')).getAllByTestId('compare-other-name').map(e => e.textContent);
        expect(names).toEqual(['फुलोरा काळजी शेड्यूल', 'डॉ. पाटील यांचं शेड्यूल', 'कृषी विद्यापीठ शेड्यूल']);
        expect(screenText()).not.toMatch(/सगळ्यात जास्त|सर्वोत्तम|best|%|टक्के/i);
    });

    it('a schedule that stores no days shows "नोंदीत आलं: N" (the works\' own numbers), not "N पैकी M"', () => {
        h.result = served(answerOf(a => {
            a.plots[0].schedules[2].stages[1] = { asked: null, done: null, notYet: null, saidNotDone: 0, moreThanAsked: 0, parts: [{ part: 'work', items: [{ activityId: 'p-leaf', title: 'पानांची तपासणी', asked: null, done: 2, notYet: null, saidNotDone: 0, moreThanAsked: 0 }] }] } as never;
        }));
        openPlot();
        expect(within(screen.getByTestId('compare-other-sub-patil')).getByTestId('compare-schedule-count').textContent).toBe('नोंदीत आलं: २');
    });

    it('a tap opens that schedule\'s rows (read-only reference) with its order note in neutral words; back from a row returns to it', () => {
        openPlot();
        fireEvent.click(screen.getByTestId('compare-other-sub-uni'));
        const sheet = screen.getByTestId('compare-ref-sheet-sub-uni');
        expect(sheet.textContent).toContain('फक्त संदर्भासाठी');
        expect(within(sheet).getAllByTestId(/^compare-ref-row-/)).toHaveLength(5);
        expect(within(sheet).getByTestId('compare-order-note').textContent).toBe('क्रम: कृषी विद्यापीठ शेड्यूल मध्ये आधी बुरशीनाशक फवारणी, मग जीए (संजीवक) बुडवणी');
        fireEvent.click(within(sheet).getByTestId('compare-ref-row-u-drip'));
        expect(screen.getByTestId('compare-row-sheet-u-drip')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('compare-sheet-back'));
        expect(screen.getByTestId('compare-ref-sheet-sub-uni')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('compare-sheet-close'));
        expect(screen.queryByTestId('compare-ref-sheet-sub-uni')).toBeNull();
    });
});

describe('the four category tiles and their sheets', () => {
    it('a tile counts that part\'s works from the server\'s own numbers; a part the primary schedule lacks says "नियोजनात नाही" and, when another schedule has it, "इतर शेड्यूलमध्ये आहे"', () => {
        openPlot();
        expect(screen.getByTestId('compare-tile-work-text').textContent).toBe('३ पैकी २ जुळलं');
        expect(screen.getByTestId('compare-tile-irrigation-text').textContent).toBe('नियोजनात नाही');
        expect(screen.getByTestId('compare-tile-irrigation').textContent).toContain('इतर शेड्यूलमध्ये आहे');
        expect(screen.getByTestId('compare-tile-nutrition').textContent).toContain('इतर शेड्यूलमध्ये आहे');
        expect(screen.getByTestId('compare-tile-work-own').textContent).toBe('शेड्यूलमध्ये नव्हतं १');
        expect(screen.getByTestId('compare-tile-work-dots').querySelectorAll('i').length).toBe(3); // 2 done + 1 no record
    });

    it('a part that no schedule has says only "नियोजनात नाही"', () => {
        h.result = served(answerOf(a => {
            a.plots[0].schedules.forEach(s => { const c = s.stages[1] as { parts: { part: string }[] }; c.parts = c.parts.filter(p => p.part !== 'irrigation'); });
        }));
        openPlot();
        expect(screen.getByTestId('compare-tile-irrigation').textContent).toContain('नियोजनात नाही');
        expect(screen.getByTestId('compare-tile-irrigation').textContent).not.toContain('इतर शेड्यूलमध्ये आहे');
    });

    it('a tile opens the mirror: the schedule says (grey dots + number) -> you did (green dots + number), the middle badge a grey number; "work in no schedule" is one more row, neutral', () => {
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        const sheet = screen.getByTestId('compare-category-work');
        expect(sheet.textContent).toContain('शेतीची कामं');
        expect(within(sheet).getByTestId('asked:compare-row-a-weed').textContent).toBe('३');
        expect(within(sheet).getByTestId('done:compare-row-a-weed').textContent).toBe('२');
        expect(within(within(sheet).getByTestId('compare-row-a-weed')).getByRole('img', { name: 'अजून नोंद नाही' }).textContent).toBe('१');
        const ownRow = within(sheet).getByTestId('compare-own-row-log-1:work:vine-tying');
        expect(ownRow.textContent).toContain('वेली बांधणी');
        expect(ownRow.textContent).toContain('शेड्यूलमध्ये नव्हतं · तुम्ही केलं');
        expect(within(ownRow).queryByRole('img', { name: 'सगळं जुळलं' })).toBeNull(); // no tick, no gap number on his own work
        expect(sheet.textContent).toContain('इतर शेड्यूल या स्टेजला काय सांगतात (फक्त संदर्भासाठी)');
    });

    it('a row tap is the 3-step sheet; matched rows show counts only (no invented dates)', () => {
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        fireEvent.click(screen.getByTestId('compare-row-a-weed'));
        const sheet = screen.getByTestId('compare-row-sheet-a-weed');
        expect(within(sheet).getByTestId('compare-step-1').textContent).toContain('३ वेळा');
        expect(within(sheet).getByTestId('compare-step-2').textContent).toContain('नोंदी: २');
        expect(within(sheet).getByTestId('compare-step-2').textContent).toContain('तारखा या तुलनेत दिसत नाहीत, फक्त संख्या.');
        const why = within(sheet).getByTestId('compare-step-3').textContent ?? '';
        expect(why).toContain('स्टेज संपायला १० दिवस');
        expect(why).toContain('नोंद नाही, म्हणजे काम झालं नाही असं नाही.');
        expect(within(sheet).queryByTestId('compare-sheet-back')).not.toBeNull();
    });

    it('a work with more records than asked wears "शेड्यूलपेक्षा N जास्त" neutrally; an item with no stored days reads "नोंदीत आलं: N"', () => {
        h.result = served(answerOf(a => {
            const c = own(a).stages[1] as { parts: { items: unknown[] }[] };
            c.parts[0].items = [
                { activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: 3, done: 3, notYet: 0, saidNotDone: 0, moreThanAsked: 2 },
                { activityId: 'a-free', title: 'पाहणी', asked: null, done: 4, notYet: null, saidNotDone: 0, moreThanAsked: 0 },
            ];
        }));
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        expect(screen.getByTestId('compare-row-a-weed').textContent).toContain('शेड्यूलपेक्षा २ जास्त');
        expect(screen.getByTestId('compare-row-a-free').textContent).toContain('नोंदीत आलं: ४');
    });
});

describe('own work and what the server could not read', () => {
    const withReason = (reason: unknown) => answerOf(a => { a.plots[0].ownWork[0].reason = reason as never; });

    it('the server\'s reason shows as the kind\'s picture AND his words', () => {
        h.result = served(withReason({ kind: 'Extra', words: 'वेलीला आधार हवा होता', saidByVoice: false }));
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        expect(screen.getByTestId('compare-own-row-reason')).toHaveAttribute('aria-label', 'जास्तीचं काम');
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
        expect(screen.getByTestId('compare-own-saved').textContent).toContain('जास्तीचं काम');
        expect(screen.getByTestId('compare-own-saved-words').textContent).toContain('वेलीला आधार हवा होता');
    });

    it('a reason whose words the server withheld draws the kind only', () => {
        h.result = served(withReason({ kind: 'Weather', words: null, saidByVoice: true }));
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
        expect(screen.getByTestId('compare-own-saved').textContent).toContain('हवामानामुळे बदल');
        expect(screen.queryByTestId('compare-own-saved-words')).toBeNull();
    });

    it('a record the server could not read reads "हे काम ओळखता आलं नाही" and gets no choices, no row to tap', () => {
        h.result = served(answerOf(a => { a.plots[0].notRecognised = [{ dailyLogId: 'log-9', workKey: 'x', day: 44, stageName: STAGE_NAME, title: 'काहीतरी' }]; }));
        openPlot();
        expect(screen.getByTestId('compare-not-recognised').textContent).toContain('हे काम ओळखता आलं नाही');
        expect(screen.getByTestId('compare-not-recognised-item').textContent).toBe('काहीतरी');
        expect(screen.queryByTestId('compare-reason-Practice')).toBeNull();
        expect(within(screen.getByTestId('compare-not-recognised')).queryAllByRole('button')).toHaveLength(0);
    });

    it('a hidden record is counted as done and never named: a withheld title reads "एक नोंद", the matched words are never drawn, nothing names it anywhere', () => {
        h.result = served(answerOf(a => {
            a.plots[0].ownWork[0].title = null;
            a.plots[0].ownWork[0].matchedWords = ['गुप्तनाव'];
            a.plots[0].notRecognised = [{ dailyLogId: 'log-9', workKey: 'x', day: 44, stageName: STAGE_NAME, title: null }];
        }));
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        expect(screen.getByTestId('compare-own-row-log-1:work:vine-tying').textContent).toContain('एक नोंद');
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
        expect(screen.getByTestId('compare-own-sheet').textContent).toContain('एक नोंद');
        expect(document.body.textContent).not.toContain('गुप्तनाव');
        expect(document.body.textContent).not.toContain('वेली बांधणी');
        expect(screen.getByTestId('compare-own-sheet').getAttribute('aria-label')).not.toContain('गुप्तनाव');
        expect(screen.getByTestId('compare-not-recognised-item').textContent).toBe('एक नोंद');
    });
});

describe('freshness and the states with no answer', () => {
    it('offline with a kept answer: the kept numbers and its time, said plainly; no "अपडेट: आत्ताच"', () => {
        h.result = served(answerOf(), 'cache');
        openPlot();
        expect(screen.getByTestId('compare-offline-strip').textContent).toMatch(/^इंटरनेट नाही · शेवटचं अपडेट: .+/);
        expect(screen.getByTestId('compare-offline-strip').textContent).toMatch(/[०-९]/); // the time the server gave, in Devanagari digits
        expect(screen.queryByTestId('compare-fresh')).toBeNull();
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('१');
    });

    it('offline with nothing kept: a plain line, nothing drawn', () => {
        h.result = { kind: 'offline' };
        openPlot();
        expect(screen.getByTestId('compare-offline-nothing').textContent).toBe('इंटरनेट नाही, आणि आधी आलेली माहितीही फोनवर नाही.');
        expect(screen.queryByTestId('compare-primary-card')).toBeNull();
    });

    it('refused (the server\'s 403/404) or unreadable: one plain line and NOTHING of any answer', () => {
        h.result = { kind: 'none' };
        openPlot();
        expect(screen.getByTestId('compare-refused').textContent).toBe('ही माहिती तुम्हाला सध्या दिसणार नाही.');
        expect(document.body.textContent).not.toContain('कृषी विद्यापीठ');
        expect(screen.queryByTestId('compare-primary-card')).toBeNull();
        expect(screen.queryByTestId('compare-stage-line')).toBeNull();
    });

    it('loading: a plain line, nothing else', () => {
        h.result = undefined;
        openPlot();
        expect(screen.getByTestId('compare-loading').textContent).toBe('माहिती येत आहे…');
    });

    it('a plot the answer does not hold: a plain line, no made-up numbers', () => {
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId('flow-crop-crop-pom'));
        expect(screen.getByTestId('compare-plot-missing')).toBeInTheDocument();
        expect(screen.getByTestId('compare-plot-missing').textContent).not.toMatch(ANY_DIGIT);
    });
});

describe('fix round 1: one number for "no record", everywhere (P002, P003) and a farm-less phone (P009)', () => {
    const only = (items: object[], totals: { asked: number; done: number; notYet: number; said: number }) => answerOf(a => {
        const c = own(a).stages[1] as { asked: number; done: number; notYet: number; saidNotDone: number; parts: { items: object[] }[] };
        c.asked = totals.asked; c.done = totals.done; c.notYet = totals.notYet; c.saidNotDone = totals.said; c.parts[0].items = items;
    });

    it('P002: a row with asked 3, done 0, said 1, notYet 3 shows the SAME grey number as the tile and the headline (2), labelled "no record"', () => {
        h.result = served(only([{ activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: 3, done: 0, notYet: 3, saidNotDone: 1, moreThanAsked: 0 }], { asked: 3, done: 0, notYet: 3, said: 1 }));
        openPlot();
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('२');
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        const badge = within(screen.getByTestId('compare-row-a-weed')).getByRole('img', { name: 'अजून नोंद नाही' });
        expect(badge.textContent).toBe('२');
    });

    it('P002: a row whose every open work was said not done shows that count with the said-not-done label', () => {
        h.result = served(only([{ activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: 2, done: 0, notYet: 2, saidNotDone: 2, moreThanAsked: 0 }], { asked: 2, done: 0, notYet: 2, said: 2 }));
        openPlot();
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        expect(within(screen.getByTestId('compare-row-a-weed')).getByRole('img', { name: 'नोंदीत: झालं नाही असं सांगितलं' }).textContent).toBe('२');
    });

    it('P003: a tile whose open works were all said not done (asked 2, done 0, said 2) does not say "अजून नोंद नाही"', () => {
        h.result = served(only([{ activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: 2, done: 0, notYet: 2, saidNotDone: 2, moreThanAsked: 0 }], { asked: 2, done: 0, notYet: 2, said: 2 }));
        openPlot();
        expect(screen.getByTestId('compare-tile-work-text').textContent).toBe('नोंदीत: झालं नाही असं सांगितलं');
    });

    it('P003: a tile with nothing said and nothing done still says "अजून नोंद नाही"', () => {
        h.result = served(only([{ activityId: 'a-weed', title: 'खुरपणी (गवत काढणे)', asked: 2, done: 0, notYet: 2, saidNotDone: 0, moreThanAsked: 0 }], { asked: 2, done: 0, notYet: 2, said: 0 }));
        openPlot();
        expect(screen.getByTestId('compare-tile-work-text').textContent).toBe('अजून नोंद नाही');
    });

    it('P009: no farm id on the phone is the plain refused line, never a loading line that never ends', () => {
        h.farm = null;
        h.result = undefined;
        openPlot();
        expect(screen.getByTestId('compare-refused')).toBeInTheDocument();
        expect(screen.queryByTestId('compare-loading')).toBeNull();
    });
});

describe('the "?" coach: three cards, shown once, skippable, the "?" brings it back', () => {
    it('first time: it opens by itself, "पुढे" steps, "वगळा" closes and keeps the seen flag', () => {
        h.seen = false;
        openPlot();
        expect(screen.getByTestId('compare-coach')).toBeInTheDocument();
        expect(screen.getByTestId('compare-coach-text').textContent).toBe('हिरवी खूण: शेड्यूलने सांगितलं तेवढं नोंदीत आलं.');
        fireEvent.click(screen.getByTestId('compare-coach-next'));
        expect(screen.getByTestId('compare-coach-text').textContent).toContain('राखाडी आकडा');
        fireEvent.click(screen.getByTestId('compare-coach-skip'));
        expect(screen.queryByTestId('compare-coach')).toBeNull();
        expect(h.setSeen).toHaveBeenCalledWith(true);
    });

    it('already seen: it does not open by itself; the "?" opens it, and the last card ends it', () => {
        openPlot();
        expect(screen.queryByTestId('compare-coach')).toBeNull();
        fireEvent.click(screen.getByTestId('compare-help'));
        fireEvent.click(screen.getByTestId('compare-coach-next'));
        fireEvent.click(screen.getByTestId('compare-coach-next'));
        expect(screen.getByTestId('compare-coach-text').textContent).toContain('शेड्यूलमध्ये नव्हतं, तुम्ही केलं');
        expect(screen.queryByTestId('compare-coach-skip')).toBeNull();
        fireEvent.click(screen.getByTestId('compare-coach-next'));
        expect(screen.queryByTestId('compare-coach')).toBeNull();
    });
});

/** Every view the screen has, opened one after another, so a scan sees every word the farmer can be shown. */
function everyViewText(): string {
    // what a farmer reads is the text AND the spoken names (aria-label / title / placeholder) of every mark
    const seeAll = () => [document.body.textContent ?? '', ...Array.from(document.body.querySelectorAll('[aria-label],[title],[placeholder]')).map(e => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''} ${e.getAttribute('placeholder') ?? ''}`)].join('\n');
    const parts: string[] = [seeAll()];
    const peek = () => parts.push(seeAll());
    for (const id of ['compare-tile-irrigation', 'compare-tile-work', 'compare-tile-nutrition', 'compare-tile-spray']) {
        fireEvent.click(screen.getByTestId(id)); peek();
        const row = document.querySelector('[data-testid^="compare-row-"]');
        if (row) { fireEvent.click(row); peek(); fireEvent.click(screen.getByTestId('compare-sheet-back')); }
        const ownRow = document.querySelector('[data-testid^="compare-own-row-"]');
        if (ownRow) { fireEvent.click(ownRow); peek(); fireEvent.click(screen.getByTestId('compare-sheet-back')); }
        fireEvent.click(screen.getByTestId('compare-sheet-close'));
    }
    fireEvent.click(screen.getByTestId('compare-other-sub-uni')); peek(); fireEvent.click(screen.getByTestId('compare-sheet-close'));
    fireEvent.click(screen.getByTestId('compare-help')); peek();
    fireEvent.click(screen.getByTestId('compare-coach-next')); peek();
    fireEvent.click(screen.getByTestId('compare-coach-next')); peek();
    fireEvent.click(screen.getByTestId('compare-coach-next'));
    ahead(); peek(); previous(); previous(); peek();
    return parts.join('\n');
}

describe('words: the plan\'s, in two colours, in one language', () => {
    // the plain line of v4 itself holds the words "काम झालं नाही" ("no record is not that the work was not done"): it is the one allowed use
    const stripAllowed = (t: string) => t.split('नोंद नाही, म्हणजे काम झालं नाही असं नाही.').join('').split('No record does not mean the work was not done.').join('');

    it('Marathi mode: no "राहिलं", no "काम झालं नाही", no amber / partial / "day changed" word, no English word, no Latin digit, on any view', () => {
        openPlot();
        const all = stripAllowed(everyViewText());
        expect(all).not.toMatch(/राहिलं|राहिली|काम झालं नाही|अर्धवट|दिवस बदलला|बदललेली|तपासायची/);
        expect(all).not.toMatch(/amber|partial|behind|late|missed|best/i);
        expect(all.replace(/[^A-Za-z]/g, '')).toBe('');
        // the one Latin digit run left is a fertiliser grade inside a work's name, as the schedule wrote it (a name, not a number the screen printed)
        expect(all.split('0:52:34').join('')).not.toMatch(/[0-9]/);
    });

    it('Marathi mode, the other states of the same plot (nothing recorded, said not done, more than asked, a passed stage with numbers): the same words only', () => {
        h.result = served(answerOf(a => {
            const p = a.plots[0];
            const c = own(a).stages[1] as { done: number; notYet: number; saidNotDone: number; parts: { items: { saidNotDone: number; moreThanAsked: number; done: number; notYet: number }[] }[] };
            c.done = 0; c.notYet = 3; c.saidNotDone = 1; c.parts[0].items[0].saidNotDone = 1; c.parts[0].items[0].moreThanAsked = 2; c.parts[0].items[0].done = 0; c.parts[0].items[0].notYet = 3;
            p.schedules.forEach(s => { s.stages[0] = JSON.parse(JSON.stringify(s.stages[1])); });
        }));
        openPlot();
        const all = stripAllowed(everyViewText());
        expect(all).not.toMatch(/राहिलं|राहिली|काम झालं नाही|अर्धवट|दिवस बदलला|बदललेली|तपासायची/);
        expect(all.replace(/[^A-Za-z]/g, '')).toBe('');
        expect(all.split('0:52:34').join('')).not.toMatch(/[0-9]/);
        expect(all).toContain('अजून नोंद नाही');
        expect(all).toContain('नोंदीत: झालं नाही असं सांगितलं');
        expect(all).toContain('शेड्यूलपेक्षा २ जास्त');
    });

    it('English mode (names as the server sent them, in English): no Devanagari at all, no amber / partial / "day changed" / blame word, on any view', () => {
        h.lang = 'en';
        h.result = served(answerOf(a => {
            const p = a.plots[0];
            p.stages[0].name = 'Early growth'; p.stages[1].name = 'Flowering to fruit set'; p.stages[2].name = 'Berry growth';
            p.ownWork[0].stageName = 'Flowering to fruit set'; p.ownWork[0].title = 'Vine tying';
            p.schedules[0].name = 'My grape schedule'; p.schedules[1].name = 'Agri university schedule'; p.schedules[2].name = 'Dr Patil schedule'; p.schedules[3].name = 'Flowering care schedule';
            const rename: Record<string, string> = { 'खुरपणी (गवत काढणे)': 'Weeding', 'ठिबक सिंचन': 'Drip irrigation', 'घड विरळणी': 'Bunch thinning', 'विद्राव्य खत 0:52:34 (ठिबकातून)': 'Soluble fertiliser', 'बुरशीनाशक फवारणी': 'Fungicide spray', 'जीए (संजीवक) बुडवणी': 'GA dip', 'पानांची तपासणी': 'Leaf check', 'कीटकनाशक फवारणी': 'Insecticide spray', 'बोरॉन फवारणी': 'Boron spray' };
            p.schedules.forEach(s => {
                const c = s.stages[1] as { parts: { items: { title: string }[] }[] };
                c.parts.forEach(pt => pt.items.forEach(i => { i.title = rename[i.title] ?? i.title; }));
                s.order.forEach(o => { o.firstTitle = rename[o.firstTitle] ?? o.firstTitle; o.thenTitle = rename[o.thenTitle] ?? o.thenTitle; });
            });
        }));
        const english = [{ id: CROP_ID, name: 'Grape', iconName: 'Grape', color: 'emerald', plots: [{ id: PLOT_ID, name: 'Sonaka' }, { id: 'plot-2', name: 'Plot 2' }] }] as never;
        render(<ComparePage crops={english} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
        const all = stripAllowed(everyViewText());
        expect(all.match(/[ऀ-ॿ]/g)).toBeNull();
        expect(all).not.toMatch(/amber|partial|day changed|behind|missed|\blate\b|\bfailed\b|not done\b(?!\.)/i);
        expect(all).toContain('My plan · Main');
    });

    it('English mode writes English digits and "M of N matched"; Marathi digits are only in Marathi mode', () => {
        h.lang = 'en';
        h.result = served(answerOf(a => { const p = a.plots[0]; p.schedules[1].name = 'Agri university schedule'; p.stages[1].name = 'Flowering'; p.ownWork[0].stageName = 'Flowering'; }));
        openPlot();
        expect(screen.getByTestId('compare-other-sub-uni').textContent).toContain('10 of 15 matched');
        expect(screen.getByTestId('compare-headline-number').textContent).toBe('1');
    });
});

describe('fix round 1: the selector and the coach keep the 14 px / 44 px rule and draw no amber (P010)', () => {
    const rules = (root: HTMLElement) => {
        for (const b of Array.from(root.querySelectorAll('button')).filter(x => !x.hasAttribute('aria-hidden'))) {
            expect(b.className, b.outerHTML.slice(0, 160)).toMatch(/min-h-\[(4[4-9]|[5-9]\d|\d{3})px\]/);
        }
        expect(root.innerHTML).not.toMatch(/text-\[(1[0-3]|[0-9])(\.\d+)?px\]|text-xs/);
        expect(root.innerHTML).not.toMatch(/amber|orange|rose-|red-/);
    };

    it('the plot step of the selector (a crop chosen, no plot yet): no 12 px label, no amber', () => {
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        expect(screen.getByTestId('flow-step-plot')).toBeInTheDocument();
        // no small LABEL is drawn: an element with a sub-14 px class may only hold an icon (no text). (The Sathi band's hint drops to 13 px only on a screen under 720 px tall, a media-query class of the shared band: not counted here, ledgered.)
        for (const e of Array.from(screen.getByTestId('compare-selector').querySelectorAll('[class]')).filter(x => /(^|\s)text-\[(1[0-3]|[0-9])(\.\d+)?px\]|(^|\s)text-xs/.test(x.getAttribute('class') ?? ''))) expect((e.textContent ?? '').trim()).toBe('');
        expect(screen.getByTestId('compare-selector').innerHTML).not.toMatch(/amber/);
        // the choices he taps (plot tiles, back) are 44 px or more; the crop chip is a 64-76 px card
        for (const id of [`flow-plot-${PLOT_ID}`, 'flow-plot-plot-2']) expect(screen.getByTestId(id).className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
    });

    it('the coach: every control is 44 px or more, no text under 14 px', () => {
        h.seen = false;
        openPlot();
        rules(screen.getByTestId('compare-coach'));
    });
});

describe('touch and type: every control >= 44 px, every text >= 14 px (the classes the screen sets)', () => {
    it('screen 2 and every sheet: each button has a min height of 44 px or more, and no text class below 14 px', () => {
        openPlot();
        const scan = () => {
            const root = document.body;
            const buttons = Array.from(root.querySelectorAll('button'));
            for (const b of buttons) expect(b.className, b.textContent ?? '').toMatch(/min-h-\[(4[4-9]|[5-9]\d|\d{3})px\]/);
            expect(root.innerHTML).not.toMatch(/text-\[(1[0-3]|[0-9])(\.\d+)?px\]|text-xs\b/);
        };
        scan();
        fireEvent.click(screen.getByTestId('compare-tile-work')); scan();
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying')); scan();
    });
});
