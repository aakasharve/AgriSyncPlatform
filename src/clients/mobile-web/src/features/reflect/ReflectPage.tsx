/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3) — "पूर्ण शेतीचा आढावा" on real data.
 *
 * The founder-approved redesign (PLR-D9 preview), fed from the stores this page has always read: `history`
 * (the logs), `crops` (crops and plots), `tasks` (the planned-task store), the harvest + other-income stores,
 * and the farm's operators. Founder, 2026-10-25: keep every real part, fix their order, make reminders the
 * to-do list. So, top to bottom, in this first-use order:
 *
 *   आजचा आढावा button (today's records) · review inbox (verifiers, when something waits) · the whole-farm
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
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, LayoutGrid, ListChecks, PieChart, StickyNote } from 'lucide-react';
import type { CropProfile, DailyLog, LedgerDefaults, Plot } from '../../types';
import { LogVerificationStatus } from '../../types';
import ReviewInbox from '../analysis/components/ReviewInbox';
import { isWholeFarmSelection } from '../analysis/components/costAnalysisHelpers';
import { getHarvestSessions, getOtherIncomeEntries } from '../../services/harvestService';
import { MoneyLensDrawer } from '../finance/components/MoneyLensDrawer';
import type { FinanceFilters } from '../finance/finance.types';
import { useAttachmentRetry } from '../attachments';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { useFarmContext } from '../../core/session/FarmContext';
import { emitClosureSummaryViewed, emitNextActionCreated } from '../../core/telemetry/eventEmitters';
import FarmWideTodayPanel from '../logs/components/FarmWideTodayPanel';
import { TodayActivityButton } from '../logs/components/TodayActivityFeed';
// PLR-D10 I13 (LP-24, V-5) — the same sheet, with each card's recording (when on this phone) and its glance.
import { TodayActivityClipsSheet } from '../logs/components/voiceResult/ClipGlance';
import { getFarmWideDaySummary } from '../../app/helpers/appContentDailyCounts';
// The ONLY import of this stylesheet in the app: the event cards inside the log drawer (and the cost
// summary card) are styled by it. It stays with the page that always loaded it.
import '../analysis/components/DailyWorkSummary.css';

import type { ReflectPageProps } from './ReflectPageProps';
import { getLogForDate, getLogForSpecificPlot } from './helpers';
import LogDetailDrawer from './sections/LogDetailDrawer';
import DwcReminderChip from './components/DwcReminderChip';
import { ActivityCalendar, type CalendarMode } from './overview/ActivityCalendar';
import { buildCalendarDay } from './overview/calendarModel';
import { CostSection, InHandCard } from './overview/CostSection';
import { DayBar } from './overview/DayBar';
import { FarmStatus } from './overview/FarmStatus';
import { buildInHand, buildSeasonTotals, buildSpend, spendRange, type IncomeSources } from './overview/moneyModel';
import { buildDayNotes } from './overview/notesModel';
import { NotesList } from './overview/NotesList';
import { buildPlotDayCard } from './overview/plotDayModel';
import { BucketKey, PlotDayCards } from './overview/PlotDayCards';
import { atNoon, fromDateKey, relLabel } from './overview/reflectDates';
import { isLogInScope, plotRefsInScope, selectAll, toViewScope, type PlotRef, type ReflectSelection } from './overview/reflectSelection';
import { buildTodoList, mergeTasks, newTodoTask, toggledTask, type NewTodo, type TodoItem } from './overview/todoModel';
import { TodoCount, TodoSection } from './overview/TodoSection';
import { Num, SANS, SectionBlock, Tap } from './overview/ui';
import { useSectionLayout } from './overview/useSectionLayout';
import { FIXED_FIRST, type SectionId } from './overview/sectionLayout';
import { LayoutPreviewSwitch } from './overview/LayoutPreviewSwitch';
import { AttentionStrip } from '../attention/components/AttentionStrip';
import { useLogAttachmentCount } from './overview/useLogAttachmentCount';

