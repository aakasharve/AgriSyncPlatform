// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S3, S5–S8, S10–S12, S15)
 *
 * The real SchedulerPage (route 'schedule', the raised bottom-bar button) mounted over a real-shaped server
 * schedule and real-shaped logs. Pins what the farmer reads — Marathi, the computed numbers, the schedule's
 * own task names. The kept features of the old page are pinned in SchedulerPage.keptFeatures.test.tsx.
 * Mocked: only what needs a phone database, the server or the money store (this phone's clip list, the voice
 * player, the voice-keeping answer, MoneyLens, the spend total).
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({
    usePlotClips: () => new Map([['2026-10-17', [
        { id: 'clip-1', farmId: 'f', plotId: 'plot-1', recordedAtUtc: '2026-10-17T03:00:00Z', mimeType: 'audio/webm', sizeBytes: 10, status: 'parsed' },
        { id: 'clip-2', farmId: 'f', plotId: 'plot-1', recordedAtUtc: '2026-10-17T04:00:00Z', mimeType: 'audio/webm', sizeBytes: 10, status: 'parsed', s3RetainedKey: 'srv-2' },
    ]]]),
}));
vi.mock('../../../voiceDiary/components/ClipPlayerCard', () => ({
    default: ({ clip }: { clip: { id: string; cloudState?: string } }) => <div data-testid={`player-${clip.id}`} data-cloud={clip.cloudState}>▶</div>,
}));
vi.mock('../../../voiceDiary/hooks/useFullHistoryJournalConsent', () => ({
    useFullHistoryJournalConsent: () => ({ granted: true, loaded: true, state: {}, reload: async () => {} }),
}));
vi.mock('../../../../infrastructure/voice/voiceArchiveConsent', async importOriginal => ({
    ...(await importOriginal<object>()),
    getArchiveConsentSince: async () => '2026-10-01T00:00:00Z',
}));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="money-lens" /> : null),
}));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 250 } }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import LineageRibbon from '../../../schedule-authoring/components/LineageRibbon';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropProfile } from '../../../../types';
import { addDays } from '../scheduleDates';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, crop, log, water, work } from './scheduleFixtures';

const k = (day: number) => addDays(REF, day);
const typed = { meta: { createdAtISO: '2026-10-17T03:30:00Z', provenance: { source: 'manual' as const, timestamp: '2026-10-17T03:30:00Z' } } };
const LOGS = [
    log(k(0), work(), typed),
    log(k(0), water()),
    log(k(4), water()),
    log(k(7), work('gap_recorded')),
];

const OLD_ENGLISH = ['VIEW', 'LIBRARY', 'MODIFY', "Today's Scheduled Tasks", 'Timeline Progress', 'We are here', 'Water', 'Nutri', 'Last Action Memory', 'Close Day', 'Risk rising', 'Stable', 'Template'];

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z')); // 11:30 IST, schedule day 9
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(crops: CropProfile[] = [crop()]) {
    const props = { onUpdateCrops: vi.fn(), onCloseDay: vi.fn(), onBack: vi.fn() };
    render(<SchedulerPage crops={crops} logs={LOGS} tasks={[]} {...props} />);
    return props;
}
const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('शेड्यूल — where you are, in Marathi (S2, S3, S15)', () => {
    it('one page bar with "← मागे"; the card names crop · plot, the schedule in Marathi, who made it, day 9 of 40 and the stage', () => {
        const p = mount();
        expect(text('page-title')).toBe('शेड्यूल');
        fireEvent.click(screen.getByTestId('page-back'));
        expect(p.onBack).toHaveBeenCalledTimes(1);
        expect(text('sched-crop-plot')).toBe('Grapes · A');
        expect(text('sched-name')).toBe('द्राक्ष — हंगामी शेड्यूल');
        expect(text('sched-owner')).toContain('कोणी बनवलं: ॲपमधलं मूळ शेड्यूल');
        expect(text('day-now')).toBe('9');
        expect(text('day-total')).toBe('40');
        expect(text('stage-count')).toBe('2');
        expect(text('stage-line')).toContain('स्टेज 1 · छाटणीनंतर');
        expect(text('stage-line')).toContain('दिवस 0–14');
        expect(text('here-pin')).toContain('तुम्ही इथे आहात');
        expect(screen.getByTestId('stage-row-1')).toHaveAttribute('data-current', 'yes');
        expect(screen.getByTestId('ribbon-1')).toHaveAttribute('data-filled', '67');
        expect(screen.getByTestId('ribbon-2')).toHaveAttribute('data-filled', '0');
        // He adopted it: no "nobody chose this" note.
        expect(screen.queryByTestId('default-schedule-note')).toBeNull();
        for (const w of OLD_ENGLISH) expect(document.body.textContent).not.toContain(w);
    });
});

