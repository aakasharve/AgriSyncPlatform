/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2 (CTO rulings, 27 Nov). ONE small card on Home on the
 * day the open farm reaches a stage (day 3, 7, 14, 18), built only from data the phone holds (P4). No separate screen pick:
 * it wears the Home's own calm-card look — the "नवीन आवृत्ती" card's (`AppUpdateCard`): a white card with a thin green edge, a
 * 44 px green icon tile, an 18 px title, the green pill and the white pill. The founder judges the look on the test app.
 *
 * It never blocks: it sits under the two big doors, is never louder than them, and closes for good with "बंद करा". Acting on
 * it closes it for good too. Each stage shows once per farm per phone (`shramsafal_farm_day_card_v1:<farm>` keeps the stages
 * answered); a phone past those days sees only the CURRENT stage's card, never a backlog. Only for an owner or co-owner seat
 * (the farm's own story, and its money only for a seat that may see it). Cards follow the open farm: its records, its day.
 * No price, no trial, no "days left", no plan words (founder, 27 Nov). D21 = nothing.
 */
import React, { useMemo } from 'react';
import { Sprout } from 'lucide-react';
import type { CropProfile, DailyLog, FarmOperator } from '../../types';
import { SANS, Tap } from '../../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { useUiPref } from '../../shared/hooks/useUiPref';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { toWelcomeRole } from '../onboarding/firstRun/roleWelcome';
import { usePlannedWork } from '../plannedWork/data/usePlannedWork';
import { isOpenTask } from '../plannedWork/planCardModel';
import { useApprovalQueue } from '../approval/useApprovalQueue';
import { openApprovalReview } from '../approval/openApprovalReview';
import { useMoneyLedger } from '../reflect/overview/useMoneyLedger';
import { buildSpend, type MoneyFigure } from '../reflect/overview/moneyModel';
import { currentStage, farmDayOf, type FarmDayStage } from './farmDayStage';
import { buildDayCard, cardDays, type DayCardInput, type DayCardModel } from './farmDaySummary';
import { farmDayWords } from './farmDayWords';
import { useFarmStartKey } from './useFarmStartKey';

/** The stages already answered on this phone for this farm (a per-farm mark; no row = none answered). */
export const farmDayCardKey = (farmId: string | null | undefined): string => `shramsafal_farm_day_card_v1:${farmId ?? 'none'}`;

export const FarmDayCardView: React.FC<{ model: DayCardModel; onAct: () => void; onClose: () => void }> = ({ model, onAct, onClose }) => {
    const words = farmDayWords(useOptionalLanguage()?.language);
    const titleId = `farm-day-card-title-${model.stage}`;
    return (
        <section aria-labelledby={titleId} data-testid="farm-day-card" data-stage={model.stage} style={{ fontFamily: SANS }}
            className="rounded-[28px] border border-emerald-200 bg-white/90 p-4 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)]">
            <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800">
                    <Sprout size={22} strokeWidth={2.4} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <p id={titleId} className="m-0 text-[18px] font-extrabold leading-tight text-stone-900" data-testid="farm-day-card-title">{words.title(model)}</p>
                    {model.lines.length > 0 && (
                        <ul className="m-0 mt-1.5 list-none space-y-1 p-0" data-testid="farm-day-card-lines">
                            {model.lines.map(line => (
                                <li key={line.kind} data-testid={`farm-day-line-${line.kind}`} className="text-[14px] font-semibold leading-snug text-stone-700">{words.line(line)}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <div className="mt-3 flex gap-2">
                <Tap onClick={onAct} data-testid="farm-day-card-open" rippleColor="rgba(255,255,255,0.35)"
                    className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-gradient-to-r from-emerald-700 to-emerald-500 px-4 text-[16px] font-extrabold text-white shadow">
                    {model.action === 'approvals' ? words.checkRecords : words.openOverview}
                </Tap>
                <Tap onClick={onClose} data-testid="farm-day-card-close"
                    className="min-h-[48px] shrink-0 rounded-full border border-stone-300 bg-white px-5 text-[16px] font-extrabold text-stone-700">
                    {words.close}
                </Tap>
            </div>
        </section>
    );
};

const WHOLE_FARM = { viewCrops: [] as string[], viewPlots: {} as Record<string, string[]> };

/** The spending recorded over the card's days, from the same ledger as आढावा (mounted only for a seat that may see money). */
const LedgerSpend: React.FC<{
    farmId: string; history: readonly DailyLog[]; crops: readonly CropProfile[]; fromKey: string; toKey: string;
    children: (spend: MoneyFigure | null) => React.ReactNode;
}> = ({ farmId, history, crops, fromKey, toKey, children }) => {
    // The page's records are the re-read key, as आढावा passes them (a new record re-reads the phone's ledger).
    const ledger = useMoneyLedger(farmId, history);
    const spend = useMemo(
        () => buildSpend(ledger, crops, WHOLE_FARM, { startKey: fromKey, endKey: toKey, bucket: 'daily', label: '' }, true).total,
        [ledger, crops, fromKey, toKey],
    );
    return <>{children(spend)}</>;
};

/** The work still open: the plan door's own count (only where the door shows the farm's count). */
const OpenTasks: React.FC<{ farmId: string; children: (n: number | null) => React.ReactNode }> = ({ farmId, children }) => {
    const { items, loaded } = usePlannedWork(farmId);
    return <>{children(loaded ? items.filter(isOpenTask).length : null)}</>;
};

/** Records waiting for his approval: the one approval list's count (`null` when unknown or he may not approve). */
const Approvals: React.FC<{ farmId: string; children: (n: number | null) => React.ReactNode }> = ({ farmId, children }) => {
    const queue = useApprovalQueue(farmId);
    return <>{children(queue.count)}</>;
};

export interface FarmDayCardHostProps {
    /** The open farm (FarmContext). */
    farmId: string | null;
    /** His role on it, as the server told this phone. */
    role: string | null;
    /** The open farm's records, crops and people (useAppData's read layer). */
    history: readonly DailyLog[];
    crops: readonly CropProfile[];
    people: readonly FarmOperator[];
    /** Who "he" is on this phone: his records and his row are not the team's. */
    activeOperatorId: string | null | undefined;
    userId: string | null | undefined;
    /** The farm's money may be shown to him (the cost card's own gate). */
    maySeeMoney: boolean;
    /** The plan door shows the farm's whole count to him (the primary owner, or a holder of PlanWork / AssignWork). */
    seesFarmPlan: boolean;
    /** Demo mode: sample records, so no day card. */
    demo?: boolean;
    /** Opens आढावा, on that day when one is given. */
    onOpenOverview: (dateKey: string | null) => void;
}

export const FarmDayCardHost: React.FC<FarmDayCardHostProps> = props => {
    const { farmId, role, demo, activeOperatorId, userId } = props;
    const kind = toWelcomeRole(role);
    const eligible = !demo && !!farmId && (kind === 'owner' || kind === 'coOwner');
    const startKey = useFarmStartKey(eligible ? farmId : null);
    const [answered, setAnswered, loaded] = useUiPref<string[]>(farmDayCardKey(farmId), []);
    const selfIds = useMemo(() => new Set([activeOperatorId, userId].filter((id): id is string => !!id)), [activeOperatorId, userId]);
    const todayKey = getDateKey();
    const stage = currentStage(farmDayOf(startKey, todayKey));
    const done = Array.isArray(answered) ? answered : [];
    if (!eligible || !farmId || !startKey || !stage || !loaded || done.includes(stage)) return null;

    const answer = () => setAnswered([...done, stage]);
    const base: DayCardInput = {
        stage, todayKey, startKey, history: props.history, selfIds,
        hasTeam: props.people.some(p => !selfIds.has(p.id) && p.isActive !== false),
        openTasks: null, approvals: null, spend: null,
    };
    const card = (input: DayCardInput) => {
        const model = buildDayCard(input);
        if (!model) return null;
        const act = () => {
            answer();
            if (model.action === 'approvals') openApprovalReview();
            else props.onOpenOverview(model.action === 'reflectDay' ? model.target?.dateKey ?? null : null);
        };
        return <FarmDayCardView model={model} onAct={act} onClose={answer} />;
    };
    const { fromKey, toKey } = cardDays(stage, startKey, todayKey);
    const withSpend = (render: (spend: MoneyFigure | null) => React.ReactNode) => (props.maySeeMoney
        ? <LedgerSpend farmId={farmId} history={props.history} crops={props.crops} fromKey={fromKey} toKey={toKey}>{render}</LedgerSpend>
        : <>{render(null)}</>);
    const byStage: Record<FarmDayStage, () => React.ReactNode> = {
        d3: () => card(base),
        d7: () => (props.seesFarmPlan
            ? <OpenTasks farmId={farmId}>{openTasks => withSpend(spend => card({ ...base, openTasks, spend }))}</OpenTasks>
            : withSpend(spend => card({ ...base, spend }))),
        d14: () => <Approvals farmId={farmId}>{approvals => card({ ...base, approvals })}</Approvals>,
        d18: () => withSpend(spend => card({ ...base, spend })),
    };
    return <React.Fragment key={`${farmId}:${stage}`}>{byStage[stage]()}</React.Fragment>;
};

export default FarmDayCardHost;
