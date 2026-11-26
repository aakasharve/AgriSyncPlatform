// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (founder 2026-11-26: "exact replication of what we built") — the v2 detail page (the design's
 * शेतीचा आढावा), full screen in the design's frame, on real `DailyLog` shapes (a spray of two products, two speakers, one
 * earlier recording):
 *   - the frame's bar says "शेतीचा आढावा" and the month's day count; the chips say the place, the day and "N नोंदी";
 *   - the sections come in the design's order: chips, who told it, the record card (badges, his voice, his words with the why
 *     and the unclear box), "औषध / खत", the parts with अडथळा, the question and extras, the earlier recordings OPEN,
 *     "मंजुरीसाठी N"; the footer "← मागे" and "आणखी सांगा";
 *   - the owner's "पक्कं आहे" only when the container says he may (canConfirm), its basis heard / read as before;
 *   - "मंजुरीसाठी N" only when the ONE approval list gives a number for this person (never null, never ०), opening the one sheet;
 *   - the badges claim only what is true (P10): the server's words only once the server acknowledged it.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { queue, opened } = vi.hoisted(() => ({ queue: { count: 3 as number | null }, opened: { n: 0 } }));
vi.mock('../../../../approval/useApprovalQueue', () => ({ useApprovalQueue: () => ({ count: queue.count, mayConfirm: queue.count !== null }) }));
vi.mock('../../../../approval/openApprovalReview', () => ({ openApprovalReview: () => { opened.n += 1; } }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});

import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { ProductAnswerKit } from '../../voiceResult/ProductCard';
import { buildDayView, type WhoDeps } from '../../voiceResult/resultModel';
import DetailPage, { type DetailPageProps } from '../DetailPage';

const ME = 'op-me';
const RAMESH = 'op-ramesh';
const DATE = '2026-10-26';

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: 'farm-1' },
    ...over,
}) as unknown as DailyLog;

