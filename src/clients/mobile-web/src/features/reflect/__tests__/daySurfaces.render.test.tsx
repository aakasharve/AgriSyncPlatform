// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF, RF2)
 *
 * The day's work on आढावा, drawn — in Marathi AND in English (one language at a time). Lane RF2 (the founder's screen
 * 1): a plot card opens the plot's day — all its work sorted into the result screen's buckets, each value with the time
 * it was told; under them the time chips (a green dot when confirmed), each opening its recording INLINE with one small
 * line (who · status · ▶ where allowed) and "बदला"; no "यातून काय समजलं" source panel; "आणखी सांगा" only today. The
 * day's feed sheet and the glance are retired. The notes keep their link to the recording. What the farmer must read:
 * the ONE status wording, "लिहिलेलं" for a typed entry, product boxes from the stored content, the old-entry line (and
 * nothing invented) for an older record, ▶ only where it may be offered, "—" for money he may not see, and no number
 * summed across recordings.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
const emitClosureSummaryViewed = vi.hoisted(() => vi.fn());
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import { LogVerificationStatus, type DailyLog } from '../../../types';
import { resultCopy } from '../../logs/components/voiceResult/resultCopy';
import { anyLog, dayRecordings, plotLogFilter, withMoneyShown, type DayRecording } from '../day/dayRecordings';
import { DayFeedSheet, PlotDayView } from '../day/DaySheets';
import type { ListenKind } from '../day/listenModel';
import type { DayListen } from '../day/useDayListen';
import { buildDayNotes } from '../overview/notesModel';
import { NotesList } from '../overview/NotesList';
import { selectAll, toViewScope } from '../overview/reflectSelection';
import { reflectCopy } from '../reflectCopy';
import { CROPS, TODAY_KEY, log } from './reflectFixtures';

const ME = 'user-me';
const depsFor = () => {
    const copy = reflectCopy(lang.value);
    return { youIds: new Set([ME]), nameOf: (id: string) => (id === 'op-sunil' ? 'सुनील' : undefined), youLabel: copy.you, unknownLabel: copy.unknownPerson };
};
const at = (hhmm: string) => `2026-10-25T${hhmm}:00.000Z`;
const said = (id: string, iso: string, who: string, extra: Partial<DailyLog> = {}): DailyLog =>
    log({ id, meta: { createdAtISO: iso, createdByOperatorId: who, farmId: 'farm-1' }, ...extra });

/** A listen with no player behind it: `kind` decides what ▶ there is. */
const listenWith = (kind: ListenKind): DayListen => ({
    kindOf: () => kind,
    clipOf: rec => (kind === 'clip' ? { id: `clip-${rec.voiceLog.id}` } as never : undefined),
    playing: () => false,
    progress: 0,
    lengthOf: () => 8,
    toggle: vi.fn(),
    stop: vi.fn(),
    farmOf: () => 'farm-1',
});

const recsOf = (logs: DailyLog[], filter: (l: DailyLog) => boolean = anyLog) => dayRecordings(logs, TODAY_KEY, filter, depsFor(), CROPS);

const spray = () => said('s', at('07:00'), 'op-sunil', {
    fullTranscript: 'इथरेल फवारलं',
    inputs: [{ id: 'i1', method: 'Spray', mix: [{ id: 'mx', productName: 'इथरेल' }], productName: 'इथरेल', sourceText: 'इथरेल फवारलं' }],
    verification: { required: true, status: LogVerificationStatus.VERIFIED },
} as Partial<DailyLog>);
const typed = () => said('t', at('09:00'), ME, { typedEntry: true, fullTranscript: 'पाणी दिलं दोन तास', irrigation: [{ id: 'w1', durationHours: 2 }] });
const legacy = () => said('old', at('05:00'), 'op-sunil', {
    legacyPartial: true,
    irrigation: [{ id: 'w', notes: 'Method: Drip | Duration: 2 hrs' }],
    cropActivities: [{ id: 'c', title: 'Spraying', workTypes: ['Spraying'] }],
} as Partial<DailyLog>);

beforeEach(() => { lang.value = 'mr'; emitClosureSummaryViewed.mockClear(); });
afterEach(cleanup);

const view = (recordings: DayRecording[], over: Partial<React.ComponentProps<typeof PlotDayView>> = {}) => (
    <PlotDayView title="सोनाका · द्राक्ष" dayLabel="x" dateKey={TODAY_KEY} isToday recordings={recordings} listen={listenWith('none')} onClose={vi.fn()} {...over} />
);

