// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF)
 *
 * The day's work on आढावा, drawn: one recording (the glance and each recording of a plot's day), the day's work sheet
 * that follows the chosen day, the plot's day sheet (in place of the English drawer), and the notes' link to their
 * recording — in Marathi AND in English (one language at a time). What the farmer must read: what / who / when, the
 * ONE status wording, "लिहिलेलं" + the no-recording note for a typed entry, product boxes from the stored content,
 * the old-entry line (and nothing invented) for an older record, ▶ only where it may be offered, "—" for money he
 * may not see, and no number summed across recordings.
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
import { TYPED_WORDS } from '../../voice/components/recorder/TypedEntry';
import { anyLog, dayRecordings, plotLogFilter, withMoneyShown, type DayRecording } from '../day/dayRecordings';
import { DayFeedSheet, GlanceSheet, PlotDaySheet } from '../day/DaySheets';
import type { ListenKind } from '../day/listenModel';
import { RecordingCard, RecordingRow } from '../day/RecordingCard';
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

const pruning = () => said('m', at('03:40'), ME, {
    fullTranscript: 'छाटणी केली, दोन मजूर चारशे रुपये',
    cropActivities: [{ id: 'a1', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    labour: [{ id: 'l1', type: 'HIRED', count: 2, totalCost: 400 }],
});
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

describe.each(['mr', 'en'] as const)('RecordingCard — one recording, the result screen\'s way (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);

    it('what, who ("तुम्ही" / "You"), when, the ONE status wording; his words; बदला opens that log', () => {
        const onEdit = vi.fn();
        const [rec] = recsOf([pruning()]);
        render(<RecordingCard rec={rec} listen={listenWith('none')} testId="rc" onEdit={onEdit} />);
        const card = screen.getByTestId('rc');
        expect(card).toHaveTextContent('सकाळी 9:10');
        expect(screen.getByTestId('rc-who')).toHaveTextContent(copy().you);
        expect(screen.getByTestId('rc-who')).toHaveAttribute('data-you', 'yes');
        expect(screen.getByTestId('rc-state')).toHaveTextContent(copy().notConfirmed);
        expect(screen.getByTestId('rc-words')).toHaveTextContent('छाटणी केली');
        expect(within(screen.getByTestId('rc-understood')).getByText('छाटणी')).toBeInTheDocument();
        expect(screen.getByTestId('rc-understood')).toHaveTextContent(copy().understood);
        fireEvent.click(screen.getByTestId('rc-edit-m'));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'm' }));
    });

    it('confirmed reads "✔ पक्कं केलं" / "✔ Confirmed"; a spray is its product box, from the stored content', () => {
        const [rec] = recsOf([spray()]);
        render(<RecordingCard rec={rec} listen={listenWith('none')} testId="rc" />);
        expect(screen.getByTestId('rc-state')).toHaveTextContent(copy().confirmed);
        expect(screen.getByTestId('rc-who')).toHaveTextContent('सुनील');
        expect(screen.getByTestId('vr-product-box-i1')).toHaveTextContent('इथरेल');
    });

    it('a typed entry: "लिहिलेलं" / "Typed" and the no-recording note where the player would be — no ▶', () => {
        const [rec] = recsOf([typed()]);
        render(<RecordingCard rec={rec} listen={listenWith('clip')} testId="rc" />);
        expect(screen.getByTestId('rc-typed')).toHaveTextContent(resultCopy(language).typedTag);
        expect(screen.getByTestId('rc-typed-note')).toHaveTextContent(language === 'en' ? resultCopy('en').typedNote : TYPED_WORDS.noAudio);
        expect(screen.queryByTestId('rc-play-listen')).toBeNull();
    });

    it('an older record: the old-entry line, word for word, and nothing invented', () => {
        const [rec] = recsOf([legacy()]);
        render(<RecordingCard rec={rec} listen={listenWith('none')} testId="rc" />);
        expect(screen.getByTestId('rc-legacy')).toHaveTextContent(resultCopy(language).legacyPartial);
        if (language === 'mr') expect(screen.getByTestId('rc-legacy').textContent).toBe('जुनं काम — काही तपशील उपलब्ध नाहीत');
        const card = screen.getByTestId('rc').textContent ?? '';
        for (const invented of ['₹', 'तास', 'Drip', 'Spraying', 'अडथळे']) expect(card).not.toContain(invented);
    });

    it('▶ only where it may be offered: none → nothing; the clip on this phone → its player; the server → "मूळ आवाज ऐका"', () => {
        const [rec] = recsOf([spray()]);
        const { unmount } = render(<RecordingCard rec={rec} listen={listenWith('none')} testId="rc" />);
        expect(screen.queryByTestId('rc-play-listen')).toBeNull();
        expect(screen.queryByTestId('ov-play-s')).toBeNull();
        unmount();
        const clip = render(<RecordingCard rec={rec} listen={listenWith('clip')} testId="rc" />);
        expect(screen.getByTestId('rc-play-listen')).toHaveAttribute('data-listen', 'clip');
        expect(screen.getByTestId('rc-play')).toBeInTheDocument();
        clip.unmount();
        render(<RecordingCard rec={rec} listen={listenWith('server')} testId="rc" />);
        expect(screen.getByTestId('rc-play-listen')).toHaveAttribute('data-listen', 'server');
        expect(screen.getByTestId('ov-play-s')).toHaveTextContent(language === 'en' ? 'Play original voice' : 'मूळ आवाज ऐका');
    });

    it('money he may not see is "—" (another person\'s recording); his own keeps it', () => {
        const other = said('o', at('06:00'), 'op-sunil', { labour: [{ id: 'l', type: 'HIRED', count: 3, totalCost: 900 }] });
        const [rec] = recsOf([other]).map(r => withMoneyShown(r, false));
        render(<RecordingCard rec={rec} listen={listenWith('none')} testId="rc" />);
        expect(screen.getByTestId('rc').textContent).not.toContain('900');
        expect(screen.getByTestId('rc-understood')).toHaveTextContent('—');
    });
});