// Used only when the caller passes no ledger defaults (the log drawer needs some). Unchanged.
const FALLBACK_DEFAULTS: LedgerDefaults = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: { defaultHours: 8, shifts: [{ id: 's1', name: 'Full Day' }] },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
};

interface EmptySelection { date: Date; crop: CropProfile; plot?: Plot; plotName?: string }

const ReflectPage: React.FC<ReflectPageProps> = ({
    history,
    crops,
    ledgerDefaults,
    onEditLog,
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
    navigate,
    activityFeed,
    focusPlotId,
    onFocusPlotConsumed,
    onOpenAttention,
}) => {
    const defaults = ledgerDefaults || FALLBACK_DEFAULTS;
    const { currentFarmId } = useFarmContext();

    // ── page state ──────────────────────────────────────────────────────────────────────────────
    const [sel, setSel] = useState<ReflectSelection | null>(null); // null = every crop, every plot
    const [date, setDate] = useState<Date>(() => atNoon(new Date()));
    const [calView, setCalView] = useState<Date>(() => atNoon(new Date()));
    const [calMode, setCalMode] = useState<CalendarMode>('week');
    const [feedOpen, setFeedOpen] = useState(false);
    const [selectedLog, setSelectedLog] = useState<DailyLog | null>(null);
    const [emptySelection, setEmptySelection] = useState<EmptySelection | null>(null);
    const [showSelectedLogAttachments, setShowSelectedLogAttachments] = useState(false);
    const [moneyLensOpen, setMoneyLensOpen] = useState(false);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters>({});
    const { retryUpload } = useAttachmentRetry();
    const layout = useSectionLayout();
    const [reordering, setReordering] = useState(false);
    const selectedLogAttachmentCount = useLogAttachmentCount(selectedLog?.id);
    useEffect(() => { setShowSelectedLogAttachments(false); }, [selectedLog?.id]);

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

    const cards = useMemo(
        () => plotRefsInScope(crops, scope).map(ref => buildPlotDayCard(ref, history, scope, dateKey, date)),
        [crops, scope, history, dateKey, date],
    );
    const operatorNameById = useMemo(() => Object.fromEntries(operators.map(o => [o.id, o.name])), [operators]);
    const notes = useMemo(() => buildDayNotes({ history, dateKey, scope, crops, operatorNameById }), [history, dateKey, scope, crops, operatorNameById]);

    const todoList = useMemo(() => {
        const store = tasks ?? [];
        const fromLogs = history.filter(l => l.date === dateKey && isLogInScope(l, scope)).flatMap(l => l.plannedTasks ?? []);
        return buildTodoList({ tasks: mergeTasks(store, fromLogs), storeIds: new Set(store.map(t => t.id)), crops, scope, wholeFarm, todayKey });
    }, [tasks, history, dateKey, scope, crops, wholeFarm, todayKey]);
    const openTasks = useMemo(() => [...todoList.late, ...todoList.today, ...todoList.later].map(i => i.task), [todoList]);
    const dayOf = useCallback((d: Date) => buildCalendarDay({ date: d, history, crops, scope, dueTasks: openTasks }), [history, crops, scope, openTasks]);

    const money = useMemo(() => {
        const sources: IncomeSources = { sessionsFor: getHarvestSessions, otherIncome: getOtherIncomeEntries() };
        const range = spendRange(calMode, date, calView);
        return {
            inHand: buildInHand(scope, sources),
            totals: buildSeasonTotals(history, crops, scope, sources),
            range,
            spend: buildSpend(history, crops, scope, range),
        };
    }, [scope, history, crops, calMode, date, calView]);

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
    const openLogMoneyLens = (log: DailyLog) => {
        const first = log.context.selection?.[0];
        setMoneyLensFilters({
            fromDate: log.date,
            toDate: log.date,
            cropId: first?.cropId === 'FARM_GLOBAL' ? undefined : first?.cropId,
            plotId: first?.selectedPlotIds?.[0],
        });
        setMoneyLensOpen(true);
    };
    const openCard = (ref: PlotRef) => {
        const log = ref.plotId
            ? getLogForSpecificPlot(history, dateKey, ref.cropId, ref.plotId)
            : getLogForDate(history, dateKey, ref.cropId, scope.viewPlots);
        if (log) { setSelectedLog(log); setEmptySelection(null); return; }
        setSelectedLog(null);
        setEmptySelection({ crop: ref.crop, date: fromDateKey(dateKey), plotName: ref.plotName, plot: ref.plot });
    };

    const detailInfo = (() => {
        if (selectedLog) {
            const context = selectedLog.context.selection[0];
            const c = crops.find(x => x.id === context.cropId);
            const p = c?.plots.find(x => x.id === context.selectedPlotIds[0]) || c?.plots[0];
            return {
                cropName: context.cropName,
                plotName: context.selectedPlotNames.length > 0 ? context.selectedPlotNames.join(', ') : 'सर्व प्लॉट',
                icon: c?.iconName || 'Sprout',
                timeline: getPhaseAndDay(p, selectedLog.date),
                date: fromDateKey(selectedLog.date),
                cropColor: c?.color || 'bg-slate-500',
            };
        }
        if (emptySelection) {
            const c = emptySelection.crop;
            return {
                cropName: c.name,
                plotName: emptySelection.plotName || 'मुख्य शेत',
                icon: c.iconName,
                timeline: getPhaseAndDay(emptySelection.plot || c.plots[0], emptySelection.date),
                date: emptySelection.date,
                cropColor: c.color,
            };
        }
        return null;
    })();

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
                            <InHandCard amount={money.inHand} onOpen={navigate ? () => navigate('income') : undefined} />
                            {/* DWC v2 §2.9 — renders nothing unless FEATURE_FLAGS.DwcChip is on. */}
                            {currentFarmId && <DwcReminderChip farmId={currentFarmId} history={history} />}
                            <DayBar date={date} onDate={pickDay} />
                            {cards.length > 0
                                ? <PlotDayCards cards={cards} isToday={isToday} onOpen={openCard} onCost={openLogMoneyLens} />
                                : <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="plot-cards-empty">पीक आणि प्लॉट जोडले की इथे रोजचं काम दिसेल.</p>}
                        </div>
                        <BucketKey />
                    </SectionBlock>
                );
            case 'notes':
                return (
                    <SectionBlock id="notes" title="निरीक्षणं व नोंदी" icon={<StickyNote size={22} aria-hidden="true" />} tone="violet" hint={relLabel(date)}
                        count={countBadge(notes.length, 'bg-violet-100 text-violet-800', 'notes-count')} {...fold}>
                        <NotesList notes={notes} />
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
            {/* ACTIVITY FEED — today's records, one button (founder 2026-10-24). */}
            {activityFeed && (
                <div className="px-3 pt-4">
                    <TodayActivityButton count={activityFeed.entries.length} onClick={() => setFeedOpen(true)} />
                </div>
            )}
            {activityFeed && feedOpen && (
                <TodayActivityClipsSheet entries={activityFeed.entries} dateLabel={activityFeed.dateLabel} onClose={() => setFeedOpen(false)} />
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
                    <FarmWideTodayPanel summary={getFarmWideDaySummary(history, dateKey)} />
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

            {(selectedLog || emptySelection) && detailInfo && (
                <LogDetailDrawer
                    selectedLog={selectedLog}
                    emptySelection={emptySelection}
                    detailInfo={detailInfo}
                    defaults={defaults}
                    selectedLogAttachmentCount={selectedLogAttachmentCount}
                    showSelectedLogAttachments={showSelectedLogAttachments}
                    setShowSelectedLogAttachments={setShowSelectedLogAttachments}
                    retryUpload={retryUpload}
                    onClose={() => { setSelectedLog(null); setEmptySelection(null); }}
                    onEditLog={onEditLog}
                />
            )}

            <MoneyLensDrawer isOpen={moneyLensOpen} onClose={() => setMoneyLensOpen(false)} filters={moneyLensFilters} />
        </div>
    );
};

export default ReflectPage;
