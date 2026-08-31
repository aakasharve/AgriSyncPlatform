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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { t as translate } from '../../../../../../i18n/translations';
import LabourReview from '../LabourReview';
import { LabourEvent } from '../../../../../../types';

// Task 21 (Labour V2 R1) — this file's app default is 'mr' (LanguageProvider's
// own fallback), mocked the same way `DailySummaryCard.closeToday.test.tsx`
// mocks it: a real `translate()` lookup against the real table, not an echo,
// so a regression that re-points a key silently would fail here too.
vi.mock('../../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr',
        setLanguage: () => {},
        t: (key: string) => translate(key, 'mr'),
    }),
}));

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

/**
 * Task 21 (Labour V2 R1) — this is the panel that shows the farmer what the
 * app UNDERSTOOD before he saves. It was rendering "Total workers: 1" and
 * "2 workers" in English, unreadable to a low-literacy Marathi farmer. These
 * two pins are the ones with an already-shipped, founder-approved Marathi
 * equivalent (`workSummary.labour` — reused as-is in `QuickLogSheet.tsx` and
 * `ReviewInboxSheet.tsx`; the "{N} मजूर" convention — reused as-is from
 * `LabourHub.tsx`). The eyebrow header ("Labour Review") and the "Total
 * workers: N (breakdown)" summary line have NO existing equivalent and are
 * intentionally left in English pending a founder ruling — see the task
 * report; this file must not gain invented Marathi for them.
 */
describe('LabourReview — Marathi copy (reuse only, no invented strings)', () => {
    it('falls back to the already-shipped `workSummary.labour` chip label, never the English word "Labour", when the entry carries no activity name', () => {
        const entry = makeEntry({ activity: undefined });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={2} />);
        expect(screen.queryByText('Labour')).not.toBeInTheDocument();
        expect(screen.getByText(translate('workSummary.labour', 'mr'))).toBeInTheDocument();
    });

    it('renders the per-entry worker count as Devanagari digits + "मजूर" (LabourHub\'s own "{N} मजूर" convention via toMarathiNumber), never Latin digits + "workers"', () => {
        const entry = makeEntry({ count: 2, activity: 'तण काढणी' });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={2} />);
        expect(screen.queryByText('2 workers')).not.toBeInTheDocument();
        expect(screen.getByText('२ मजूर')).toBeInTheDocument();
    });
});

/**
 * Task 27 (spec: 2026-08-28-labour-v2-release-1) — this is the pre-save
 * panel a farmer sees before his day is recorded. `entry.count` is optional
 * (both `LabourEvent` and the Zod schema) — a farmer who says "मजुरांनी
 * छाटणी केली" ("the workers did the pruning") without a headcount left it
 * unstated. The old `entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))`
 * coerced that silence into a fabricated "० मजूर" (zero workers). Governing
 * rule: absence of any record means unknown (em-dash); a record that exists
 * containing nothing (a genuinely stated 0) is a real zero and must still
 * render as one — mirrors the server's `LabourHeadcount.Resolve`
 * (ShramSafal.Domain/Farms/LabourHeadcount.cs) and the client's own
 * `ReviewFacts` (ReviewSheet.tsx: `count != null ? toMr(count) : '—'`).
 */
describe('LabourReview — unstated headcount is unknown, not a fabricated 0 (Task 27, spec: 2026-08-28-labour-v2-release-1)', () => {
    it('renders an em-dash, never "० मजूर", when count/maleCount/femaleCount are ALL unstated', () => {
        const entry = makeEntry({ count: undefined, maleCount: undefined, femaleCount: undefined, activity: 'छाटणी' });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={0} />);
        expect(screen.queryByText('० मजूर')).not.toBeInTheDocument();
        expect(screen.getByText('— मजूर')).toBeInTheDocument();
    });

    it('still renders a genuinely stated 0 as "० मजूर" — a real fact, not collapsed into the em-dash', () => {
        const entry = makeEntry({ count: 0, maleCount: undefined, femaleCount: undefined, activity: 'छाटणी' });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={0} />);
        expect(screen.getByText('० मजूर')).toBeInTheDocument();
        expect(screen.queryByText('— मजूर')).not.toBeInTheDocument();
    });

    it('sums a stated gender split when the bare count is unstated (no em-dash when SOME evidence exists)', () => {
        const entry = makeEntry({ count: undefined, maleCount: 2, femaleCount: 1, activity: 'छाटणी' });
        render(<LabourReview labourEntries={[entry]} totalWorkerCount={3} />);
        expect(screen.getByText('३ मजूर')).toBeInTheDocument();
    });
});