describe.each(['mr', 'en'] as const)('PlotDaySheet — a plot\'s day replaces the English drawer (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);
    const first = () => said('r1', at('03:00'), ME, { fullTranscript: 'दोन मजूर', labour: [{ id: 'l1', type: 'HIRED', count: 2, totalCost: 400 }] });
    const second = () => said('r2', at('08:00'), 'op-sunil', { fullTranscript: 'तीन मजूर', labour: [{ id: 'l2', type: 'HIRED', count: 3, totalCost: 600 }] });

    it('the day part by part, then EVERY recording in time order with what / who / when; nothing summed', () => {
        const recs = recsOf([second(), first()], plotLogFilter({ cropId: 'grape', plotId: 'g1' }));
        render(<PlotDaySheet title="सोनाका · द्राक्ष" dayLabel={copy().dayName(new Date(2026, 9, 25, 12))} dateKey={TODAY_KEY} recordings={recs}
            listen={listenWith('none')} onClose={vi.fn()} />);
        expect(screen.getByTestId('rf-day-title')).toHaveTextContent('सोनाका · द्राक्ष');
        expect(screen.getByTestId('rf-day-parts')).toHaveTextContent(copy().dayWork);
        expect(screen.getByTestId('rf-day-count')).toHaveTextContent(copy().timesTold(2));
        expect(screen.getByTestId('vr-day-labour')).toBeInTheDocument();
        const order = within(screen.getByTestId('rf-day-recordings')).getAllByTestId(/^rf-day-rec-[^-]+$/).map(e => e.getAttribute('data-testid'));
        expect(order).toEqual(['rf-day-rec-r1', 'rf-day-rec-r2']); // morning first
        expect(screen.getByTestId('rf-day-rec-r1-who')).toHaveTextContent(copy().you);
        expect(screen.getByTestId('rf-day-rec-r2-who')).toHaveTextContent('सुनील');
        const text = screen.getByTestId('rf-day').textContent ?? '';
        expect(text).toContain('₹400');
        expect(text).toContain('₹600');
        expect(text).not.toContain('1000');
        expect(text).not.toContain('5 जण');
        expect(emitClosureSummaryViewed).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-1', dateKey: TODAY_KEY, logsCount: 2, source: 'drawer_open' }));
    });

    it('nothing told: says so and offers to add the day\'s work (the old "Add Missing Entry"); back closes', () => {
        const onAdd = vi.fn();
        const onClose = vi.fn();
        render(<PlotDaySheet title="थॉम्पसन" dayLabel="x" dateKey={TODAY_KEY} recordings={[]} listen={listenWith('none')} onAdd={onAdd} onClose={onClose} />);
        expect(screen.getByTestId('rf-day-empty')).toHaveTextContent(copy().dayEmpty);
        fireEvent.click(screen.getByTestId('rf-day-add'));
        expect(onAdd).toHaveBeenCalled();
        expect(screen.getByTestId('rf-day-add')).toHaveTextContent(copy().addWork);
        fireEvent.click(screen.getByTestId('rf-day-back'));
        expect(onClose).toHaveBeenCalled();
        expect(screen.getByTestId('rf-day-back')).toHaveTextContent(copy().back);
    });
});

