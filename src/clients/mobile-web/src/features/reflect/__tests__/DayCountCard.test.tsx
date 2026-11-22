// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder pick D-172 = B, 2026-11-22: "one sentence for the day, plus the
 * two buttons that exist today")
 *
 * The card above शेताची स्थिती: "आज १४ पैकी ७ सांगितले", a thin bar under it (decoration; the sentence says it), then the buttons in the order
 * of need: "सगळे निवडले", "आज बाकी", "आज सांगितलेले". No problem button (that is the BIGGER fork the founder did not pick). The row left the
 * picker, so there is no second copy of it. Drawn from 7 plots in view, and the two "today" buttons only while the page is on today.
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DayCountCard } from '../overview/DayCountCard';
import { FarmStatus } from '../overview/FarmStatus';
import { selectAll, type ReflectSelection } from '../overview/reflectSelection';
import { crop, plot } from './reflectFixtures';

afterEach(cleanup);

/** The founder's pilot farm shape: 14 plots, 4 crops, and no single crop with 7 plots. */
const GRAPES = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 6 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
const POMEGRANATE = crop('pom', 'डाळिंब', 'Pomegranate', 'bg-red-500', Array.from({ length: 4 }, (_, i) => plot(`p${i + 1}`, `डाळिंब P${i + 1}`)));
const CANE = crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', [plot('s1', 'ऊस S1'), plot('s2', 'ऊस S2')]);
const ONION = crop('onion', 'कांदा', 'Onion', 'bg-amber-500', [plot('o1', 'कांदा O1'), plot('o2', 'कांदा O2')]);
const FARM = [GRAPES, POMEGRANATE, CANE, ONION];
const ALL_IDS = FARM.flatMap(c => c.plots.map(p => p.id));
const told = (ids: string[]) => new Set(ids);

const Harness: React.FC<{ crops?: typeof FARM; told?: ReadonlySet<string> | null; start?: ReflectSelection; onSel?: (s: ReflectSelection) => void; language?: 'mr' | 'en' }> = ({ crops = FARM, told: toldIds, start, onSel, language }) => {
    const [sel, setSel] = useState<ReflectSelection>(() => start ?? selectAll(crops));
    return <DayCountCard crops={crops} sel={sel} onSel={s => { setSel(s); onSel?.(s); }} toldTodayPlotIds={toldIds} language={language} />;
};
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');

