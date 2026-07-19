// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ANTI-FABRICATION GUARDRAIL — LabourReview render coverage
 * (spec: dfes-companion-2026-07-11).
 *
 * This is the exact surface where the founder-caught fabrication bug
 * originally showed up: a labour item's `sourceText` concatenated a real
 * (paraphrased) phrase with an invented one. `provenanceVerified: false`
 * on a labour entry must render a gentle "please check this" flag; a
 * verified entry, an entry with the key absent, and a genuinely
 * manual/typed entry (which never carries this AI-only field) must not.
 */
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import LabourReview from '../LabourReview';
import { LabourEvent } from '../../../../../../types';

afterEach(cleanup);

function makeEntry(overrides: Partial<LabourEvent>): LabourEvent {
    return {
        id: 'lab_1',
        type: 'HIRED',
        count: 2,
        activity: 'Weeding',
        ...overrides,
    } as LabourEvent;
}

describe('LabourReview — provenanceVerified flag', () => {
    it('renders the unverified flag for an AI item that failed provenance verification', () => {
        const entry = makeEntry({ sourceText: 'त्यांनी बाग छाटून घेतली', provenanceVerified: false });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={2} />);
        expect(screen.getByTestId('provenance-unverified-flag')).toBeInTheDocument();
        expect(screen.getByText('हे मी नक्की ऐकलं नाही — बरोबर आहे का?')).toBeInTheDocument();
        // The transcript quote is still shown to the farmer, never hidden.
        expect(screen.getByText('"त्यांनी बाग छाटून घेतली"')).toBeInTheDocument();
    });

    it('does NOT render the flag for a verified AI item (provenanceVerified: true)', () => {
        const entry = makeEntry({ sourceText: 'दोन मजूर तण काढत होते', provenanceVerified: true });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={2} />);
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });

    it('does NOT render the flag when provenanceVerified is absent (pre-existing / post-normalization data)', () => {
        const entry = makeEntry({ sourceText: 'दोन मजूर तण काढत होते' });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={2} />);
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });

    it('never shows the flag on a genuinely manual/typed labour entry (no AI provenance field at all)', () => {
        // A manually-typed entry has no sourceText/provenanceVerified — it
        // never goes through the AI normalizer that stamps this field.
        const manualEntry = makeEntry({});
        render(<LabourReview labourEntries={[manualEntry]} totalWorkerCount={2} />);
        expect(screen.queryByTestId('provenance-unverified-flag')).not.toBeInTheDocument();
    });
});
