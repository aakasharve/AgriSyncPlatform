// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; LP-27, round 2) — the review form speaks his language
 * ONLY (founder 2026-10-26: Marathi mode Marathi, English mode English). It still opens for typed entries, the
 * हजेरी door, a parse not auto-saved, and "बदला" on a saved entry. Pinned here: no English letters reach a
 * Marathi user in the form's own chrome, and an English user keeps the English he had (nothing turned Marathi
 * under him), including the two pop-ups of the Save tap.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { lang } = vi.hoisted(() => ({ lang: { value: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k }),
}));
// The banner and the crop picture are other screens' parts; only this form's own words are under test.
vi.mock('../../../../../context/components/ContextBanner', () => ({ default: () => <div data-testid="context-banner" /> }));
vi.mock('../../../../../context/components/CropSelector', () => ({ CropSymbol: () => <span /> }));

import type { FarmContext, FarmerProfile, LogTimelineEntry } from '../../../../../../types';
import CostStrip from '../CostStrip';
import ManualEntryHeader from '../ManualEntryHeader';
import ActivityLedger from '../ActivityLedger';
import UnclearSegmentsList from '../UnclearSegmentsList';
import TranscriptTimeline from '../../../TranscriptTimeline';
import { reviewFormStrings } from '../../reviewFormStrings';

afterEach(() => { cleanup(); lang.value = 'mr'; });

const LATIN = /[A-Za-z]/;
const profile = { activeOperatorId: 'op1', operators: [{ id: 'op1', name: 'पुर्वेश' }] } as unknown as FarmerProfile;
const timeline: LogTimelineEntry[] = [1, 2, 3, 4].map(i => ({
    id: `t${i}`, logId: `L${i}`, timestamp: 'T', displayTime: '७:४५', contexts: [], rawTranscript: 'छाटणी केली', displayTranscript: 'छाटणी केली',
    source: i % 2 ? 'VOICE' : 'MANUAL', loggedItems: { activities: 1, observations: 1, irrigation: 1, labour: 2, expenses: 1 },
}) as unknown as LogTimelineEntry);

const header = (selectedLogId: string | null) => (
    <ManualEntryHeader context={{ selection: [] } as unknown as FarmContext} activeCrop={undefined} selectedPlotSummary="" currentCounts={{} as never}
        selectedPlotIds={['p1', 'p2']} selectedTargetGroups={[{ cropId: 'c1', cropName: 'द्राक्ष', color: 'bg-x', plotNames: ['सोनाका', 'थॉमसन'] }]}
        profile={profile} selectedLogId={selectedLogId} todayLogs={[]} transcriptEntries={timeline} onLogSelect={() => undefined}
        onCancelEdit={() => undefined} transcript="छाटणी केली" setTranscript={() => undefined} />
);
/**
 * Round 3 (I13-V2-M2): the ledger now holds a REAL activity card with its buckets filled, so the "no English"
 * check reads the card's own labels too (an empty ledger rendered no card and proved nothing about it).
 */
const filledLedger = {
    cropActivities: [{ id: 'act', title: 'Crop Activity', status: 'completed', workTypes: ['छाटणी'], sourceText: 'छाटणी केली', systemInterpretation: 'Pruning done' }],
    labourMap: { act: { id: 'lab', type: 'HIRED', count: 4, totalCost: 1600, sourceText: 'चार मजूर' } },
    irrigationMap: { act: { id: 'irr', method: 'Drip', source: 'Well', durationHours: 2 } },
    machineryMap: { act: { id: 'm', type: 'tractor', ownership: 'owned', hoursUsed: 1 } },
    inputMap: { act: [{ id: 'i', method: 'Spray', carrierType: 'Blower', carrierCount: 2, mix: [{ id: 'x', productName: 'गंधक', unit: 'ml/L' }] }] },
    expenses: [{ id: 'e', reason: 'डिझेल', totalAmount: 500, items: [], linkedActivityId: 'act' }],
    observations: [{ id: 'o', noteType: 'observation', textRaw: 'वाढ चांगली' }],
    plannedTasks: [{ id: 't', title: 'उद्या फवारणी' }],
};
const form = (selectedLogId: string | null, withCard = true) => (
    <>
        {header(selectedLogId)}
        <ActivityLedger {...({ selectedLogId, cropActivities: [], labourMap: {}, irrigationMap: {}, machineryMap: {}, inputMap: {}, expenses: [], observations: [], plannedTasks: [], crops: [], todayLogs: [], profile, ...(withCard ? filledLedger : {}) } as unknown as React.ComponentProps<typeof ActivityLedger>)} />
        <UnclearSegmentsList unclearSegments={[{ id: 's1', rawText: 'काहीतरी', reason: 'unknown', userMessage: 'नीट ऐकू आलं नाही', userMessageEn: 'Could not hear this' } as never]}
            correctionId="s1" correctionText="" setCorrectionText={() => undefined} onDismiss={() => undefined} onManualEdit={() => undefined} onSubmitCorrection={() => undefined} />
        <CostStrip selectedLogId={selectedLogId} manualTotalCost={undefined} setManualTotalCost={() => undefined} onSaveDay={() => undefined} />
    </>
);
/** Every text the form shows, placeholders included (the farmer reads those too). */
const shownText = (root: HTMLElement) => `${root.textContent} ${[...root.querySelectorAll('input,textarea')].map(i => (i as HTMLInputElement).placeholder).join(' ')}`;

