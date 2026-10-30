/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3) — "पूर्ण शेतीचा आढावा" on real data.
 *
 * The founder-approved redesign (PLR-D9 preview), fed from the stores this page has always read: `history`
 * (the logs), `crops` (crops and plots), `tasks` (the planned-task store), the harvest store, and the farm's
 * operators. Founder, 2026-10-25: keep every real part, fix their order, make reminders the
 * to-do list. So, top to bottom, in this first-use order:
 *
 *   आजचा आढावा button (the day's records) · review inbox (verifiers, when something waits) · the whole-farm
 *   panel (today) → शेताची स्थिती (crop + plots: narrows every section below) → करायची कामे (tasks +
 *   reminders) → प्लॉटनिहाय काम (in-hand income, the day bar, one card per plot with the 8 colour-coded
 *   counts) → निरीक्षणं व नोंदी → कामाचं कॅलेंडर (week / month) → उत्पन्न आणि खर्च (+ the finance ledger).
 *
 * spec: plr-d10 (I22) — founder D-1: the आढावा strip (लक्ष द्या's preview, `AttentionStrip`) sits above the
 * sections, so what is urgent stays in sight whatever is folded. Founder D-4 (26 Oct, later than the 25 Oct
 * "fixed places"): remembered folds and section order are existing behaviour and come back
 * (`overview/useSectionLayout.ts`): first use opens शेताची स्थिती, करायची कामे and प्लॉटनिहाय काम and folds the
 * rest (their headers keep a count or a line); his folds and order are remembered after that; "क्रम बदला" moves
 * a section; शेताची स्थिती always stays first. A TEST build also shows the three-version comparison.
 * Where nothing was recorded the page says so ("—", "नोंद नाही"); no number is invented (P4). The pure adapters
 * live in `./overview/*Model.ts`.
 *
 * Lane RF (founder 2026-10-30: "a clarity of what work has been done, who has done it, when it was done, where you
 * can listen") — every piece of work on this page now reads the way the voice result screen reads it
 * (`./day/*`): the day's work button and its sheet FOLLOW THE CHOSEN DAY; each recording shows what was understood,
 * who ("तुम्ही" for the person holding this phone), when, typed or spoken, the ONE status wording, and ▶ only where it
 * may be offered; a note links to its recording; a plot card opens that plot's day in his language (the day part by
 * part, then every recording of it in time order — never a number summed across recordings), replacing the English
 * log drawer. The money section reads the SERVER's cost ledger (`overview/useMoneyLedger.ts`), never a log's own
 * total; money this person may not see is "—" (founder D-22), and a total made from an incomplete set says so.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, LayoutGrid, ListChecks, PieChart, StickyNote } from 'lucide-react';
import type { DailyLog } from '../../types';
import { LogVerificationStatus } from '../../types';
import ReviewInbox from '../analysis/components/ReviewInbox';
import { isWholeFarmSelection } from '../analysis/components/costAnalysisHelpers';
import { getHarvestSessions } from '../../services/harvestService';
import { MoneyLensDrawer } from '../finance/components/MoneyLensDrawer';
import type { FinanceFilters } from '../finance/finance.types';
import { mayShowFarmMoney } from '../labour/homeAttendanceDoor';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import { formatCurrencyINR } from '../../shared/utils/dayState';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { useFarmContext } from '../../core/session/FarmContext';
import { emitClosureSummaryViewed, emitNextActionCreated } from '../../core/telemetry/eventEmitters';
import FarmWideTodayPanel from '../logs/components/FarmWideTodayPanel';
import { TodayActivityButton } from '../logs/components/TodayActivityFeed';
import { getFarmWideDaySummary } from '../../app/helpers/appContentDailyCounts';
// The stylesheet this page has always loaded (the analysis cards are styled by it). Kept: lane RF only replaced the
// English log drawer, and nothing here proves no other analysis card still needs it.
import '../analysis/components/DailyWorkSummary.css';

import type { ReflectPageProps } from './ReflectPageProps';
import DwcReminderChip from './components/DwcReminderChip';
import { anyLog, dayRecordings, plotLogFilter, recordingOfLog, withMoneyShown, type DayRecording } from './day/dayRecordings';
import { DayFeedSheet, GlanceSheet, PlotDaySheet } from './day/DaySheets';
import type { Viewer } from './day/listenModel';
import { useReflectCopy } from './day/RecordingParts';
import { useDayListen } from './day/useDayListen';
import { ActivityCalendar, type CalendarMode } from './overview/ActivityCalendar';
import { buildCalendarDay } from './overview/calendarModel';
import { CostSection, InHandCard } from './overview/CostSection';
import { DayBar } from './overview/DayBar';
import { FarmStatus } from './overview/FarmStatus';
import { buildInHand, buildSeasonTotals, buildSpend, farmWideDayMoney, plotDayMoney, spendRange, type MoneyFigure } from './overview/moneyModel';
import { buildDayNotes } from './overview/notesModel';
import { NotesList } from './overview/NotesList';
import { buildPlotDayCard } from './overview/plotDayModel';
import { BucketKey, PlotDayCards } from './overview/PlotDayCards';
import { atNoon, fromDateKey, relLabel } from './overview/reflectDates';
import { isLogInScope, plotRefsInScope, selectAll, toViewScope, type PlotRef, type ReflectSelection } from './overview/reflectSelection';
import { buildTodoList, mergeTasks, newTodoTask, toggledTask, type NewTodo, type TodoItem } from './overview/todoModel';
import { TodoCount, TodoSection } from './overview/TodoSection';
import { Num, SANS, SectionBlock, Tap } from './overview/ui';
import { useMoneyLedger } from './overview/useMoneyLedger';
import { useSectionLayout } from './overview/useSectionLayout';
import { FIXED_FIRST, type SectionId } from './overview/sectionLayout';
import { LayoutPreviewSwitch } from './overview/LayoutPreviewSwitch';
import { AttentionStrip } from '../attention/components/AttentionStrip';


/** The edit form's starting point for a plot day nothing was told for (the old drawer's "Add Missing Entry"). */
const newEntryFor = (ref: PlotRef, dateKey: string): DailyLog => ({
    id: `new_${Date.now()}`,
    date: dateKey,
    context: {
        selection: [{
            cropId: ref.cropId,
            cropName: ref.cropName,
            selectedPlotIds: ref.plotId ? [ref.plotId] : [],
            selectedPlotNames: ref.plotName ? [ref.plotName] : [],
        }],
    },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
});

const ReflectPage: React.FC<ReflectPageProps> = ({
    history,
    crops,
    onEditLog,
    onOpenLog,
    tasks,
    onUpdateTask,
    onAddTask,
    onSaveTask,
    onTellTodo,
    // `onVerifyLog` is still declared on `ReflectPageProps` and still passed by `core/navigation/mainView.tsx`,
    // but nothing on this page calls it: its only consumer was `ReviewInbox`'s Approve button, removed because it
    // enqueued `verify_log_v2`, which the server answers with MUTATION_TYPE_UNIMPLEMENTED (see `ReviewInbox.tsx`).
    // Delete both together when approval is re-enabled or retired. spec: owner-oversight-loop
    currentOperator,
    operators = [],
    sessionUserId = null,
    farmRole = null,
    navigate,
    focusPlotId,
    onFocusPlotConsumed,
    onOpenAttention,
}) => {
    const { currentFarmId } = useFarmContext();
    const copy = useReflectCopy();

    // ── page state ──────────────────────────────────────────────────────────────────────────────
    const [sel, setSel] = useState<ReflectSelection | null>(null); // null = every crop, every plot
    const [date, setDate] = useState<Date>(() => atNoon(new Date()));
    const [calView, setCalView] = useState<Date>(() => atNoon(new Date()));
    const [calMode, setCalMode] = useState<CalendarMode>('week');
    const [feedOpen, setFeedOpen] = useState(false);
    const [glanceKey, setGlanceKey] = useState<string | null>(null);
    const [dayRef, setDayRef] = useState<PlotRef | null>(null);
    const [moneyLensOpen, setMoneyLensOpen] = useState(false);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters>({});
    const layout = useSectionLayout();
    const [reordering, setReordering] = useState(false);

    // spec plr-d10 (I14, H16) — लक्ष द्या's "तुकडा पहा": narrow the page to that one plot (its crop + the plot), once
    // the farm's crops are here; a plot this phone does not hold leaves the whole farm. Either way it is read once.
    useEffect(() => {
        if (!focusPlotId) return;
        const owner = crops.find(c => (c.plots ?? []).some(p => p.id === focusPlotId));
        if (!owner && crops.length === 0) return; // crops not loaded yet: wait for them
        if (owner) setSel({ crop: owner.id, plotIds: [focusPlotId] });
        onFocusPlotConsumed?.();
    }, [focusPlotId, crops, onFocusPlotConsumed]);

    // ── what the page shows (pure adapters over the real stores) ───────────────────────────────
    // a picked crop that is no longer on the farm falls back to everything, never to an empty page
    const selection = useMemo(
        () => (sel && (sel.crop === 'all' || crops.some(c => c.id === sel.crop)) ? sel : selectAll(crops)),
        [sel, crops],
    );
    const scope = useMemo(() => toViewScope(crops, selection), [crops, selection]);
    const wholeFarm = isWholeFarmSelection(crops, scope.viewCrops, scope.viewPlots);
    const dateKey = getDateKey(date);
    const todayKey = getDateKey();
    const isToday = dateKey === todayKey;

    // ── who is looking (lane RF): "तुम्ही", his money, his ▶ ────────────────────────────────────
    const moneyVisible = mayShowFarmMoney(farmRole);
    // "He said it" is the SIGNED-IN user only (review B001) — never the profile's active operator.
    const viewer = useMemo<Viewer>(() => ({ sessionUserId, farmRole, farmId: currentFarmId ?? null }), [sessionUserId, farmRole, currentFarmId]);
    const operatorNameById = useMemo(() => Object.fromEntries(operators.map(o => [o.id, o.name])), [operators]);
    const whoDeps = useMemo(() => ({
        youIds: new Set(sessionUserId ? [sessionUserId] : []), nameOf: (id: string) => operatorNameById[id], youLabel: copy.you, unknownLabel: copy.unknownPerson,
    }), [sessionUserId, operatorNameById, copy]);
    const shown = useCallback((r: DayRecording) => withMoneyShown(r, moneyVisible), [moneyVisible]);
    // The chosen day's recordings, farm-wide (the day's work sheet, the notes' links, the one player).
    const dayRecs = useMemo(() => dayRecordings(history, dateKey, anyLog, whoDeps, crops).map(shown), [history, dateKey, whoDeps, crops, shown]);
    const listen = useDayListen(dayRecs, viewer);
    const plotRecs = useMemo(
        () => (dayRef ? dayRecordings(history, dateKey, plotLogFilter(dayRef), whoDeps, crops).map(shown) : []),
        [dayRef, history, dateKey, whoDeps, crops, shown],
    );
    const glance = glanceKey ? dayRecs.find(r => r.key === glanceKey) : undefined;

    // ── money: the server's ledger (lane RF) ──────────────────────────────────────────────────
    const ledger = useMoneyLedger(currentFarmId ?? null, history);
    const money = useMemo(() => {
        const range = spendRange(calMode, date, calView);
        return {
            inHand: buildInHand(ledger, crops, scope, moneyVisible),
            totals: buildSeasonTotals(ledger, crops, scope, getHarvestSessions, moneyVisible),
            range,
            spend: buildSpend(ledger, crops, scope, range, moneyVisible),
        };
    }, [ledger, crops, scope, calMode, date, calView, moneyVisible]);

    const cards = useMemo(
        () => plotRefsInScope(crops, scope).map(ref => buildPlotDayCard(ref, history, scope, dateKey, date, plotDayMoney(ledger, ref.plotId, dateKey, moneyVisible))),
        [crops, scope, history, dateKey, date, ledger, moneyVisible],
    );
    const notes = useMemo(
        () => buildDayNotes({ history, dateKey, scope, crops, operatorNameById, whoDeps }),
        [history, dateKey, scope, crops, operatorNameById, whoDeps],
    );

    const todoList = useMemo(() => {
        const store = tasks ?? [];
        const fromLogs = history.filter(l => l.date === dateKey && isLogInScope(l, scope)).flatMap(l => l.plannedTasks ?? []);
        return buildTodoList({ tasks: mergeTasks(store, fromLogs), storeIds: new Set(store.map(t => t.id)), crops, scope, wholeFarm, todayKey });
    }, [tasks, history, dateKey, scope, crops, wholeFarm, todayKey]);
    const openTasks = useMemo(() => [...todoList.late, ...todoList.today, ...todoList.later].map(i => i.task), [todoList]);
    const dayOf = useCallback((d: Date) => buildCalendarDay({ date: d, history, crops, scope, dueTasks: openTasks }), [history, crops, scope, openTasks]);

    // ── trust inbox (verifiers only, when something waits) ─────────────────────────────────────
    const pendingLogs = history.filter(log => log.verification?.status === LogVerificationStatus.PENDING);
    const showInbox = pendingLogs.length > 0 && currentOperator?.isVerifier;

    // DWC v2 §2.8 #6 — closure_summary.viewed once on mount (+ farm resolution); date scrubbing does not re-emit.
    useEffect(() => {
        if (!currentFarmId) return;
        const key = getDateKey(date);
        emitClosureSummaryViewed({ farmId: currentFarmId, dateKey: key, logsCount: history.filter(l => l.date === key).length, source: 'reflect_mount' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFarmId]);

    // ── actions ────────────────────────────────────────────────────────────────────────────────
    const pickDay = (d: Date) => { setDate(atNoon(d)); setCalView(atNoon(d)); };
    const toggleTask = (t: TodoItem) => { if (t.canToggle) onUpdateTask?.(toggledTask(t.task)); };
    // spec plr-d10 (I14, T2) — a to-do typed in place: the one plot the page is narrowed to, else the whole farm.
    // Same record and the same `next_action.created` event the task sheet emits (`TaskCreationSheet.handleSave`).
    const addTodo = onSaveTask ? (todo: Omit<NewTodo, 'place'>) => {
        const refs = wholeFarm ? [] : plotRefsInScope(crops, scope);
        const only = refs.length === 1 && refs[0].plotId ? { plotId: refs[0].plotId, cropId: refs[0].cropId } : undefined;
        const task = newTodoTask({ ...todo, place: only }, todayKey, crypto.randomUUID());
        onSaveTask(task);
        if (currentFarmId) emitNextActionCreated({ farmId: currentFarmId, taskId: task.id });
    } : undefined;
    // The money lens for one plot's day, by the server's own place for money (the plot) — not the phone's crop label,
    // which the ledger's entries do not carry (they hold the crop SEASON). Only for money he may see.
    const openPlotMoney = moneyVisible ? (ref: PlotRef) => {
        setMoneyLensFilters({ fromDate: dateKey, toDate: dateKey, ...(ref.plotId ? { plotId: ref.plotId } : {}) });
        setMoneyLensOpen(true);
    } : undefined;
    const openLog = (log: DailyLog) => { listen.stop(); (onOpenLog ?? onEditLog)?.(log); };
    const openGlance = (rec: DayRecording) => { listen.stop(); setGlanceKey(rec.key); };
    const dayLabel = copy.dayName(date);

    const legendCrops = crops.filter(c => scope.viewCrops.includes(c.id)).map(c => ({ id: c.id, name: c.name, color: c.color }));
    const countBadge = (n: number, tone: string, testId: string) => (n > 0
        ? <span className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] font-extrabold ${tone}`} data-testid={testId}><Num>{n}</Num></span>
        : null);

    type Fold = { open: boolean; onToggle: () => void; reorder?: { onMoveUp?: () => void; onMoveDown?: () => void } };
    // One renderer per section id: the page draws them in the remembered order (founder D-4).
    const section = (id: SectionId, fold: Fold): React.ReactNode => {
        switch (id) {
            case 'status':
                return (
                    <SectionBlock id="status" title="शेताची स्थिती" icon={<LayoutGrid size={22} aria-hidden="true" />} tone="green" hint="कोणत्या पिकाचं, कोणत्या प्लॉटचं पाहायचं ते निवडा" {...fold}>
                        <FarmStatus crops={crops} sel={selection} onSel={setSel} />
                    </SectionBlock>
                );
            case 'todo':
                return (
                    <SectionBlock id="todo" title="करायची कामे" icon={<ListChecks size={22} aria-hidden="true" />} tone="amber"
                        hint="कामं आणि आठवणी — वेळ उलटली की लाल" count={<TodoCount list={todoList} />} {...fold}>
                        <TodoSection list={todoList} onToggle={toggleTask} onAdd={onAddTask} onAddTodo={addTodo} onTell={onTellTodo} />
                    </SectionBlock>
                );
            case 'day':
                return (
                    <SectionBlock id="day" title="प्लॉटनिहाय काम" icon={<CalendarDays size={22} aria-hidden="true" />} tone="blue" hint={`${relLabel(date)} — प्रत्येक प्लॉटवर काय झालं`} {...fold}>
                        <div className="space-y-3">
                            <InHandCard figure={money.inHand} onOpen={navigate ? () => navigate('income') : undefined} />
                            {/* DWC v2 §2.9 — renders nothing unless FEATURE_FLAGS.DwcChip is on. */}
                            {currentFarmId && <DwcReminderChip farmId={currentFarmId} history={history} />}
                            <DayBar date={date} onDate={pickDay} />
                            {cards.length > 0
                                ? <PlotDayCards cards={cards} isToday={isToday} onOpen={ref => { listen.stop(); setDayRef(ref); }} onCost={openPlotMoney} />
                                : <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="plot-cards-empty">पीक आणि प्लॉट जोडले की इथे रोजचं काम दिसेल.</p>}
                        </div>
                        <BucketKey />
                    </SectionBlock>
                );
            case 'notes':
                return (
                    <SectionBlock id="notes" title="निरीक्षणं व नोंदी" icon={<StickyNote size={22} aria-hidden="true" />} tone="violet" hint={relLabel(date)}
                        count={countBadge(notes.length, 'bg-violet-100 text-violet-800', 'notes-count')} {...fold}>
                        <NotesList notes={notes} sources={{ recordingOf: logId => recordingOfLog(dayRecs, logId), listen, onOpen: openGlance }} />
                    </SectionBlock>
                );
            case 'calendar':
                return (
                    <SectionBlock id="calendar" title="कामाचं कॅलेंडर" icon={<CalendarRange size={22} aria-hidden="true" />} tone="green" hint="आठवडा किंवा महिना — रंग म्हणजे पीक" {...fold}>
                        <ActivityCalendar date={date} onDate={d => setDate(atNoon(d))} mode={calMode} onMode={setCalMode} view={calView} onView={setCalView} dayOf={dayOf} legendCrops={legendCrops} />
                    </SectionBlock>
                );
            case 'cost':
                return (
                    <SectionBlock id="cost" title="उत्पन्न आणि खर्च" icon={<PieChart size={22} aria-hidden="true" />} tone="rose" hint="आतापर्यंतचा हिशोब आणि खर्चाचा आलेख" {...fold}>
                        <CostSection totals={money.totals} spend={money.spend} range={money.range} onOpenFinance={navigate ? () => navigate('finance-ledger') : undefined} />
                    </SectionBlock>
                );
        }
    };

    return (
        <div className="space-y-3 pb-20" style={{ fontFamily: SANS }} data-testid="reflect-page">
            {/* THE DAY'S WORK — one button; it follows the day the page is on (lane RF). */}
            <div className="px-3 pt-4">
                <TodayActivityButton count={dayRecs.length} title={copy.feedTitle(isToday)} subtitle={copy.feedSubtitle(isToday, dayLabel)} onClick={() => setFeedOpen(true)} />
            </div>
            {feedOpen && (
                <DayFeedSheet recordings={dayRecs} isToday={isToday} dayLabel={dayLabel} listen={listen} onOpen={openGlance} onClose={() => setFeedOpen(false)} />
            )}

            {/* REVIEW INBOX (Trust Layer 2) — a read surface; visible only to a verifier when something waits. */}
            {showInbox && (
                <div className="px-3">
                    <ReviewInbox pendingLogs={pendingLogs} operators={operators} onViewLog={log => pickDay(fromDateKey(log.date))} />
                </div>
            )}

            {/* LABOUR_PHASE2 P2.4 — the whole-farm day. Only when the chosen day IS today: its line reads "आज: …". */}
            {isToday && (
                <div className="px-3">
                    {/* Review B004 — its money is the server ledger's whole-farm spend that day, for whoever may see
                        money; "—" otherwise. Never the records' own totals. */}
                    <FarmWideTodayPanel summary={getFarmWideDaySummary(history, dateKey)} cost={panelCost(farmWideDayMoney(ledger, dateKey, moneyVisible), copy.partialTag)} />
                </div>
            )}

            {/* spec: plr-d10 (I22, D-1) — लक्ष द्या's preview: the most urgent item and the count; a tap opens it. */}
            {onOpenAttention && (
                <div className="px-3">
                    <AttentionStrip tasks={tasks} crops={crops} onOpen={onOpenAttention} />
                </div>
            )}

            <div className="space-y-3 px-3">
                {layout.preview && (
                    <LayoutPreviewSwitch version={layout.version} onVersion={layout.preview.setVersion} onFirstVisit={layout.preview.resetFirstVisit} />
                )}
                {[FIXED_FIRST, ...layout.order].map(id => {
                    const at = layout.order.indexOf(id);
                    const reorder = reordering && layout.move && id !== FIXED_FIRST ? {
                        onMoveUp: at > 0 ? () => layout.move!(id, -1) : undefined,
                        onMoveDown: at < layout.order.length - 1 ? () => layout.move!(id, 1) : undefined,
                    } : undefined;
                    return <React.Fragment key={id}>{section(id, { open: layout.isOpen(id), onToggle: () => layout.toggle(id), reorder })}</React.Fragment>;
                })}
                {layout.move && (
                    <Tap onClick={() => setReordering(r => !r)} aria-pressed={reordering} data-testid="reflect-reorder-toggle"
                        className="flex min-h-[46px] w-full items-center justify-center rounded-full border-2 border-stone-300 bg-white/80 text-[14.5px] font-extrabold text-stone-700">
                        {/* PROPOSED (Marathi) */}
                        {reordering ? 'क्रम झाला' : 'विभागांचा क्रम बदला'}
                    </Tap>
                )}
            </div>

            {/* A PLOT'S DAY (lane RF) — replaces the English log drawer. */}
            {dayRef && (
                <PlotDaySheet
                    title={[dayRef.plotName, dayRef.cropName].filter(Boolean).join(' · ')}
                    subtitle={seasonDayOf(dayRef, date, copy.seasonDay)}
                    dayLabel={dayLabel}
                    dateKey={dateKey}
                    recordings={plotRecs}
                    listen={listen}
                    onEdit={onOpenLog || onEditLog ? openLog : undefined}
                    onAdd={onEditLog ? () => { setDayRef(null); onEditLog(newEntryFor(dayRef, dateKey)); } : undefined}
                    onClose={() => setDayRef(null)}
                />
            )}

            {/* ONE RECORDING (the feed's and the notes' glance). */}
            {glance && <GlanceSheet rec={glance} listen={listen} onEdit={onOpenLog || onEditLog ? openLog : undefined} onClose={() => setGlanceKey(null)} />}

            <MoneyLensDrawer isOpen={moneyLensOpen} onClose={() => setMoneyLensOpen(false)} filters={moneyLensFilters} />
        </div>
    );
};

/** The whole-farm panel's cost, as the ledger has it ("—" when there is none, or it is not his to see). */
function panelCost(figure: MoneyFigure, partialTag: string): string {
    if (figure.amount === null) return '—';
    const amount = formatCurrencyINR(figure.amount);
    return figure.partial.length > 0 ? `${amount} (${partialTag})` : amount;
}

/** The day of the plot's season (the old drawer's timeline), when the plot is in one. */
function seasonDayOf(ref: PlotRef, date: Date, word: (n: number) => string): string | undefined {
    const plot = ref.plot ?? ref.crop.plots?.[0];
    if (!plot) return undefined;
    const t = getPhaseAndDay(plot, date);
    return t.phase === 'CROP_CYCLE' && t.day != null ? word(t.day) : undefined;
}

export default ReflectPage;
