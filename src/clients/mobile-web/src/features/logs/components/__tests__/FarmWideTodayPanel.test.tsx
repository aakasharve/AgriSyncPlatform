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
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

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
        const eyebrow = screen.getByText(oversightTranslations.mr.entireFarmLabel);
        expect(eyebrow.className).toContain('text-stone-500');
        expect(eyebrow.className).not.toContain('text-stone-400');
    });

    it('uses the founder-approved label for this scope (Task 14, change 4)', () => {
        // The founder has now approved `संपूर्ण शेत`
        // (`oversightTranslations.entireFarmLabel`, his own reference-image
        // table) — superseding the earlier "Entire Farm" borrowed-English
        // copy this test used to pin. Read through `resolveOversightString`,
        // same as every other founder-approved string in this feature.
        render(<FarmWideTodayPanel summary={summary()} />);
        expect(screen.getByText(oversightTranslations.mr.entireFarmLabel)).toBeInTheDocument();
        expect(screen.queryByText('Entire Farm')).not.toBeInTheDocument();
    });

    it('follows the farmer preference into English too', () => {
        langRef.current = 'en';
        render(<FarmWideTodayPanel summary={summary()} />);
        expect(screen.getByText(oversightTranslations.en.entireFarmLabel)).toBeInTheDocument();
    });
});

describe('the numbers', () => {
    /**
     * THE FIGURES REACH BOTH LANGUAGES, AND THAT IS THE POINT OF THE PAIR.
     *
     * `dfes.todaySummary` briefly lost its placeholders: the founder's first
     * rewrite was a heading, `'आजची कामे आणि त्याचा खर्च'`, so `tf` had nothing
     * to substitute and a Marathi farmer saw no count and no rupee figure. He
     * reversed that on review — the approved string is
     * `'आजची {activities} कामे, खर्च रु. {cost}'` — so the numbers are back.
     *
     * The tests below were briefly forced into `en` by that gap and are back in
     * Marathi with it closed. The `both languages` case exists so the gap
     * cannot reopen unnoticed: an `mr` string that stops naming a placeholder
     * silently drops a number the farmer is owed, which is the failure a
     * shape-only check cannot see (`P4`).
     */
    it('shows the stated spend WHOLE, divided by nothing', () => {
        // `O-2`: a per-plot share of a farm-wide amount would invent an
        // allocation the farmer never gave.
        render(<FarmWideTodayPanel summary={summary({ statedSpend: 2400 })} />);
        expect(screen.getByTestId('farm-wide-today-panel')).toHaveTextContent('2,400');
    });

    it('shows the count and the spend in BOTH languages, with nothing dangling', () => {
        for (const language of ['mr', 'en'] as const) {
            langRef.current = language;
            const { unmount } = render(<FarmWideTodayPanel summary={summary({
                statedSpend: 2400,
                counts: {
                    cropActivities: 1, irrigation: 2, labour: 3, inputs: 0, machinery: 1,
                    activityExpenses: 0, observations: 0, reminders: 0, disturbance: 0, harvest: 0,
                },
            })} />);
            const panel = screen.getByTestId('farm-wide-today-panel');
            expect(panel, language).toHaveTextContent('2,400');
            expect(panel, language).toHaveTextContent('7');
            // An unfilled `{cost}` on screen is the other way a placeholder
            // edit goes wrong: `tf` leaves unknown names STANDING rather than
            // blanking them, so a typo in a key renders braces at a farmer.
            expect(panel.textContent, language).not.toContain('{');
            unmount();
        }
    });

    it('reports the record count as given, never a per-plot multiple', () => {
        render(<FarmWideTodayPanel summary={summary({ recordCount: 2 })} />);
        expect(screen.getByTestId('farm-wide-record-count')).toHaveTextContent('2');
    });

    it('counts activities across buckets, once each', () => {
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
