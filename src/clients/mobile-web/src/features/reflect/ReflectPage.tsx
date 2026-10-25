/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3) — "पूर्ण शेतीचा आढावा" on real data.
 *
 * The founder-approved redesign (PLR-D9 preview), fed from the stores this page has always read: `history`
 * (the logs), `crops` (crops and plots), `tasks` (the planned-task store), the harvest + other-income stores,
 * and the farm's operators. Founder, 2026-10-25: keep every real part, fix their order, make reminders the
 * to-do list. So, top to bottom, in FIXED places (a section folds shut; it never moves):
 *
 *   आजचा आढावा button (today's records) · review inbox (verifiers, when something waits) · the whole-farm
 *   panel (today) → शेताची स्थिती (crop + plots: narrows every section below) → करायची कामे (tasks +
 *   reminders) → प्लॉटनिहाय काम (in-hand income, the day bar, one card per plot with the 8 colour-coded
 *   counts) → निरीक्षणं व नोंदी → कामाचं कॅलेंडर (week / month) → उत्पन्न आणि खर्च (+ the finance ledger).
 *
 * Gone on purpose: the ↑↓ block re-ordering (and its saved order). Where nothing was recorded the page says
 * so ("—", "नोंद नाही"); no number is invented (P4). The pure adapters live in `./overview/*Model.ts`.
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
import { emitClosureSummaryViewed } from '../../core/telemetry/eventEmitters';
import FarmWideTodayPanel from '../logs/components/FarmWideTodayPanel';
import { TodayActivityButton, TodayActivitySheet } from '../logs/components/TodayActivityFeed';
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
import { buildTodoList, mergeTasks, toggledTask, type TodoItem } from './overview/todoModel';
import { TodoCount, TodoSection } from './overview/TodoSection';
import { Num, SANS, SectionBlock } from './overview/ui';
import { useLogAttachmentCount } from './overview/useLogAttachmentCount';

// Used only when the caller passes no ledger defaults (the log drawer needs some). Unchanged.
const FALLBACK_DEFAULTS: LedgerDefaults = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: { defaultWage: 300, defaultHours: 8, shifts: [{ id: 's1', name: 'Full Day', defaultRateMale: 400, defaultRateFemale: 250 }] },
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
    // `onVerifyLog` is still declared on `ReflectPageProps` and still passed by `core/navigation/mainView.tsx`,
    // but nothing on this page calls it: its only consumer was `ReviewInbox`'s Approve button, removed because it
    // enqueued `verify_log_v2`, which the server answers with MUTATION_TYPE_UNIMPLEMENTED (see `ReviewInbox.tsx`).
    // Delete both together when approval is re-enabled or retired. spec: owner-oversight-loop
    currentOperator,
    operators = [],
    navigate,
    activityFeed,
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
    const selectedLogAttachmentCount = useLogAttachmentCount(selectedLog?.id);
    useEffect(() => { setShowSelectedLogAttachments(false); }, [selectedLog?.id]);

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

    return (
        <div className="space-y-3 pb-20" style={{ fontFamily: SANS }} data-testid="reflect-page">
            {/* ACTIVITY FEED — today's records, one button (founder 2026-10-24). */}
            {activityFeed && (
                <div className="px-3 pt-4">
                    <TodayActivityButton count={activityFeed.entries.length} onClick={() => setFeedOpen(true)} />
                </div>
            )}
            {activityFeed && feedOpen && (
                <TodayActivitySheet entries={activityFeed.entries} dateLabel={activityFeed.dateLabel} onClose={() => setFeedOpen(false)} />
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

            <div className="space-y-3 px-3">
                <SectionBlock id="status" title="शेताची स्थिती" icon={<LayoutGrid size={22} aria-hidden="true" />} tone="green" hint="कोणत्या पिकाचं, कोणत्या प्लॉटचं पाहायचं ते निवडा">
                    <FarmStatus crops={crops} sel={selection} onSel={setSel} />
                </SectionBlock>

                <SectionBlock id="todo" title="करायची कामे" icon={<ListChecks size={22} aria-hidden="true" />} tone="amber"
                    hint="कामं आणि आठवणी — वेळ उलटली की लाल" count={<TodoCount list={todoList} />}>
                    <TodoSection list={todoList} onToggle={toggleTask} onAdd={onAddTask} />
                </SectionBlock>

                <SectionBlock id="day" title="प्लॉटनिहाय काम" icon={<CalendarDays size={22} aria-hidden="true" />} tone="blue" hint={`${relLabel(date)} — प्रत्येक प्लॉटवर काय झालं`}>
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

                <SectionBlock id="notes" title="निरीक्षणं व नोंदी" icon={<StickyNote size={22} aria-hidden="true" />} tone="violet" hint={relLabel(date)}
                    count={countBadge(notes.length, 'bg-violet-100 text-violet-800', 'notes-count')}>
                    <NotesList notes={notes} />
                </SectionBlock>

                <SectionBlock id="calendar" title="कामाचं कॅलेंडर" icon={<CalendarRange size={22} aria-hidden="true" />} tone="green" hint="आठवडा किंवा महिना — रंग म्हणजे पीक">
                    <ActivityCalendar date={date} onDate={d => setDate(atNoon(d))} mode={calMode} onMode={setCalMode} view={calView} onView={setCalView} dayOf={dayOf} legendCrops={legendCrops} />
                </SectionBlock>

                <SectionBlock id="cost" title="उत्पन्न आणि खर्च" icon={<PieChart size={22} aria-hidden="true" />} tone="rose" hint="आतापर्यंतचा हिशोब आणि खर्चाचा आलेख">
                    <CostSection totals={money.totals} spend={money.spend} range={money.range} onOpenFinance={navigate ? () => navigate('finance-ledger') : undefined} />
                </SectionBlock>
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
