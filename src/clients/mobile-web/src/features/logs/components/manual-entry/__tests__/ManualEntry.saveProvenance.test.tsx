// @vitest-environment jsdom
// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
/**
 * WHO IS ENTITLED TO SAY "the farmer typed this".
 *
 * task-0b made the save button assert `source: 'manual'` whenever no AI marker
 * happened to be sitting in this screen's `provenance` prop. The save button cannot
 * know that. Two routes put AI-EXTRACTED figures into this very form with no marker
 * attached:
 *
 *   1. "Edit This Log" (LogDetailDrawer → mainView `onEditLog`) converts a saved
 *      DailyLog into an AgriLogResponse and hands it in as `initialData`. It sets no
 *      provenance.
 *   2. Re-opening the screen later the same day: `useManualEntryHydration` merges
 *      today's ALREADY-SAVED log for the plot back into the empty form.
 *
 * In both cases the old expression stamped `{ source: 'manual' }`, and
 * `buildManualDraft` then put those AI numbers on the wire, where the server records
 * them as `Provenance.Manual` — model "n/a", no extractor SHA. Doctrine P8: a
 * hand-typed figure must stay distinguishable from an inferred one, FOREVER. There is
 * no later correction that undoes it.
 *
 * So the origin is now declared by the code that fills the form, and the save button
 * only repeats it. These tests drive the REAL component (only leaf UI is stubbed, and
 * the ActivityLedger stub is the farmer's keyboard) and then run the submitted draft
 * through the REAL `buildManualDraft`, so the whole claim → wire chain is covered.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type {
    AgriLogResponse, CropProfile, DailyLog, FarmContext as FarmSelectionContext,
    FarmerProfile, LedgerDefaults, LabourEvent,
} from '../../../../../types';

// ── leaf UI only (factories are hoisted — no top-level references inside) ─────
vi.mock('../components/ManualEntryHeader', () => ({
    default: () => React.createElement('div', { 'data-stub': 'header' }),
}));
vi.mock('../components/UnclearSegmentsList', () => ({
    default: () => React.createElement('div', { 'data-stub': 'unclear' }),
}));
vi.mock('../components/LabourReview', () => ({
    default: () => React.createElement('div', { 'data-stub': 'labour-review' }),
}));
vi.mock('../../ObservationHubSheet', () => ({
    default: () => React.createElement('div', { 'data-stub': 'observation-hub' }),
}));

/** The farmer's keyboard: pushes a typed labour row through the REAL `updateDetails`. */
vi.mock('../components/ActivityLedger', () => ({
    default: (props: { onUpdateDetails: (id: string, kind: string, data: unknown) => void }) =>
        React.createElement('button', {
            type: 'button',
            'data-testid': 'type-labour',
            onClick: () => props.onUpdateDetails('act_global_daily', 'labour', {
                id: 'typed_lab_1',
                type: 'HIRED',
                count: 2,
                activity: 'Weeding',
            }),
        }, 'type labour'),
}));

/** The save button: calls the REAL `handleSaveDay`. */
vi.mock('../components/CostStrip', () => ({
    default: (props: { onSaveDay: () => void }) =>
        React.createElement('button', {
            type: 'button',
            'data-testid': 'save-day',
            onClick: props.onSaveDay,
        }, 'save'),
}));

// ── side-effect boundaries (Dexie / network / analytics) ──────────────────────
vi.mock('../../../../../infrastructure/ai/CorrectionEventStore', () => ({
    buildAiCorrectionEvents: vi.fn(() => []),
    persistAiCorrectionEvents: vi.fn(async () => undefined),
    postAiCorrectionBlob: vi.fn(),
}));
vi.mock('../../../../../core/telemetry/eventEmitters', () => ({
    emitClosureSubmitted: vi.fn(),
}));
vi.mock('../../../../voice/vocab/vocabStore', () => ({
    loadVocabDB: vi.fn(() => ({})),
    addApprovedMapping: vi.fn(),
}));
vi.mock('../../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1' }),
}));

import ManualEntry from '../ManualEntry';
import { buildManualDraft } from '../../../services/logSyncMutationService';

// ── stable props (the hydration effect keys on their identity) ────────────────
const PLOT_ID = 'plot_1';

const CROPS = [{
    id: 'crop_1',
    name: 'Grapes',
    color: 'bg-emerald-500',
    plots: [{
        id: PLOT_ID,
        name: 'North Block',
        baseline: {},
        schedule: {},
        infrastructure: { irrigationMethod: 'Drip' },
    }],
}] as unknown as CropProfile[];

const CONTEXT = {
    selection: [{
        cropId: 'crop_1',
        cropName: 'Grapes',
        selectedPlotIds: [PLOT_ID],
        selectedPlotNames: ['North Block'],
    }],
} as unknown as FarmSelectionContext;

const PROFILE = {
    name: 'Purvesh',
    operators: [],
    activeOperatorId: 'op_owner',
} as unknown as FarmerProfile;

const DEFAULTS = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: { defaultWage: 300, defaultHours: 8, shifts: [] },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
} as LedgerDefaults;

const NO_TODAY_LOGS: DailyLog[] = [];

