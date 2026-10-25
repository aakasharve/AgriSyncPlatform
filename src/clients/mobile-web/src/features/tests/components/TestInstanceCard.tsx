/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — one test on चाचण्या, in the approved card
 * (PLR-D9 `PlacePages.TestsPage`): what, where, when, the result line when the phone holds one, the state chip,
 * and ONE big button for the next real step. It was a bilingual "Due · बाकी / Mark collected · नमुना घेतला"
 * card; the words now come from `testView.ts`.
 *
 * State → button (unchanged mapping, CEI §4.5 / 4.2.1):
 *   करायची आहे / वेळ उलटून गेली → "नमुना घेतला" (opens the confirm sheet)
 *   नमुना घेतला                 → "निकाल नोंदवा" (opens the result sheet)
 *   निकाल आला                  → "निकाल पहा"   (opens the test's own page)
 *   सूट दिली                    → no button
 * The whole card used to be a second, invisible tap target doing the same thing; now the button is the one
 * place to tap. No button is drawn without a handler (P5). Server words (protocol name, stage, parameter codes)
 * are shown as they come.
 */
import React from 'react';
import { CheckCircle2, CircleMinus, Clock3, FlaskConical, TestTube, TriangleAlert } from 'lucide-react';
import type { DexieTestInstance, DexieTestProtocol } from '../../../infrastructure/storage/DexieDatabase';
import { BigButton, Chip, GlassCard, IconDot } from '../../../shared/components/ui/placeUi';
import {
    ACTION_LABEL, STATE_VIEW, kindLine, paramsLine, resultLine, stateOf, testName, whenLine, whereLine,
    type TestState,
} from './testView';

const STATE_ICON: Record<TestState, React.ReactNode> = {
    overdue: <TriangleAlert size={14} aria-hidden="true" />,
    due: <Clock3 size={14} aria-hidden="true" />,
    collected: <TestTube size={14} aria-hidden="true" />,
    reported: <CheckCircle2 size={14} aria-hidden="true" />,
    waived: <CircleMinus size={14} aria-hidden="true" />,
};

/** The state chip, shared with the test's own page. */
export const StateChip: React.FC<{ state: TestState }> = ({ state }) => (
    <Chip tone={STATE_VIEW[state].tone}>{STATE_ICON[state]}{STATE_VIEW[state].label}</Chip>
);

interface TestInstanceCardProps {
    instance: DexieTestInstance;
    /** Optional — if known, used for the parameter summary line. */
    protocol?: DexieTestProtocol;
    plotName?: string;
    onAction?: (instance: DexieTestInstance) => void;
}

const TestInstanceCard: React.FC<TestInstanceCardProps> = ({ instance, protocol, plotName, onAction }) => {
    const state = stateOf(instance.status) ?? 'due';
    const view = STATE_VIEW[state];
    const name = testName(instance, protocol);
    const kind = kindLine(instance, name);
    const where = whereLine(instance, plotName);
    const when = whenLine(instance);
    const params = paramsLine(protocol);
    const result = resultLine(instance.results);
    const action = ACTION_LABEL[state];

    return (
        <GlassCard testId={`test-card-${instance.id}`}>
            <div className="flex items-start gap-3">
                <IconDot tone={view.tone}><FlaskConical size={22} aria-hidden="true" /></IconDot>
                <div className="min-w-0 flex-1">
                    <p className="m-0 text-[16px] font-extrabold leading-snug text-stone-900">{name}</p>
                    {kind && <p className="m-0 text-[12.5px] font-bold text-stone-500">{kind}</p>}
                    {where && <p className="m-0 text-[13.5px] font-semibold text-stone-600">{where}</p>}
                    {when && <p className="m-0 text-[13.5px] font-semibold text-stone-600" data-testid={`test-when-${instance.id}`}>{when}</p>}
                    {params && <p className="m-0 mt-0.5 text-[12.5px] font-semibold text-stone-500">{params}</p>}
                    {result && (
                        <p className="m-0 mt-1.5 rounded-xl bg-emerald-50 p-2 text-[13.5px] font-bold leading-snug text-emerald-900" data-testid={`test-result-${instance.id}`}>
                            {result}
                        </p>
                    )}
                </div>
                <StateChip state={state} />
            </div>
            {action && onAction && (
                <div className="mt-3">
                    <BigButton onClick={() => onAction(instance)} tone={state === 'reported' ? 'white' : 'green'} testId={`test-action-${instance.id}`}>
                        {action}
                    </BigButton>
                </div>
            )}
        </GlassCard>
    );
};

export default TestInstanceCard;