describe.each(['mr', 'en'] as const)('PlotDayView — the plot day, the founder screen 1 (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);
    const first = () => said('r1', at('03:00'), ME, { fullTranscript: 'दोन मजूर', labour: [{ id: 'l1', type: 'HIRED', count: 2, totalCost: 400 }] });
    const second = () => said('r2', at('08:00'), 'op-sunil', { fullTranscript: 'तीन मजूर', labour: [{ id: 'l2', type: 'HIRED', count: 3, totalCost: 600 }] });

    it('all the work in the result screen buckets, open, each value beside its time; never a sum across recordings', () => {
        const recs = recsOf([second(), first()], plotLogFilter({ cropId: 'grape', plotId: 'g1' }));
        render(view(recs));
        expect(screen.getByTestId('rf-day-title')).toHaveTextContent('सोनाका · द्राक्ष');
        expect(screen.getByTestId('rf-day-parts')).toHaveTextContent(copy().dayViewHint(true));
        expect(screen.getByTestId('vr-day-labour')).toHaveAttribute('data-open', 'yes');
        const history = within(screen.getByTestId('vr-day-history-labour'));
        expect(history.getByText('2 जण')).toBeInTheDocument();
        expect(history.getByText('3 जण')).toBeInTheDocument();
        expect(screen.getByTestId('vr-day-history-labour')).toHaveTextContent('सकाळी 8:30');
        expect(screen.getByTestId('vr-day-history-labour')).toHaveTextContent('दुपारी 1:30');
        const text = screen.getByTestId('rf-day').textContent ?? '';
        expect(text).not.toContain('5 जण');
        expect(text).not.toContain('1000');
        // no "यातून काय समजलं / कोणत्या शब्दांतून" source panel here, and none of his marked words
        expect(text).not.toContain('यातून काय समजलं');
        expect(screen.queryByTestId('vr-words')).toBeNull();
        expect(emitClosureSummaryViewed).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', dateKey: TODAY_KEY, logsCount: 2, source: 'drawer_open' }));
    });

    it('the time chips: morning first, a green dot when confirmed; a tap shows that recording INLINE (who, status, बदला); a second tap closes it', () => {
        const onEdit = vi.fn();
        const confirmed = { ...second(), verification: { required: true, status: LogVerificationStatus.VERIFIED } } as DailyLog;
        const recs = recsOf([confirmed, first()]);
        render(view(recs, { onEdit }));
        const chips = within(screen.getByTestId('rf-day-times')).getAllByRole('button').map(b => b.getAttribute('data-testid'));
        expect(chips).toEqual(['rf-time-r1', 'rf-time-r2']);
        expect(screen.getByTestId('rf-time-r1')).toHaveAttribute('data-confirmed', 'no');
        expect(screen.getByTestId('rf-time-r2')).toHaveAttribute('data-confirmed', 'yes');
        expect(screen.getByTestId('rf-day-times')).toHaveTextContent(copy().timesKey);
        expect(screen.queryByTestId('rf-rec-r2')).toBeNull();
        fireEvent.click(screen.getByTestId('rf-time-r2'));
        expect(screen.getByTestId('rf-time-r2')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('rf-rec-r2-who')).toHaveTextContent('सुनील');
        expect(screen.getByTestId('rf-rec-r2-state')).toHaveTextContent(copy().confirmed);
        expect(screen.getByTestId('rf-rec-r2-parts')).toHaveTextContent('3 जण');
        fireEvent.click(screen.getByTestId('rf-rec-r2-edit-r2'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
        fireEvent.click(screen.getByTestId('rf-time-r1'));
        expect(screen.queryByTestId('rf-rec-r2')).toBeNull();
        expect(screen.getByTestId('rf-rec-r1-who')).toHaveTextContent(copy().you);
        fireEvent.click(screen.getByTestId('rf-time-r1'));
        expect(screen.queryByTestId('rf-rec-r1')).toBeNull();
    });

    it('a note link lands with its recording already open', () => {
        const recs = recsOf([second(), first()]);
        render(view(recs, { openKey: recs[1].key }));
        expect(screen.getByTestId('rf-rec-r2')).toBeInTheDocument();
    });

    it('a typed entry: "लिहिलेलं" / "Typed", and no ▶ even where a clip could be', () => {
        const recs = recsOf([typed()]);
        render(view(recs, { listen: listenWith('clip') }));
        fireEvent.click(screen.getByTestId('rf-time-t'));
        expect(screen.getByTestId('rf-rec-t-typed')).toHaveTextContent(resultCopy(language).typedTag);
        expect(screen.queryByTestId('rf-rec-t-play-listen')).toBeNull();
    });

    it('an older record: the old-entry line, word for word, and nothing invented', () => {
        const recs = recsOf([legacy()]);
        render(view(recs));
        fireEvent.click(screen.getByTestId('rf-time-old'));
        expect(screen.getByTestId('rf-rec-old-legacy')).toHaveTextContent(resultCopy(language).legacyPartial);
        const inline = screen.getByTestId('rf-rec-old').textContent ?? '';
        for (const invented of ['₹', 'तास', 'Drip', 'Spraying', 'अडथळे']) expect(inline).not.toContain(invented);
    });

    it('▶ only where it may be offered (RF rules): none → nothing; the clip → its player; the server → "मूळ आवाज ऐका"', () => {
        const recs = recsOf([spray()]);
        const none = render(view(recs));
        fireEvent.click(screen.getByTestId('rf-time-s'));
        expect(screen.queryByTestId('rf-rec-s-play-listen')).toBeNull();
        none.unmount();
        const clip = render(view(recs, { listen: listenWith('clip') }));
        fireEvent.click(screen.getByTestId('rf-time-s'));
        expect(screen.getByTestId('rf-rec-s-play-listen')).toHaveAttribute('data-listen', 'clip');
        clip.unmount();
        render(view(recs, { listen: listenWith('server') }));
        fireEvent.click(screen.getByTestId('rf-time-s'));
        expect(screen.getByTestId('rf-rec-s-play-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.getByTestId('ov-play-s')).toHaveTextContent(language === 'en' ? 'Play original voice' : 'मूळ आवाज ऐका');
        // a spray is its product box, from the stored content
        expect(screen.getAllByTestId('vr-product-box-i1')[0]).toHaveTextContent('इथरेल');
    });

    it('money he may not see is "—" (another person recording); never his amount', () => {
        const other = said('o', at('06:00'), 'op-sunil', { labour: [{ id: 'l', type: 'HIRED', count: 3, totalCost: 900 }] });
        const recs = recsOf([other]).map(r => withMoneyShown(r, false));
        render(view(recs));
        fireEvent.click(screen.getByTestId('rf-time-o'));
        expect(screen.getByTestId('rf-day').textContent).not.toContain('900');
        expect(screen.getByTestId('rf-rec-o-parts')).toHaveTextContent('—');
    });

    it('"आणखी सांगा" only today (a recording is always today): it asks the ONE mic; new work is highlighted on return', () => {
        const onTellMore = vi.fn();
        const recs = recsOf([second(), first()]);
        render(view(recs, { onTellMore, fresh: new Set(['r2']) }));
        fireEvent.click(screen.getByTestId('rf-day-tell'));
        expect(onTellMore).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('rf-day-tell')).toHaveTextContent(copy().tellMore);
        expect(screen.getByTestId('vr-day-labour')).toHaveAttribute('data-touched', 'yes');
        cleanup();
        render(view(recs, { isToday: false }));
        expect(screen.queryByTestId('rf-day-tell')).toBeNull();
    });

    it('nothing told: says so plainly; back closes', () => {
        const onClose = vi.fn();
        render(view([], { onClose, isToday: false }));
        expect(screen.getByTestId('rf-day-empty')).toHaveTextContent(copy().nothingTold(false));
        fireEvent.click(screen.getByTestId('rf-day-back'));
        expect(onClose).toHaveBeenCalled();
        expect(screen.getByTestId('rf-day-back')).toHaveTextContent(copy().back);
    });
});

describe.each(['mr', 'en'] as const)('DayFeedSheet — the "आजचा आढावा" screen, the founder screen 2 (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);
    const g1 = (id: string, hhmm: string, who: string, count: number) => said(id, at(hhmm), who, { labour: [{ id: `l-${id}`, type: 'HIRED', count }] });

    it('one block per place: its identity, "N वेळा सांगितलं", ONE row of time chips; a time opens that recording in the block', () => {
        const onEdit = vi.fn();
        const recs = recsOf([g1('a', '03:00', ME, 5), g1('b', '08:00', 'op-sunil', 10)]);
        render(<DayFeedSheet blocks={[{ key: 'grape:g1', title: 'सोनाका', subtitle: 'द्राक्ष', recordings: recs }]} isToday dayLabel="x" listen={listenWith('none')} onEdit={onEdit} onClose={vi.fn()} />);
        const block = screen.getByTestId('rf-feed-block-grape:g1');
        expect(block).toHaveTextContent('सोनाका');
        expect(screen.getByTestId('rf-feed-block-grape:g1-times')).toHaveTextContent(copy().timesTold(2, true));
        const chips = within(screen.getByTestId('rf-times-grape:g1-')).getAllByRole('button').map(b => b.getAttribute('data-testid'));
        expect(chips).toEqual(['rf-time-grape:g1-a', 'rf-time-grape:g1-b']);
        fireEvent.click(screen.getByTestId('rf-time-grape:g1-b'));
        expect(screen.getByTestId('rf-rec-grape:g1-b-who')).toHaveTextContent('सुनील');
        expect(screen.getByTestId('rf-rec-grape:g1-b-state')).toHaveTextContent(copy().notConfirmed);
        expect(screen.getByTestId('rf-rec-grape:g1-b-parts')).toHaveTextContent('10 जण');
        // nothing summed across recordings
        expect(block.textContent).not.toContain('15');
        fireEvent.click(screen.getByTestId('rf-rec-grape:g1-b-edit-b'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    });

    it('nothing told that day: says so plainly', () => {
        render(<DayFeedSheet blocks={[]} isToday={false} dayLabel="x" listen={listenWith('none')} onClose={vi.fn()} />);
        expect(screen.getByTestId('rf-feed-empty')).toHaveTextContent(copy().feedEmpty(false));
    });
});

describe('fix pass D4 — no quoted source words on the RF2 surfaces', () => {
    it('the plot-day view and the opened recording show what was understood, never his quote', () => {
        const quoted = said('q', at('03:00'), ME, {
            fullTranscript: 'आज इथरेल 300 मिली फवारणी केली',
            inputs: [{ id: 'i1', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 300, unit: 'ml', sourceText: 'इथरेल 300 मिली फवारणी केली' }],
        } as Partial<DailyLog>);
        const recs = recsOf([quoted]);
        render(<PlotDayView title="t" dayLabel="x" dateKey={TODAY_KEY} isToday recordings={recs} listen={listenWith('none')} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('rf-time-q'));
        const text = screen.getByTestId('rf-day').textContent ?? '';
        expect(text).not.toContain('“');
        expect(text).not.toContain('फवारणी केली');
        expect(screen.getByTestId('rf-day').querySelectorAll('mark')).toHaveLength(0);
    });
});

describe.each(['mr', 'en'] as const)('NotesList — each note links to its recording (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);
    const noted = () => said('n1', at('03:40'), 'op-sunil', {
        fullTranscript: 'बांधाजवळ कीड दिसली',
        observations: [{ id: 'o1', plotId: 'g1', dateKey: TODAY_KEY, timestamp: at('03:40'), textRaw: 'बांधाजवळ कीड दिसली', noteType: 'issue', severity: 'normal', source: 'voice' }],
    });

    const renderNotes = (kind: ListenKind) => {
        const history = [noted()];
        const recs: DayRecording[] = recsOf(history);
        const onOpen = vi.fn();
        const notes = buildDayNotes({ history, dateKey: TODAY_KEY, scope: toViewScope(CROPS, selectAll(CROPS)), crops: CROPS, operatorNameById: {}, whoDeps: depsFor() });
        render(<NotesList notes={notes} sources={{ recordingOf: id => recs.find(r => r.view.logIds.includes(id)), listen: listenWith(kind), onOpen }} />);
        return { onOpen, recs };
    };

    it('who (the result screen\'s chip), when, confirmed or not, and "where it came from" opens its recording', () => {
        const { onOpen, recs } = renderNotes('none');
        expect(screen.getByTestId('note-o1-who')).toHaveTextContent('सुनील');
        expect(screen.getByTestId('note-o1')).toHaveTextContent('सकाळी 9:10');
        expect(screen.getByTestId('note-o1-state')).toHaveTextContent(copy().notConfirmed);
        fireEvent.click(screen.getByTestId('note-o1-source'));
        expect(onOpen).toHaveBeenCalledWith(recs[0]);
        expect(screen.getByTestId('note-o1-source')).toHaveTextContent(copy().noteSource);
        expect(screen.queryByTestId('note-o1-play-listen')).toBeNull(); // ▶ hidden where not allowed
        fireEvent.click(screen.getByTestId('note-o1-toggle'));
        expect(screen.getByTestId('note-o1-toggle')).toHaveAttribute('aria-expanded', 'true');
    });

    it('▶ where the server allows it', () => {
        renderNotes('server');
        expect(screen.getByTestId('note-o1-play-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.getByTestId('ov-play-n1')).toBeInTheDocument();
    });
});
