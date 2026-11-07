/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
 * "दरपत्रक" — HIS FARM's own price and rate list, kept on the server (one permanent list per farm, with history).
 *
 * What it shows: every rate of the farm the server lets this person read — what it is for (कशासाठी), the rate per unit
 * or per day / hour / acre / trip / task, the kind (वस्तूचा भाव / कामाचा दर), for whom, the season and dates — and each
 * rate's history (who, when, old → new). A seat that does not read work rates (they are pay: see wages) gets the rule
 * line and "—", never ₹ 0; a seat without money never opens this page (the route shows the money rule instead, MU-3).
 *
 * Who writes: the farm's primary account holder (part A; the server's one gate decides, `/finance/farm-rates`
 * `mayWrite`). A change makes a NEW version and the old one stays in the history; "हा दर बंद करा" makes a stopped
 * version, never a deletion. Writes go through the outbox, so they work with no internet (P10): an unsent change says
 * so, and one the server refused says why in Marathi and stays on the phone.
 *
 * What it never does: rewrite a bill, a cost or a wage, or compute a wage (D-17). ShramSafal's shared list is offered
 * only as "ShramSafal सुचवलेला दर", to confirm into his own list.
 *
 * Replaced (lane RATE-1): the platform admin's write form for the SHARED list. It never kept a rate (its payload was
 * refused before the outbox — pre-flight T9) and the shared list keeps its own admin doors; showing it would be a control
 * that does nothing (P5).
 */
import React, { useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppRoute } from '../types';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { ChoiceChips, GlassCard, Tap } from '../shared/components/ui/placeUi';
import { useOptionalLanguage } from '../i18n/LanguageContext';
import { useOptionalFarmContext } from '../core/session/FarmContext';
import { backgroundSyncWorker } from '../infrastructure/sync/BackgroundSyncWorker';
import { SetFarmRateCommand, type SetFarmRateInput } from '../application/usecases/sync/SetFarmRateCommand';
import { farmRateWords, queuedRateLine } from '../features/finance/farmRates/farmRateWords';
import { useFarmRates } from '../features/finance/farmRates/useFarmRates';
import { linesOf, type FarmRateLine } from '../features/finance/farmRates/farmRateLines';
import { FarmRateCard } from '../features/finance/farmRates/FarmRateCard';
import { FarmRateForm, type FarmRateFormStart } from '../features/finance/farmRates/FarmRateForm';
import { RateOffers } from '../features/finance/farmRates/RateOffers';
import { perWhat, rateRupees } from '../features/finance/farmRates/farmRateFormat';
import type { FarmRateKind } from '../features/finance/farmRates/farmRateSchema';

interface PriceBookPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
    /** The farm open now (the router's active farm); else the farm context's. */
    farmId?: string | null;
    /** The role the server last told this phone (/me/context): stands in only until the server answers "may write". */
    isPrimaryHolder?: boolean;
    selfUserId?: string | null;
    operatorNameById?: ReadonlyMap<string, string>;
}

type Show = 'all' | FarmRateKind;