const NOW = log('L-NOW', {
    fullTranscript: 'आज दहा मजूर आले, कॉन्फिडॉर अडीचशे एमएल आणि युथेन पाचशे ग्रॅम दोनशे लिटर पाण्यात फवारलं',
    labour: [{ id: 'lab', count: 10, sourceText: 'दहा मजूर आले' }],
    inputs: [{ id: 'ev-spray', method: 'Spray', carrierVolume: 200, carrierUnit: 'L', sourceText: 'दोनशे लिटर पाण्यात फवारलं',
        mix: [{ id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' }, { id: 'm-uth', productName: 'युथेन एम-४५', dose: 500, unit: 'g' }] }],
});
const EARLIER = log('L-EARLY', {
    fullTranscript: 'सकाळी छाटणी केली',
    cropActivities: [{ id: 'crop-m', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    meta: { createdAtISO: '2026-10-26T03:00:00.000Z', createdByOperatorId: RAMESH, farmId: 'farm-1' },
});

const deps: WhoDeps = { youIds: new Set([ME]), nameOf: id => (id === RAMESH ? 'रमेश' : undefined), ownName: 'सुनील', unknownLabel: 'अज्ञात', language: 'mr', nativeDigits: true };
const clipRow = (dailyLogId: string): VoiceClipCacheRecord => ({ id: `clip-${dailyLogId}`, dailyLogId, durationMs: 4000 } as unknown as VoiceClipCacheRecord);
const kit: ProductAnswerKit = {
    logById: new Map([NOW, EARLIER].map(l => [l.id, l] as const)), canCheck: true, canSeeMoney: false,
    nameOfUser: () => 'सुनील', cropNamesOf: () => [], onAnswer: vi.fn(async () => undefined), onPhoto: vi.fn(async () => undefined),
};

const props = (over: Partial<DetailPageProps> = {}): DetailPageProps => ({
    day: buildDayView([NOW], [NOW, EARLIER], deps),
    placeLabel: 'द्राक्ष · प्लॉट १', farmId: 'farm-1', farmRole: 'PrimaryOwner', days: 18, unclear: ['मागच्या बाजूचं उद्या बघू'],
    clips: new Map([[NOW.id, clipRow(NOW.id)], [EARLIER.id, clipRow(EARLIER.id)]]), playingId: null, lengthOf: () => 4, onTogglePlay: vi.fn(),
    sync: 'onPhone', syncQueuedOf: () => true,
    confirm: { canConfirm: true, confirmed: false, confirmFailed: false, heard: false, onConfirm: vi.fn() },
    onEdit: vi.fn(), onTellMore: vi.fn(),
    questionPanel: <div data-testid="question-panel" />, extras: <div data-testid="extras-slot" />,
    answerKit: kit, onBack: vi.fn(), onAddAnother: vi.fn(),
    ...over,
});

const before = (a: string, b: string): boolean =>
    !!(screen.getByTestId(a).compareDocumentPosition(screen.getByTestId(b)) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => { cleanup(); queue.count = 3; opened.n = 0; });

describe('DetailPage — the design\'s शेतीचा आढावा', () => {
    it('is full screen in the frame: "शेतीचा आढावा", the month\'s days, no bar back arrow (the footer has मागे)', () => {
        render(<DetailPage {...props()} />);
        const shell = screen.getByTestId('vr2d-shell');
        expect(within(shell).getByTestId('v2-place').textContent).toBe('शेतीचा आढावा');
        expect(within(shell).getByTestId('v2-days').textContent).toBe('या महिन्यात १८ दिवस');
        expect(within(shell).queryByTestId('v2-back')).toBeNull();
        expect(within(screen.getByTestId('v2-footer')).getByTestId('vr2d-back').textContent).toContain('मागे');
    });

    it('the chips: the place, the day, "२ नोंदी"; then who told it today', () => {
        render(<DetailPage {...props()} />);
        expect(screen.getByTestId('vr2d-place').textContent).toBe('द्राक्ष · प्लॉट १');
        expect(screen.getByTestId('vr2d-day').textContent).toBe('आज');
        expect(screen.getByTestId('vr2d-records').textContent).toBe('२ नोंदी');
        expect(screen.getByTestId('vr2d-speakers').textContent).toContain('रमेश');
    });

    it('the sections come in the design\'s order', () => {
        render(<DetailPage {...props()} />);
        const order = ['vr2d-chips', 'vr2d-speakers', 'vr2d-record', 'vr2d-badges', 'vr2d-play', 'vr2d-words-heading', 'vr2-words-text', 'vr-why-heading', 'vr2-unclear',
            'vr2d-confirm', 'vr2d-edit', 'vr2-given', 'vr2-parts', 'vr2-part-blockers', 'question-panel', 'extras-slot', 'vr2-earlier',
            'vr2d-approvals', 'vr2d-back', 'vr2d-add-another'];
        for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), `${order[i - 1]} before ${order[i]}`).toBe(true);
        expect(screen.getByTestId('vr2-given').textContent).toContain('औषध / खत');
    });

    it('the badges: time, his name with his role, "लक्षात ठेवलं", "पक्कं नाही" — and no server claim while it is on the phone (P10)', () => {
        render(<DetailPage {...props()} />);
        const b = within(screen.getByTestId('vr2d-badges'));
        expect(b.getByTestId('vr2d-who').textContent).toBe('सुनील (मालक)');
        expect(b.getByTestId('vr2d-remembered').textContent).toBe('लक्षात ठेवलं');
        expect(b.getByTestId('vr2d-not-confirmed-badge').textContent).toBe('पक्कं नाही');
        expect(b.queryByTestId('vr2d-on-server')).toBeNull();
        cleanup();
        render(<DetailPage {...props({ sync: 'onServer', confirm: { canConfirm: true, confirmed: true, confirmFailed: false, heard: false, onConfirm: vi.fn() } })} />);
        expect(screen.getByTestId('vr2d-on-server').textContent).toBe('श्रम सफलमध्ये साठवून ठेवलं');
        expect(screen.getByTestId('vr2d-confirmed-badge')).toBeTruthy();
    });

    it('no role is guessed: someone who is not the holder, or a role not known, is shown by name only', () => {
        render(<DetailPage {...props({ farmRole: null })} />);
        expect(screen.getByTestId('vr2d-who').textContent).toBe('सुनील');
    });

    it('the owner\'s "पक्कं आहे": read basis by default, heard once his clip played; the tap is the container\'s confirm', () => {
        const p = props();
        render(<DetailPage {...p} />);
        expect(screen.getByTestId('vr2d-confirm-basis').textContent).toBe('वाचा आणि पक्कं करा');
        fireEvent.click(screen.getByTestId('vr2d-confirm'));
        expect(p.confirm.onConfirm).toHaveBeenCalledTimes(1);
        cleanup();
        render(<DetailPage {...props({ confirm: { ...p.confirm, heard: true } })} />);
        expect(screen.getByTestId('vr2d-confirm-basis').textContent).toBe('ऐका आणि पक्कं करा');
        cleanup();
        render(<DetailPage {...props({ confirm: { ...p.confirm, confirmed: true } })} />);
        expect(screen.queryByTestId('vr2d-confirm')).toBeNull();
        expect(screen.getByTestId('vr2d-confirm-done')).toBeTruthy();
    });

    it('never asks someone who may not confirm (canConfirm false): no button, no done box', () => {
        render(<DetailPage {...props({ confirm: { canConfirm: false, confirmed: false, confirmFailed: false, heard: true, onConfirm: vi.fn() } })} />);
        expect(screen.queryByTestId('vr2d-confirm')).toBeNull();
        expect(screen.queryByTestId('vr2d-confirm-basis')).toBeNull();
        expect(screen.queryByTestId('vr2d-confirm-done')).toBeNull();
    });

    it('"मंजुरीसाठी ३" from the one approval list opens the one review sheet', () => {
        render(<DetailPage {...props()} />);
        expect(screen.getByTestId('vr2d-approvals-count').textContent).toBe('मंजुरीसाठी ३');
        fireEvent.click(screen.getByTestId('vr2d-approvals'));
        expect(opened.n).toBe(1);
    });

    it('no approval link when the list gives no number (may not confirm / not read) or nothing waits — never a made-up count', () => {
        queue.count = null;
        render(<DetailPage {...props()} />);
        expect(screen.queryByTestId('vr2d-approvals')).toBeNull();
        cleanup();
        queue.count = 0;
        render(<DetailPage {...props()} />);
        expect(screen.queryByTestId('vr2d-approvals')).toBeNull();
    });

    it('the earlier recordings are OPEN, each with its own player', () => {
        const p = props();
        render(<DetailPage {...p} />);
        expect((screen.getByTestId('vr2-earlier') as HTMLDetailsElement).open).toBe(true);
        fireEvent.click(screen.getByTestId(`vr-earlier-play-${EARLIER.id}`));
        expect(p.onTogglePlay).toHaveBeenCalledWith(EARLIER.id);
    });

    it('a product row opens the product card inside the frame (so it is drawn above it)', () => {
        render(<DetailPage {...props()} />);
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-product-card').closest('[data-testid="vr2d-shell"]')).toBeTruthy();
    });

    it('the day sheet and the banners are drawn inside the frame', () => {
        render(<DetailPage {...props({ sheet: <div data-testid="day-sheet" />, top: <div data-testid="banner" /> })} />);
        expect(screen.getByTestId('day-sheet').closest('[data-testid="vr2d-shell"]')).toBeTruthy();
        expect(before('banner', 'vr2d-chips')).toBe(true);
    });

    it('the footer: मागे goes back to the saved screen, आणखी सांगा is the next recording; a red part opens its mic', () => {
        const p = props();
        render(<DetailPage {...p} />);
        fireEvent.click(screen.getByTestId('vr2d-back'));
        expect(p.onBack).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('vr2d-add-another'));
        expect(p.onAddAnother).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('vr2-part-machinery'));
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
    });

    it('several plots: one "बदला" per plot', () => {
        const a = log('L-A', { ...NOW, id: 'L-A' });
        const b = log('L-B', { ...NOW, id: 'L-B', fullTranscript: undefined, context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-2'], selectedPlotNames: ['प्लॉट २'] }] } });
        const p = props({ day: buildDayView([a, b], [a, b], deps), clips: new Map() });
        render(<DetailPage {...p} />);
        fireEvent.click(screen.getByTestId('vr2d-edit-L-B'));
        expect(p.onEdit).toHaveBeenCalledWith('L-B');
        expect(screen.queryByTestId('vr2d-edit')).toBeNull();
    });
});
