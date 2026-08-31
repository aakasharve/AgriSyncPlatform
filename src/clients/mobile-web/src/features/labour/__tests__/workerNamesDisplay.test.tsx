// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER RULING 2026-08-31 — "look at uploaded image no names were there.
 * names marked here means attendance + identity recorded."
 *
 * He spoke four names, and both screens showed "४ मजूर" and nothing else. A
 * count is a headcount; the NAMES are what make it हजेरी. These pin that the
 * names reach the screen and that an unnamed crew still renders honestly.
 *
 * Revert-proof: remove either names block and the first test of each pair
 * fails.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LabourReview from '../../logs/components/manual-entry/components/LabourReview';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => { }, t: (k: string) => k }),
}));

const NAMES = ['चंदू रोकडे', 'संतू रोकडे', 'विलास जाधव', 'हमु जाधव'];

const entry = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    type: 'HIRED',
    count: 4,
    workerNames: NAMES,
    ...over,
} as never);

afterEach(() => cleanup());

describe('LabourReview — the names are the हजेरी', () => {
    it('lists every name the farmer spoke', () => {
        render(<LabourReview labourEntries={[entry()]} totalWorkerCount={4} />);
        const block = screen.getByTestId('labour-review-worker-names');
        NAMES.forEach((n) => expect(block).toHaveTextContent(n));
    });

    // Exactly as spoken. A farmer confirming a record has to recognise his own
    // words; normalising them is how a name quietly becomes someone else's.
    it('renders each name verbatim, in the order spoken', () => {
        render(<LabourReview labourEntries={[entry()]} totalWorkerCount={4} />);
        const rendered = Array.from(
            screen.getByTestId('labour-review-worker-names').children,
        ).map((el) => el.textContent);
        expect(rendered).toEqual(NAMES);
    });

    // P9 — nobody named is a COMPLETE record, not a gap. An empty names row
    // would be a slot inviting an identity to be invented.
    it('renders no names block at all when nobody was named', () => {
        render(<LabourReview labourEntries={[entry({ workerNames: undefined })]} totalWorkerCount={4} />);
        expect(screen.queryByTestId('labour-review-worker-names')).toBeNull();
    });

    // Names are never a headcount: two named among eight is eight who worked.
    it('does not let the name count overwrite the stated headcount', () => {
        render(
            <LabourReview
                labourEntries={[entry({ count: 8, workerNames: ['रमेश', 'सीता'] })]}
                totalWorkerCount={8}
            />,
        );
        expect(screen.getByTestId('labour-review-worker-names').children).toHaveLength(2);
        expect(screen.getByText(/८ मजूर/)).toBeInTheDocument();
    });
});