const PriceBookPage: React.FC<PriceBookPageProps> = ({
    currentRoute, onNavigate, onBack, farmId, isPrimaryHolder, selfUserId = null, operatorNameById,
}) => {
    const language = useOptionalLanguage()?.language ?? 'mr';
    const words = farmRateWords(language);
    const farmContext = useOptionalFarmContext();
    const farm = farmId ?? farmContext?.currentFarmId ?? null;
    const view = useFarmRates(farm, { isPrimaryHolder, selfUserId });
    const [show, setShow] = useState<Show>('all');
    const [form, setForm] = useState<{ start: FarmRateFormStart; changing: boolean } | null>(null);
    const [failed, setFailed] = useState(false);

    const lines = useMemo(() => linesOf(view.rows), [view.rows]);
    const shown = lines.filter(l => show === 'all' || l.current.kind === show);
    const showChips = [['all', words.all] as const, ['Input', words.kind.Input] as const, ['Work', words.kind.Work] as const];
    const nameOf = (userId: string) =>
        userId && userId === selfUserId ? words.you : operatorNameById?.get(userId) || undefined;

    const queue = (input: SetFarmRateInput) => {
        setFailed(false);
        SetFarmRateCommand.enqueue(input).then(
            () => {
                setForm(null);
                void backgroundSyncWorker.triggerNow();
                view.reload();
            },
            // Refused before it reached the outbox: said on screen, the form stays filled (nothing is lost).
            () => setFailed(true),
        );
    };

    const startChange = (line: FarmRateLine) => {
        const r = line.current;
        setForm({
            changing: true,
            start: {
                rateLineId: line.rateLineId, kind: r.kind, itemName: r.itemName, unit: r.unit ?? undefined, basis: r.basis,
                workerCategory: r.workerCategory ?? undefined, amount: r.amount, season: r.season ?? undefined,
                endsOn: r.endsOn ?? undefined,
            },
        });
    };

    const retire = (line: FarmRateLine) => {
        if (!farm) return;
        queue({ farmId: farm, rateLineId: line.rateLineId, change: 'retire' });
    };

    return (
        <MoneyPage title={words.title} backLabel={words.back} testId="fin-prices" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700" data-testid={view.mayWrite ? 'rate-intro' : 'rate-read-only'}>
                {view.mayWrite ? words.intro : words.readOnly}
            </p>
            <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-500" data-testid="rate-never-rewrites">{words.neverRewrites}</p>

            {/* fix round 1 (F1) — a seat that reads none of the farm's rates gets the ShramSafal rule, not the list. */}
            {view.seeInputPrices === false && (
                <GlassCard testId="rate-all-withheld">
                    <p className="m-0 text-[14px] font-bold text-stone-700">{words.allWithheld}</p>
                    <p className="m-0 mt-1 text-[15px] font-extrabold text-stone-500">{words.withheldAmount}</p>
                </GlassCard>
            )}

            {/* fix round 1 (F5) — rows this phone received and could not read are said, never silently missing. */}
            {(view.unreadable ?? 0) > 0 && (
                <p className="m-0 px-1 text-[13.5px] font-bold text-amber-800" role="status" data-testid="rate-unreadable">{words.unreadable}</p>
            )}

            {view.seeInputPrices !== false && <ChoiceChips items={showChips} value={show} onPick={setShow} testId="rate-show" />}

            {view.seeInputPrices !== false && view.seeWorkRates === false && (
                <GlassCard testId="rate-work-withheld">
                    <p className="m-0 text-[14px] font-bold text-stone-700">{words.workWithheld}</p>
                    <p className="m-0 mt-1 text-[15px] font-extrabold text-stone-500" data-testid="rate-work-withheld-amount">{words.withheldAmount}</p>
                </GlassCard>
            )}

            {view.queued.map(q => (
                <GlassCard key={q.payload.farmRateId} testId={`rate-queued-${q.payload.farmRateId}`}>
                    {q.payload.itemName && q.payload.amount !== undefined && q.payload.basis && q.payload.kind && (
                        <p className="m-0 text-[15px] font-extrabold text-stone-900">
                            {q.payload.itemName} — {rateRupees(q.payload.amount)} {perWhat({ kind: q.payload.kind, unit: q.payload.unit, basis: q.payload.basis }, words)}
                        </p>
                    )}
                    <p className={`m-0 mt-1 text-[13.5px] font-bold ${q.state === 'refused' ? 'text-rose-800' : 'text-stone-600'}`} role="status">
                        {queuedRateLine(q.state, q.errorCode, words)}
                    </p>
                </GlassCard>
            ))}

            {shown.map(line => (
                <FarmRateCard key={line.rateLineId} line={line} words={words} language={language} mayWrite={view.mayWrite}
                    nameOf={nameOf} onChange={startChange} onRetire={retire} />
            ))}
            {!view.loading && view.seeInputPrices !== false && shown.length === 0 && (
                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[14px] font-bold text-stone-500" data-testid="rate-empty">
                    {view.failed ? words.couldNotOpen : lines.length === 0 ? words.empty : words.emptyKind}
                </p>
            )}

            {view.mayWrite && farm && !form && (
                <>
                    <RateOffers words={words} language={language} suggestions={view.suggestions} drafts={view.drafts}
                        onTakeSuggestion={s => setForm({ changing: false, start: { itemName: s.itemName, amount: s.unitPrice, suggestionId: s.id } })}
                        onTakeDraft={d => setForm({ changing: false, start: { itemName: d.itemName, amount: d.amount, unit: d.unit, effectiveFrom: d.effectiveFrom } })} />
                    <Tap onClick={() => setForm({ changing: false, start: {} })} data-testid="rate-new"
                        className="flex min-h-[52px] w-full items-center justify-center rounded-full bg-emerald-700 text-[16px] font-extrabold text-white">
                        {words.newRate}
                    </Tap>
                </>
            )}
            {view.mayWrite && farm && form && (
                <FarmRateForm key={form.start.rateLineId ?? form.start.suggestionId ?? 'new'} farmId={farm} words={words}
                    start={form.start} changing={form.changing} newLineId={uuidv4} onSave={queue} onCancel={() => setForm(null)} />
            )}
            {failed && (
                <p className="m-0 text-center text-[14px] font-extrabold text-rose-800" role="alert" data-testid="rate-failed">{words.refusedOther}</p>
            )}
        </MoneyPage>
    );
};

export default PriceBookPage;