describe('the three big buttons (S5) and the आज list (S6, S12)', () => {
    it('opens on आज; counts are computed; only the chosen list is on screen', () => {
        mount();
        expect(screen.getByTestId('tab-today')).toHaveAttribute('aria-selected', 'true');
        expect(text('count-today')).toBe('4'); // today's irrigation + 3 owed
        expect(text('tab-today')).toContain('राहिलेलं 3');
        expect(text('count-done')).toBe('2');
        expect(text('tab-done')).toContain('राहिलं 4');
        expect(text('count-ahead')).toBe('4');
        expect(screen.queryByTestId('compare-card')).toBeNull();
        expect(screen.queryByTestId('ahead')).toBeNull();
    });

    it('आधी राहिलेलं काम lists the computed misses with the schedule\'s own task name; today and tomorrow follow', () => {
        mount();
        const owed = screen.getByTestId('owed-card');
        expect(owed).toHaveAttribute('data-count', '3');
        expect(within(owed).getByText('आधी राहिलेलं काम')).toBeInTheDocument();
        expect(text('owed-irrigation')).toContain('ठिबक सिंचन');
        expect(text('owed-irrigation')).toContain('दिवस 6'); // day 3's miss was made up on day 4
        expect(text('owed-irrigation')).toContain('सिंचन');
        expect(text('owed-spray')).toContain('फवारणी');
        expect(text('owed-spray')).toContain('बुरशीनाशक फवारणी'); // the schedule's "Fungicide spray"
        expect(text('owed-work')).toContain('खुरपणी');
        expect(text('today-card')).toContain('दिवस 9 / 40');
        expect(text('today-parts-irrigation')).toContain('ठिबक सिंचन');
        expect(text('tomorrow-peek')).toContain('या दिवशी शेड्यूलमध्ये काही नव्हतं');
        fireEvent.click(screen.getByTestId('see-ahead'));
        expect(screen.getByTestId('tab-ahead')).toHaveAttribute('aria-selected', 'true');
    });

    it('पुढे: 8 days by default, 3 on the toggle, tasks grouped in the four parts', () => {
        mount();
        fireEvent.click(screen.getByTestId('tab-ahead'));
        expect(screen.getByTestId(`ahead-${k(12)}`)).toBeInTheDocument();
        expect(screen.getByTestId(`ahead-${k(15)}-parts-nutrition`)).toHaveTextContent('खत');
        expect(screen.getByTestId(`ahead-${k(14)}-parts-work`)).toHaveTextContent('खुरपणी');
        fireEvent.click(screen.getByTestId('win-3'));
        expect(screen.getByTestId(`ahead-${k(12)}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`ahead-${k(14)}`)).toBeNull();
    });
});

describe('झालं: expected vs done (S7), past days (S8) and the day sheet (S10, S11)', () => {
    it('one bar per part made ONLY of done and missed, a summary line, "—" for a part never expected, a strip of 8 days', () => {
        mount();
        fireEvent.click(screen.getByTestId('tab-done'));
        expect(text('compare-summary')).toBe('अपेक्षित 6 · झालं 2 · राहिलं 4 · जास्तीचं 1');
        expect(text('cmp-irrigation-text')).toBe('1/3 झालं · +1 जास्तीचं');
        expect(text('cmp-nutrition-text')).toBe('—');
        // "Partly" is open (decision A): no bar has a third kind of segment.
        const segs = (p: string) => [...screen.getByTestId(`cmp-${p}-bar`).querySelectorAll('[data-seg]')].map(s => s.getAttribute('data-seg'));
        expect(['irrigation', 'nutrition', 'spray', 'work'].map(segs)).toEqual([['done', 'missed'], [], ['missed'], ['done', 'missed']]);
        expect(screen.getByTestId('cmp-irrigation-bar').children).toHaveLength(2);
        expect(within(screen.getByTestId('day-strip')).getAllByRole('button')).toHaveLength(8);
        expect(screen.getByTestId(`strip-${k(8)}`)).toHaveAttribute('data-verdict', 'missed');
        expect(screen.getByTestId(`strip-${k(1)}`)).toHaveAttribute('data-verdict', 'none');
        // A strip day opens its sheet; the one-time spray keeps the old "Milestone" tag, as एकदाच, and its own name.
        fireEvent.click(screen.getByTestId(`strip-${k(8)}`));
        expect(screen.getByTestId('day-vs-spray')).toHaveAttribute('data-status', 'missed');
        expect(within(screen.getByTestId('day-vs-spray')).getByTestId('once-tag')).toHaveTextContent('एकदाच');
        expect(within(screen.getByTestId('day-vs-spray')).getByTestId('item-detail')).toHaveTextContent('बुरशीनाशक फवारणी');
    });

    it('past days show their parts; older on request (land-preparation days tagged तयारी); this phone\'s mic count; tap opens the day sheet', () => {
        mount();
        fireEvent.click(screen.getByTestId('tab-done'));
        expect(screen.getByTestId(`past-${k(8)}-spray`)).toHaveAttribute('data-status', 'missed');
        expect(screen.queryByTestId(`past-${k(0)}`)).toBeNull();
        fireEvent.click(screen.getByTestId('show-older'));
        expect(screen.getByTestId(`past-${k(4)}-irrigation`)).toHaveAttribute('data-status', 'extra');
        expect(text(`clipcount-${k(0)}`)).toBe('2');
        expect(text(`prep-${k(-1)}`)).toBe('तयारी');
        expect(screen.queryByTestId(`prep-${k(0)}`)).toBeNull();

        fireEvent.click(screen.getByTestId(`open-day-${k(0)}`));
        const sheet = screen.getByTestId('day-sheet');
        expect(text('day-sheet-title')).toContain('दिवस 0');
        expect(screen.getByTestId('day-clips')).toHaveAttribute('data-count', '2');
        expect(within(sheet).getByText('फक्त या फोनवरचं रेकॉर्डिंग दिसतं')).toBeInTheDocument();
        expect(text('typed-tag')).toBe('लिहिलेलं');
        expect(screen.getByTestId('day-vs-irrigation')).toHaveAttribute('data-status', 'done');
        expect(screen.getByTestId('day-vs-work')).toHaveAttribute('data-status', 'done');
        fireEvent.click(screen.getByTestId('day-sheet-back'));
        expect(screen.queryByTestId('day-sheet')).toBeNull();
    });

    it('the day sheet labels each recording the way the voice diary does: only the server\'s acknowledgement is "saved"', async () => {
        mount();
        fireEvent.click(screen.getByTestId('tab-done'));
        fireEvent.click(screen.getByTestId('show-older'));
        fireEvent.click(screen.getByTestId(`open-day-${k(0)}`));
        await waitFor(() => expect(screen.getByTestId('player-clip-1')).toHaveAttribute('data-cloud', 'queued'));
        expect(screen.getByTestId('player-clip-2')).toHaveAttribute('data-cloud', 'acknowledged');
    });

    it('the day sheet shows जास्तीचं for work nobody asked for, and no recording when the phone has none', () => {
        mount();
        fireEvent.click(screen.getByTestId('tab-done'));
        fireEvent.click(screen.getByTestId('show-older'));
        fireEvent.click(screen.getByTestId(`open-day-${k(4)}`));
        expect(screen.getByTestId('day-extra-irrigation')).toHaveTextContent('जास्तीचं');
        expect(screen.getByTestId('day-no-clips')).toHaveTextContent('या फोनवर त्या दिवशीचं रेकॉर्डिंग नाही');
        expect(screen.getByTestId('day-no-expectation')).toBeInTheDocument();
    });
});

describe('honest empty states (P4)', () => {
    it('no crops: says so in Marathi, without telling a worker to add crops', () => {
        mount([]);
        expect(text('sched-no-crops')).toContain('अजून एकही पीक नाही');
        expect(text('sched-no-crops')).toContain('पीक आणि प्लॉट जोडल्यावर इथे शेड्यूल दिसेल.');
        expect(text('sched-no-crops')).not.toContain('सेट-अप केंद्रात');
    });

    it('a crop with no real schedule: no made-up stages or tasks; the library and editor are still there', () => {
        mount([crop([{ ...crop().plots[0], schedule: undefined as never }], { name: 'Tomato', activeScheduleId: null })]);
        expect(text('sched-no-schedule')).toContain('या पिकासाठी अजून शेड्यूल नाही');
        expect(screen.queryByTestId('sched-tabs')).toBeNull();
        expect(screen.queryByTestId('open-grid')).toBeNull();
        expect(screen.getByTestId('open-library')).toBeInTheDocument();
        expect(screen.getByTestId('open-editor')).toBeInTheDocument();
    });
});

describe('LineageRibbon (S15) in Marathi', () => {
    it('says where the schedule came from and when it was published', () => {
        render(<LineageRibbon derivedFromTemplateId="t0" derivedFromName="Base" version={2} author="डॉ. पाटील" publishedAtUtc="2026-10-23T06:00:00Z" />);
        const r = screen.getByTestId('lineage-ribbon').textContent ?? '';
        expect(r).toContain('यावरून बनवलं: Base · आवृत्ती 2 · डॉ. पाटील');
        expect(r).toContain('प्रकाशित: 3 दिवसांपूर्वी');
        expect(r).not.toMatch(/Derived|Published|Draft/);
    });
});