describe('the review form in Marathi', () => {
    it('has no English letters in its own words — new entry and fix alike, with its activity card and without', () => {
        for (const id of [null, 'L1']) {
            for (const withCard of [true, false]) {
                const { container } = render(form(id, withCard));
                expect([id, withCard, shownText(container)]).toEqual([id, withCard, expect.not.stringMatching(LATIN)]);
                cleanup();
            }
        }
    });

    it("the activity card inside it is really there, in the founder's ring words", () => {
        const { container } = render(form(null));
        expect(container.textContent).toContain('झालेली कामे');
        expect(container.textContent).toContain('पाणी / सिंचन');
        expect(container.textContent).toContain('तुम्ही म्हणालात:');
        expect(container.textContent).not.toContain('Pruning done'); // the parser's English explanation stays out
    });

    it('uses the approved words: "एकूण खर्च", "जतन करा", "रद्द करा"; and no doubled Marathi/English line', () => {
        const { container } = render(form('L1'));
        expect(screen.getByTestId('manual-total-label').textContent).toBe('एकूण खर्च');
        expect(screen.getByTestId('manual-save-button').textContent).toBe('जतन करा');
        expect(container.textContent).toContain('रद्द करा');
        expect(screen.getByTestId('manual-logging-as').textContent).toBe('कोणी: पुर्वेश');
        expect(container.textContent).not.toContain('Could not hear this');
    });

    it('the timeline counts rows as rows, never as people or rupees', () => {
        render(<TranscriptTimeline entries={timeline} maxDisplay={3} />);
        expect(document.body.textContent).toContain('मजूर · 2');
        expect(document.body.textContent).not.toContain('₹ 1');
        expect(document.body.textContent).toContain('आणखी 1');
    });
});

describe('the review form in English (an English user keeps English)', () => {
    it('shows the form\'s English exactly as it was', () => {
        lang.value = 'en';
        const { container } = render(form(null, false));
        expect(screen.getByTestId('manual-total-label').textContent).toBe('Total Paid');
        expect(screen.getByTestId('manual-save-button').textContent).toBe('Save Entry');
        expect(container.textContent).toContain('No activities logged today');
        expect(container.textContent).toContain('Review Save Target');
        expect(container.textContent).toContain('Could not hear this');
        cleanup();
        render(form('L1'));
        expect(screen.getByTestId('manual-save-button').textContent).toBe('Update Log');
        expect(document.body.textContent).toContain('Cancel Edit');
        // ...and the activity card inside it keeps its English too.
        expect(document.body.textContent).toContain('Work Done');
        expect(document.body.textContent).toContain('Labour & Wages');
        expect(document.body.textContent).toContain('Pruning done');
    });

    it('the Save tap\'s two pop-ups follow the language too', () => {
        expect(reviewFormStrings('en').negativeCost).toBe('❌ Negative costs are not allowed. Please check your entries.');
        expect(reviewFormStrings('mr').negativeCost).not.toMatch(LATIN);
        expect(reviewFormStrings('mr').costWithoutWork).not.toMatch(LATIN);
        expect(reviewFormStrings('mr').noSelection).not.toMatch(LATIN);
        expect(reviewFormStrings('mr').plotsAcrossCrops(3, 2)).toBe('2 पिकांमध्ये 3 प्लॉट');
    });
});
