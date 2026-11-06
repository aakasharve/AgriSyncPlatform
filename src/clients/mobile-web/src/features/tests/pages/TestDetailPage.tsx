/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — one test (route 'test-detail', opened
 * by a card's "निकाल पहा"), in the चाचण्या look: one title bar with the big मागे, then what / where / when
 * and its state, the results, the lab report, and the suggestions. It was English ("Results / Param / Value /
 * In range / Lab reports / Recommendations / Add to plan / Test not found / Back"). Every real part is kept
 * (CEI Phase 2 §4.5 task 4.2.3):
 *   - this phone's copy first (offline-safe), then the server's fresh copy, written back to the phone;
 *   - each recorded result with its value, unit and reference range, and whether it is ठीक / कमी / जास्त
 *     (the old "Out" now says which way);
 *   - the lab report files linked to this test (the shared `AttachmentList`, tap to preview);
 *   - each suggestion with "योजनेत घाला" → the real `addRecommendationToPlan`, then "योजनेत घातलं".
 * Honest gaps, said plainly instead of a false "none": the server's test record carries no result values
 * (only a count, which the client does not keep), so a reported test says the app does not show its numbers
 * and points to the lab report — rather than "no results recorded yet", and without promising they will
 * come; and suggestions exist on the phone only after a result is saved from it, so an empty list is not
 * drawn as "no suggestions". A failed "योजनेत घाला" says no-permission (403) or try-again in Marathi
 * (`failureWords`, review B003). Read-mostly: changing a test's state happens from the list's sheets.
 * spec: plr-d10 lane L8b-1 fix round 1 (review L1; founder D-73) — "योजनेत घाला" plans work, which the server allows only to
 * the primary owner and the people he gives "कामाचं नियोजन करणे" (PlanWork): a seat without it sees the suggestions and no
 * button (P5: never a button that cannot work).
 * Server words (test, stage, parameter codes) are shown as they come.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Check, FlaskConical } from 'lucide-react';
import {
    getDatabase,
    type DexieTestInstance,
    type DexieTestProtocol,
    type DexieTestRecommendation,
    type DexieTestResult,
} from '../../../infrastructure/storage/DexieDatabase';
import { getTestInstanceById, addRecommendationToPlan } from '../data/testsClient';
import AttachmentList from '../../attachments/components/AttachmentList';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { BigButton, Chip, GlassCard, IconDot, PageBar, SANS, SectionHead } from '../../../shared/components/ui/placeUi';
import { StateChip } from '../components/TestInstanceCard';
import {
    STATE_VIEW, VERDICT_VIEW, addDaysToKey, failureWords, formatDayKey, kindLine, offsetWords, plotNamesFrom, rangeVerdict,
    stateOf, testName, whenLine, whereLine,
} from '../components/testView';

/**
 * A reported test's numbers. The server's test record carries no result values (`TestInstanceDto` has only
 * `ResultCount`) and nothing on the phone ever writes them, so this must not promise they will appear later
 * (it said "अजून" — "not yet"). Saving a result requires the lab report file, so that is where they are.
 */
const NUMBERS_NOT_SHOWN = 'निकाल नोंदवला आहे. त्याचे आकडे हे ॲप दाखवत नाही — ते लॅबच्या रिपोर्टमध्ये पाहा.';

interface TestDetailPageProps {
    testInstanceId: string;
    onBack: () => void;
    /** This seat holds "कामाचं नियोजन करणे" (PlanWork) on the current farm (lane L8b-1 fix round 1, L1). */
    mayPlanWork: boolean;
}

const TestDetailPage: React.FC<TestDetailPageProps> = ({ testInstanceId, onBack, mayPlanWork }) => {
    const [instance, setInstance] = useState<DexieTestInstance | null>(null);
    const [protocol, setProtocol] = useState<DexieTestProtocol | null>(null);
    const [plotName, setPlotName] = useState<string | undefined>(undefined);
    const [recommendations, setRecommendations] = useState<DexieTestRecommendation[]>([]);
    const [plannedRecIds, setPlannedRecIds] = useState<Set<string>>(new Set());
    const [planningRecId, setPlanningRecId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const db = getDatabase();

            // 1) Dexie hydration (offline-safe)
            const cached = await db.testInstances.get(testInstanceId);
            if (cached) {
                setInstance(cached);
                const proto = await db.testProtocols.get(cached.testProtocolId);
                setProtocol(proto ?? null);
            }
            const cachedRecs = await db.testRecommendations
                .where('testInstanceId').equals(testInstanceId)
                .toArray();
            setRecommendations(cachedRecs);

            // 2) Server refresh
            let current = cached ?? null;
            try {
                const fresh = await getTestInstanceById(testInstanceId);
                setInstance(fresh);
                current = fresh;
                await db.testInstances.put(fresh);
                const proto = await db.testProtocols.get(fresh.testProtocolId);
                setProtocol(proto ?? null);
            } catch {
                // offline or transient — keep the cached render
            }

            // 3) The farm's own name for the plot, when this phone has it.
            if (current) {
                try {
                    const plot = await db.plots.get(current.plotId);
                    setPlotName(plot ? plotNamesFrom([plot])[plot.id] : undefined);
                } catch {
                    /* no name: the stage and the date still say which test this is */
                }
            }
        } catch {
            setError('ही चाचणी उघडता आली नाही.');
        } finally {
            setIsLoading(false);
        }
    }, [testInstanceId]);

    useEffect(() => { void load(); }, [load]);

    const todayKey = getDateKey();

    const handleAddToPlan = async (rec: DexieTestRecommendation) => {
        if (!instance || planningRecId) return;
        setPlanningRecId(rec.id);
        setError(null);
        try {
            await addRecommendationToPlan({
                cropCycleId: instance.cropCycleId,
                farmId: instance.farmId,
                activityName: rec.suggestedActivityName,
                stage: instance.stageName,
                plannedDate: addDaysToKey(todayKey, rec.suggestedOffsetDays),
                reason: `From test recommendation ${rec.ruleCode}`,
            });
            setPlannedRecIds(prev => {
                const next = new Set(prev);
                next.add(rec.id);
                return next;
            });
        } catch (e) {
            setError(failureWords(e, 'योजनेत घालता आलं नाही. पुन्हा प्रयत्न करा.'));
        } finally {
            setPlanningRecId(null);
        }
    };

    const shell = (body: React.ReactNode) => (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6" style={{ fontFamily: SANS }} data-testid="test-detail-page">
            <PageBar title="चाचणी" onBack={onBack} />
            {body}
        </div>
    );

    if (isLoading && !instance) {
        return shell(<p className="m-0 p-6 text-center text-[15px] font-bold text-stone-500" data-testid="test-detail-loading">चाचणी उघडत आहे…</p>);
    }

    if (!instance) {
        return shell(
            <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[15px] font-bold text-stone-600" data-testid="test-detail-missing">
                {error ?? 'ही चाचणी सापडली नाही.'}
            </p>,
        );
    }

    const state = stateOf(instance.status) ?? 'due';
    const name = testName(instance, protocol ?? undefined);
    const kind = kindLine(instance, name);
    const where = whereLine(instance, plotName);
    const when = whenLine(instance, todayKey);

    return shell(
        <div className="space-y-3">
            <GlassCard testId="test-detail-head">
                <div className="flex items-start gap-3">
                    <IconDot tone={STATE_VIEW[state].tone}><FlaskConical size={22} aria-hidden="true" /></IconDot>
                    <div className="min-w-0 flex-1">
                        <p className="m-0 text-[17px] font-extrabold leading-snug text-stone-900">{name}</p>
                        {kind && <p className="m-0 text-[12.5px] font-bold text-stone-500">{kind}</p>}
                        {where && <p className="m-0 text-[13.5px] font-semibold text-stone-600">{where}</p>}
                        {when && <p className="m-0 text-[13.5px] font-semibold text-stone-600">{when}</p>}
                    </div>
                    <StateChip state={state} />
                </div>
            </GlassCard>

            {error && (
                <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] font-extrabold text-rose-700 ring-1 ring-rose-200" data-testid="test-detail-error">
                    {error}
                </p>
            )}

            <SectionHead title="निकाल" />
            {instance.results.length === 0 ? (
                <p className="m-0 rounded-2xl bg-white/70 p-4 text-[14px] font-bold leading-snug text-stone-600" data-testid="test-detail-no-results">
                    {state === 'reported'
                        ? NUMBERS_NOT_SHOWN
                        : 'अजून निकाल आलेला नाही.'}
                </p>
            ) : (
                <div className="space-y-2" data-testid="test-detail-results">
                    {instance.results.map((r, i) => <ResultRow key={`${r.parameterCode}-${i}`} result={r} />)}
                </div>
            )}

            <SectionHead title="लॅबचा रिपोर्ट" hint="निकाल नोंदवताना जोडलेली फाइल — ज्या फोनवरून जोडली त्यावर दिसते." />
            <AttachmentList linkedEntityId={instance.id} />

            {recommendations.length > 0 && (
                <>
                    <SectionHead title="सल्ला" hint={mayPlanWork ? 'निकालावरून सुचवलेली कामं — योजनेत घाला.' : 'निकालावरून सुचवलेली कामं.'} />
                    <div className="space-y-2" data-testid="test-detail-recs">
                        {recommendations.map(rec => {
                            const isPlanned = plannedRecIds.has(rec.id);
                            const day = formatDayKey(addDaysToKey(todayKey, rec.suggestedOffsetDays), todayKey);
                            return (
                                <GlassCard key={rec.id} testId={`test-rec-${rec.id}`}>
                                    <p className="m-0 text-[16px] font-extrabold leading-snug text-stone-900">{rec.titleMr?.trim() || rec.titleEn}</p>
                                    <p className="m-0 text-[13.5px] font-semibold text-stone-600">
                                        {offsetWords(rec.suggestedOffsetDays)}{day && ` — ${day}`}
                                    </p>
                                    <div className="mt-2">
                                        {isPlanned ? (
                                            <span data-testid={`test-rec-planned-${rec.id}`}>
                                                <Chip tone="green"><Check size={14} aria-hidden="true" />योजनेत घातलं</Chip>
                                            </span>
                                        ) : !mayPlanWork ? null : (
                                            <BigButton onClick={() => handleAddToPlan(rec)} tone="white" disabled={planningRecId !== null}
                                                testId={`test-rec-add-${rec.id}`}>
                                                <CalendarPlus size={20} aria-hidden="true" />
                                                {planningRecId === rec.id ? 'घालत आहे…' : 'योजनेत घाला'}
                                            </BigButton>
                                        )}
                                    </div>
                                </GlassCard>
                            );
                        })}
                    </div>
                </>
            )}
        </div>,
    );
};

/** One recorded result: code and value (as recorded), the range, and which side of it the value is. */
const ResultRow: React.FC<{ result: DexieTestResult }> = ({ result }) => {
    const verdict = rangeVerdict(result);
    const hasRange = result.referenceRangeLow != null && result.referenceRangeHigh != null;
    return (
        <div className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-stone-200" data-testid="test-result-row">
            <div className="min-w-0 flex-1">
                <p className="m-0 text-[16px] font-extrabold text-stone-900">
                    {result.parameterCode} — {result.parameterValue}{result.unit ? ` ${result.unit}` : ''}
                </p>
                {hasRange && (
                    <p className="m-0 text-[12.5px] font-semibold text-stone-500">योग्य पातळी {result.referenceRangeLow}–{result.referenceRangeHigh}</p>
                )}
            </div>
            {verdict && <Chip tone={VERDICT_VIEW[verdict].tone}>{VERDICT_VIEW[verdict].label}</Chip>}
        </div>
    );
};

export default TestDetailPage;