describe('the day in one sentence', () => {
    it('says how many plots were told today out of the plots in view, in Devanagari digits, with a bar under it', () => {
        render(<Harness told={told(ALL_IDS.slice(0, 7))} />);
        expect(screen.getByTestId('day-count-card')).toBeTruthy();
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १४ पैकी ७ सांगितले');
        const bar = screen.getByTestId('day-count-bar');
        expect(bar.getAttribute('aria-hidden')).toBe('true'); // decoration: the sentence says it
        expect(bar.getAttribute('data-percent')).toBe('50');
    });

    it('the sentence is 20 px in the dark ink, so it reads in sunlight', () => {
        render(<Harness told={told(['g1'])} />);
        const cls = screen.getByTestId('day-count-sentence').className;
        expect(cls).toContain('text-[20px]');
        expect(cls).toContain('text-stone-900');
    });

    it('a zero is said: nothing told yet reads "आज १४ पैकी ० सांगितले" (a true count, not a hidden one)', () => {
        render(<Harness told={told([])} />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १४ पैकी ० सांगितले');
        expect(screen.getByTestId('day-count-bar').getAttribute('data-percent')).toBe('0');
    });

    it('counts only plots that are in the crop view; a plot id the farm does not hold is not counted', () => {
        render(<Harness told={told([...ALL_IDS.slice(0, 3), 'ghost-plot'])} />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १४ पैकी ३ सांगितले');
    });

    it('the English twin says the same thing in Latin digits', () => {
        render(<Harness told={told(ALL_IDS.slice(0, 7))} language="en" />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('Today: 7 of 14 told');
    });
});

describe('the numbers count the crop he chose, never the narrowed set', () => {
    it('narrowing the page to one plot does not change the sentence (it does not flicker as he taps)', () => {
        render(<Harness told={told(ALL_IDS.slice(0, 7))} start={{ crop: 'all', plotIds: ['g1'] }} />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १४ पैकी ७ सांगितले');
    });

    it('picking one crop counts that crop only: 8 grape plots of 10, 3 of them told', () => {
        const grapes8 = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 8 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
        const farm = [grapes8, CANE];
        const toldIds = told(['g1', 'g2', 'g3', 's1']);
        const { unmount } = render(<Harness crops={farm} told={toldIds} />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १० पैकी ४ सांगितले'); // every crop first
        unmount();
        render(<Harness crops={farm} told={toldIds} start={{ crop: 'grape', plotIds: grapes8.plots.map(p => p.id) }} />);
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज ८ पैकी ३ सांगितले');
    });
});

describe('when the card is drawn', () => {
    it('not for 6 plots: a small farm gets no card', () => {
        const small = [GRAPES];
        render(<Harness crops={small} told={told(['g1'])} />);
        expect(screen.queryByTestId('day-count-card')).toBeNull();
        expect(screen.queryByTestId('farm-plots-all')).toBeNull();
    });

    it('from 7 plots in view even when no single crop holds 7 (the founder\'s pilot farm: 14 plots over 4 crops)', () => {
        render(<Harness told={told(['g1'])} />);
        expect(screen.getByTestId('day-count-card')).toBeTruthy();
    });

    it('on any day but today (no facts given) there is no sentence, no bar and no "today" button, but "सगळे निवडले" is still there, as it was in the picker', () => {
        render(<Harness told={null} />);
        expect(screen.queryByTestId('day-count-sentence')).toBeNull();
        expect(screen.queryByTestId('day-count-bar')).toBeNull();
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.queryByTestId('farm-quick-todayLeft')).toBeNull();
        expect(screen.getByTestId('farm-plots-all')).toHaveTextContent('सगळे निवडले');
        expect(document.body.textContent).not.toMatch(/आज/);
    });
});

describe('the buttons: the two that exist today, in the order of need, and nothing else', () => {
    it('"सगळे निवडले", then "आज बाकी", then "आज सांगितलेले", each with its true count', () => {
        render(<Harness told={told(ALL_IDS.slice(0, 5))} />);
        const row = screen.getByTestId('plot-quick-row');
        const order = [...row.querySelectorAll('button')].map(b => b.textContent?.trim());
        expect(order).toEqual(['सगळे निवडले', 'आज बाकी ९', 'आज सांगितलेले ५']);
    });

    it('there is no problem button and no word "अडचण" on the card (D-172 = B: no new fact is worked out)', () => {
        render(<Harness told={told(ALL_IDS.slice(0, 5))} />);
        expect(screen.queryByTestId('farm-quick-problem')).toBeNull();
        expect(screen.getByTestId('day-count-card').textContent).not.toContain('अडचण');
    });

    it('a tap on "आज बाकी" picks exactly the untold plots, and that button reads as pressed', () => {
        const onSel = vi.fn();
        render(<Harness told={told(ALL_IDS.slice(0, 5))} onSel={onSel} />);
        fireEvent.click(screen.getByTestId('farm-quick-todayLeft'));
        expect(onSel).toHaveBeenLastCalledWith({ crop: 'all', plotIds: ALL_IDS.slice(5) });
        expect(pressed('farm-quick-todayLeft')).toBe('true');
        expect(pressed('farm-quick-toldToday')).toBe('false');
    });

    it('a tap on "आज सांगितलेले" picks exactly the told plots', () => {
        const onSel = vi.fn();
        render(<Harness told={told(ALL_IDS.slice(0, 5))} onSel={onSel} />);
        fireEvent.click(screen.getByTestId('farm-quick-toldToday'));
        expect(onSel).toHaveBeenLastCalledWith({ crop: 'all', plotIds: ALL_IDS.slice(0, 5) });
    });

    it('with every plot chosen "सगळे निवडले" reads as done and does nothing (the page is never empty)', () => {
        const onSel = vi.fn();
        render(<Harness told={told(['g1'])} onSel={onSel} />);
        fireEvent.click(screen.getByTestId('farm-plots-all'));
        expect(onSel).not.toHaveBeenCalled();
    });

    it('a button whose count is ० is not drawn (all told: no "आज बाकी"; none told: no "आज सांगितलेले"), the sentence still says it', () => {
        const { unmount } = render(<Harness told={told(ALL_IDS)} />);
        expect(screen.getByTestId('farm-quick-toldToday')).toHaveTextContent('आज सांगितलेले १४');
        expect(screen.queryByTestId('farm-quick-todayLeft')).toBeNull();
        expect(screen.getByTestId('day-count-sentence')).toHaveTextContent('आज १४ पैकी १४ सांगितले');
        unmount();
        render(<Harness told={told([])} />);
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.getByTestId('farm-quick-todayLeft')).toHaveTextContent('आज बाकी १४');
    });
});

describe('the row left the picker (no second copy)', () => {
    it('शेताची स्थिती no longer draws the quick row, whatever the farm size', () => {
        const big = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 15 }, (_, i) => plot(`b${i + 1}`, `द्राक्ष G${i + 1}`)));
        render(<FarmStatus crops={[big]} sel={selectAll([big])} onSel={() => undefined} />);
        expect(screen.queryByTestId('plot-quick-row')).toBeNull();
        expect(screen.queryByTestId('farm-plots-all')).toBeNull();
        expect(screen.queryByTestId('farm-quick-toldToday')).toBeNull();
        expect(screen.queryByTestId('farm-quick-todayLeft')).toBeNull();
    });
});
