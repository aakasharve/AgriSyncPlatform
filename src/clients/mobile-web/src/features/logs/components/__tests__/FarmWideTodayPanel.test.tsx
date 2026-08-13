/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 *
 * FarmWideTodayPanel — the two properties that are easy to break and expensive
 * to notice.
 *
 * 1. IT MUST RENDER NOTHING WHEN THERE IS NOTHING. This panel sits on the
 *    capture path, and an empty state that exists only to be filled is a nag
 *    (`P9`). "Show a friendly zero" is the single most likely well-meant
 *    regression here.
 * 2. THE EYEBROW IS `stone-500`. At `stone-400` it measures 2.52:1 — below AA —
 *    and diverges from the "Stored In" eyebrow it deliberately mirrors. The
 *    viewport token was minted against `stone-500`, so shipping `stone-400`
 *    would put the code outside what was actually verified.
 *
 * Also pinned: the money is shown WHOLE, at the scope the farmer asserted, and
 * is never divided by anything (`O-2`).
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { t as translate, type Language } from '../../../../i18n/translations';

const langRef = { current: 'mr' as Language };

// The real `useLanguage` throws outside `<LanguageProvider>` and `render` mounts
// none. `t` resolves through the REAL pure `t(key, language)`, so these tests
// assert the shipped strings rather than a key.
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: langRef.current,
        setLanguage: (next: Language) => { langRef.current = next; },
        t: (key: string) => translate(key, langRef.current),
    }),
}));

import FarmWideTodayPanel from '../FarmWideTodayPanel';
import type { FarmWideDaySummary } from '../../../../app/helpers/appContentDailyCounts';

const summary = (over: Partial<FarmWideDaySummary> = {}): FarmWideDaySummary => ({
    recordCount: 1,
    counts: {
        cropActivities: 0, irrigation: 0, labour: 0, inputs: 0, machinery: 0,
        activityExpenses: 0, observations: 0, reminders: 0, disturbance: 0, harvest: 0,
    },
    statedSpend: 0,
    ...over,
});

afterEach(() => {
    cleanup();
    langRef.current = 'mr';
});

describe('it says nothing when there is nothing to say', () => {
    it('renders NOTHING for a day with no farm-wide record', () => {
        // Not an empty state, not a zero row, not "no whole-farm work today".
        // The farmer is mid-capture; an emptiness that exists only to be filled
        // is a nag (`P9`).
        const { container } = render(<FarmWideTodayPanel summary={summary({ recordCount: 0 })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders once a record exists, even with no money on it', () => {
        render(<FarmWideTodayPanel summary={summary({ recordCount: 1 })} />);
        expect(screen.getByTestId('farm-wide-today-panel')).toBeInTheDocument();
    });
});

describe('the eyebrow', () => {
    it('is stone-500, the AA-passing tone the "Stored In" eyebrow already uses', () => {
        // stone-400 measured 2.52:1. This is the class the viewport token was
        // minted against; changing it puts the code outside what was verified.
        render(<FarmWideTodayPanel summary={summary()} />);
        const eyebrow = screen.getByText('Entire Farm');
        expect(eyebrow.className).toContain('text-stone-500');
        expect(eyebrow.className).not.toContain('text-stone-400');
    });

    it('uses the app\'s own shipped label for this scope', () => {
        // `Entire Farm` is what CropSelector, LogFactory.FARM_GLOBAL_NAME and
        // appContentContextDisplay already show. `संपूर्ण शेत` exists only in
        // code comments and has never reached a farmer, so inventing it here
        // would be an agent minting farmer-facing Marathi.
        render(<FarmWideTodayPanel summary={summary()} />);
        expect(screen.getByText('Entire Farm')).toBeInTheDocument();
    });
});

describe('the numbers', () => {
    /**
     * THESE TWO RUN IN `en`, AND THAT IS A FINDING, NOT A CONVENIENCE.
     *
     * The founder ruled on `dfes.todaySummary` on 2026-08-13 and replaced
     * `'आज: {activities} कामं, Rs. {cost} खर्च.'` with `'आजची कामे आणि त्याचा
     * खर्च'` — a heading, carrying no placeholders. `tf` therefore has nothing
     * to substitute in Marathi, so the activity count and the stated spend
     * reach the eye only in English. The properties below (`O-2` money whole;
     * activities counted once) are still worth pinning and are pinned where
     * they are still observable.
     *
     * This is the founder's copy decision with a visible consequence, raised
     * for him rather than worked around: the fix, if he wants the figures back
     * in Marathi, is his wording or a component change — never an agent
     * re-writing his Marathi to put the placeholders back.
     */
    it('shows the stated spend WHOLE, divided by nothing', () => {
        // `O-2`: a per-plot share of a farm-wide amount would invent an
        // allocation the farmer never gave.
        langRef.current = 'en';
        render(<FarmWideTodayPanel summary={summary({ statedSpend: 2400 })} />);
        expect(screen.getByTestId('farm-wide-today-panel')).toHaveTextContent('2,400');
    });

    it('shows no figure — and no dangling placeholder — in Marathi', () => {
        // The other half of the ruling above, stated out loud so it cannot be
        // "fixed" by accident. A `{cost}` left standing on screen would be the
        // other failure mode of a rewrite that drops a placeholder; `tf` only
        // substitutes what the template names, so nothing is left behind.
        render(<FarmWideTodayPanel summary={summary({ statedSpend: 2400 })} />);
        const panel = screen.getByTestId('farm-wide-today-panel');
        expect(panel).toHaveTextContent('आजची कामे आणि त्याचा खर्च');
        expect(panel).not.toHaveTextContent('2,400');
        expect(panel.textContent).not.toContain('{');
    });

    it('reports the record count as given, never a per-plot multiple', () => {
        render(<FarmWideTodayPanel summary={summary({ recordCount: 2 })} />);
        expect(screen.getByTestId('farm-wide-record-count')).toHaveTextContent('2');
    });

    it('counts activities across buckets, once each', () => {
        langRef.current = 'en';
        render(<FarmWideTodayPanel summary={summary({
            counts: {
                cropActivities: 1, irrigation: 2, labour: 3, inputs: 0, machinery: 1,
                activityExpenses: 0, observations: 9, reminders: 9, disturbance: 0, harvest: 0,
            },
        })} />);
        // 1 + 2 + 3 + 0 + 1 = 7. Observations and reminders are NOTES, not work,
        // and are excluded so the figure matches the chips listed beneath it.
        expect(screen.getByTestId('farm-wide-today-panel')).toHaveTextContent('7');
    });

    it('lists only the buckets that carry something', () => {
        render(<FarmWideTodayPanel summary={summary({
            counts: {
                cropActivities: 0, irrigation: 0, labour: 3, inputs: 0, machinery: 0,
                activityExpenses: 0, observations: 0, reminders: 0, disturbance: 0, harvest: 0,
            },
        })} />);
        const panel = screen.getByTestId('farm-wide-today-panel');
        expect(panel).toHaveTextContent('Labour ×3');
        expect(panel).not.toHaveTextContent('Irrigation');
        expect(panel).not.toHaveTextContent('Machinery');
    });
});

describe('language', () => {
    it('follows the farmer preference rather than hardcoding one script', () => {
        langRef.current = 'en';
        render(<FarmWideTodayPanel summary={summary({ statedSpend: 100 })} />);
        // `dfes.todaySummary`, already approved in both languages.
        expect(screen.getByTestId('farm-wide-today-panel')).toHaveTextContent('Today:');
    });
});