/** What the AI heard: 3 workers, and 250 ml of spray. Nobody typed these. */
const AI_PARSED_DRAFT = {
    summary: 'Sprayed with 3 workers',
    dayOutcome: 'productive',
    cropActivities: [],
    irrigation: [],
    labour: [{ id: 'ai_lab_1', type: 'HIRED', count: 3, rate: 350, activity: 'Spraying' }],
    inputs: [{ type: 'pesticide', productName: 'Confidor', quantity: 250, unit: 'ml' }],
    machinery: [],
    activityExpenses: [],
    missingSegments: [],
} as unknown as AgriLogResponse;

/** The SAME figures, but already saved as today's log for this plot. */
const TODAYS_SAVED_AI_LOG = [{
    id: 'log_saved_1',
    date: '2026-08-15',
    context: CONTEXT,
    cropActivities: [],
    labour: [{ id: 'ai_lab_1', type: 'HIRED', count: 3, rate: 350, activity: 'Spraying' }],
    irrigation: [],
    machinery: [],
    inputs: [{ id: 'ai_inp_1', type: 'pesticide', productName: 'Confidor', quantity: 250, unit: 'ml' }],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    meta: { provenance: { source: 'ai', timestamp: '2026-08-15T04:00:00.000Z' } },
}] as unknown as DailyLog[];

type SubmittedDraft = {
    provenance?: { source: string; timestamp: string } | null;
    labour?: LabourEvent[];
    inputs?: unknown[];
};

/** Exactly what LogFactory.createFromManualEntry does with the draft's provenance. */
function asPersistedLog(draft: SubmittedDraft): DailyLog {
    return { ...draft, meta: { provenance: draft.provenance ?? undefined } } as unknown as DailyLog;
}

function renderScreen(opts: { initialData?: AgriLogResponse | null; todayLogs?: DailyLog[]; provenance?: unknown }) {
    const onSubmit = vi.fn();
    render(
        <ManualEntry
            context={CONTEXT}
            crops={CROPS}
            defaults={DEFAULTS}
            profile={PROFILE}
            onSubmit={onSubmit}
            initialData={opts.initialData ?? null}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test drives the real prop shape
            provenance={(opts.provenance ?? null) as any}
            onDataConsumed={vi.fn()}
            todayLogs={opts.todayLogs ?? NO_TODAY_LOGS}
        />
    );
    return onSubmit;
}

function save() {
    fireEvent.click(screen.getByTestId('save-day'));
}

beforeEach(() => {
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ManualEntry save — who may claim the day was hand-typed', () => {
    it('makes NO claim when the form was handed a draft it did not type ("Edit This Log")', () => {
        // mainView `onEditLog` converts the saved log to an AgriLogResponse and sets it
        // as draftLog → arrives here as initialData, with NO provenance alongside it.
        const onSubmit = renderScreen({ initialData: AI_PARSED_DRAFT });
        save();

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submitted = onSubmit.mock.calls[0][0] as SubmittedDraft;

        // Not vacuous: the AI's figures really are in the form at save time.
        expect(submitted.labour?.[0]?.count).toBe(3);

        expect(submitted.provenance).toBeUndefined();
        expect(buildManualDraft(asPersistedLog(submitted))).toBeUndefined();
    });

    it('makes NO claim when the form was pre-filled from today\'s already-saved log', () => {
        // No initialData at all here — the hydration hook merges todayLogs into the
        // empty form, which is what happens when the farmer adds one more thing to
        // a day he already logged by voice.
        const onSubmit = renderScreen({ todayLogs: TODAYS_SAVED_AI_LOG });
        save();

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submitted = onSubmit.mock.calls[0][0] as SubmittedDraft;

        // Not vacuous: the saved log's AI figures really were merged back in.
        expect(submitted.labour?.[0]?.count).toBe(3);

        expect(submitted.provenance).toBeUndefined();
        expect(buildManualDraft(asPersistedLog(submitted))).toBeUndefined();
    });

    it('DOES claim manual — and ships the draft — for a blank form the farmer typed', () => {
        // THE REGRESSION GUARD. task-0b exists so a hand-typed day stops scoring 0/10;
        // withholding this draft would silently revert the whole fix.
        const onSubmit = renderScreen({});
        fireEvent.click(screen.getByTestId('type-labour'));
        save();

        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submitted = onSubmit.mock.calls[0][0] as SubmittedDraft;

        expect(submitted.labour?.[0]?.id).toBe('typed_lab_1');
        expect(submitted.provenance).toEqual({
            source: 'manual',
            timestamp: expect.any(String),
        });

        const draft = buildManualDraft(asPersistedLog(submitted));
        expect(draft?.labour).toHaveLength(1);
    });

    it('still carries the REAL ai lineage when the voice parse handed one over', () => {
        // BUGFIX_2026-07-19 must not regress: a voice draft under review saves with
        // source 'ai', so the server derives from the AiJob rather than the wire.
        const onSubmit = renderScreen({
            initialData: AI_PARSED_DRAFT,
            provenance: { source: 'ai', sourceAiJobId: 'job-1', timestamp: '2026-08-15T04:00:00.000Z' },
        });
        save();

        const submitted = onSubmit.mock.calls[0][0] as SubmittedDraft;
        expect(submitted.provenance?.source).toBe('ai');
        expect(buildManualDraft(asPersistedLog(submitted))).toBeUndefined();
    });
});