describe.each(['mr', 'en'] as const)('DayFeedSheet and its rows — the day\'s work (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);

    it('today: one row per recording with when / who / typed / status / what / where; products as chips; a row opens its glance', () => {
        const onOpen = vi.fn();
        const recs = recsOf([typed(), pruning(), spray()]);
        render(<DayFeedSheet recordings={recs} isToday dayLabel="today" listen={listenWith('none')} onOpen={onOpen} onClose={vi.fn()} />);
        expect(screen.getByTestId('rf-feed-title')).toHaveTextContent(copy().feedTitle(true));
        expect(screen.getAllByTestId(/^rf-feed-[a-z0-9]+$/).map(e => e.getAttribute('data-testid')).filter(id => ['rf-feed-m', 'rf-feed-s', 'rf-feed-t'].includes(id ?? '')))
            .toEqual(['rf-feed-m', 'rf-feed-s', 'rf-feed-t']);
        expect(screen.getByTestId('rf-feed-t-typed')).toHaveTextContent(resultCopy(language).typedTag);
        expect(screen.getByTestId('rf-feed-s-state')).toHaveTextContent(copy().confirmed);
        expect(screen.getByTestId('rf-feed-m-state')).toHaveTextContent(copy().notConfirmed);
        expect(screen.getByTestId('rf-feed-m-who')).toHaveTextContent(copy().you);
        expect(screen.getByTestId('rf-feed-m-work')).toHaveTextContent('छाटणी');
        expect(within(screen.getByTestId('rf-feed-s')).getByTestId('vr-product-chip')).toHaveTextContent('इथरेल');
        fireEvent.click(screen.getByTestId('rf-feed-s-open'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: recs[1].key }));
    });

    it('another day: its own title and empty line (never "today")', () => {
        render(<DayFeedSheet recordings={[]} isToday={false} dayLabel={copy().dayName(new Date(2026, 9, 21, 12), new Date(2026, 9, 25, 12))} listen={listenWith('none')} onOpen={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByTestId('rf-feed-title')).toHaveTextContent(copy().feedTitle(false));
        expect(screen.getByTestId('rf-feed-empty')).toHaveTextContent(copy().feedEmpty(false));
        expect(screen.getByTestId('rf-feed-date')).toHaveTextContent(language === 'en' ? 'Wednesday, 21 Oct' : 'बुधवार, 21 ऑक्टो');
    });

    it('the row\'s ▶ only for the clip on this phone; an older record keeps its old-entry line', () => {
        const [legacyRec] = recsOf([legacy()]);
        const { unmount } = render(<RecordingRow rec={legacyRec} listen={listenWith('none')} testId="row" onOpen={vi.fn()} />);
        expect(screen.getByTestId('row-legacy')).toHaveTextContent(resultCopy(language).legacyPartial);
        expect(screen.queryByTestId('row-play-listen')).toBeNull();
        unmount();
        render(<RecordingRow rec={recsOf([pruning()])[0]} listen={listenWith('clip')} testId="row" onOpen={vi.fn()} />);
        expect(screen.getByTestId('row-play-listen')).toBeInTheDocument();
    });

    it('the glance: everything understood from one recording, in his language, with back', () => {
        const onClose = vi.fn();
        const [rec] = recsOf([pruning()]);
        render(<GlanceSheet rec={rec} listen={listenWith('none')} onClose={onClose} />);
        expect(screen.getByTestId('rf-glance-m-understood')).toHaveTextContent('छाटणी');
        expect(screen.getByTestId('rf-glance-m-place')).toHaveTextContent('g1');
        fireEvent.click(screen.getByTestId('rf-glance-back'));
        expect(onClose).toHaveBeenCalled();
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
