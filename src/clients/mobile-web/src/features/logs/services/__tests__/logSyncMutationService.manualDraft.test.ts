// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
import { describe, expect, it } from 'vitest';

import { buildManualDraft } from '../logSyncMutationService';
import type { DailyLog } from '../../../../types';

/**
 * The client half of the manual-draft contract.
 *
 * Until task-0b the manual draft never left Dexie: the `create_daily_log` payload
 * carried identity only, so the server had nothing to persist and every manual day
 * scored 0/10. `buildManualDraft` is what puts the farmer's typed day on the wire.
 *
 * These tests exist because BOTH failure directions here are silent and neither is
 * caught anywhere else:
 *
 *  - Ship too little and the whole fix reverts with no error and no failing server
 *    test — the farmer simply goes back to being told he recorded nothing. So the
 *    positive case is pinned explicitly.
 *  - Ship too much and we write a PROVENANCE LIE. An AI-parsed log whose buckets hold
 *    inferred figures would be persisted server-side with `Provenance.Manual` (model
 *    "n/a", no extractor SHA), making an inferred number permanently indistinguishable
 *    from a hand-typed one (P8). That is irreversible — it converts a gap in the record
 *    into a false record — so every way a log can be AI-originated is pinned too.
 */
function makeLog(partial: Partial<DailyLog>): DailyLog {
    return partial as DailyLog;
}

/** A log that positively asserts it was hand-typed, as the manual producers now stamp. */
function manualLog(partial: Partial<DailyLog>): DailyLog {
    return {
        ...partial,
        meta: { provenance: { source: 'manual', timestamp: '2026-08-14T10:00:00.000Z' } },
    } as unknown as DailyLog;
}

describe('buildManualDraft', () => {
    it('carries a manual log\'s typed buckets so the server has something to persist', () => {
        const draft = buildManualDraft(manualLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5, rate: 350 }],
            irrigation: [{ id: 'irr-0', method: 'drip', source: 'borewell', durationHours: 2.5 }],
        } as Partial<DailyLog>));

        expect(draft).toBeDefined();
        expect(draft?.labour).toHaveLength(1);
        expect(draft?.irrigation).toHaveLength(1);
    });

    it('sends only the buckets the farmer actually filled', () => {
        const draft = buildManualDraft(manualLog({
            labour: [{ id: 'lb-0', type: 'HIRED' }],
            machinery: [],
        } as unknown as Partial<DailyLog>));

        expect(Object.keys(draft ?? {})).toEqual(['labour']);
    });

    it('omits a manual log with nothing in it rather than sending empty buckets', () => {
        expect(buildManualDraft(manualLog({ labour: [], inputs: [] } as Partial<DailyLog>))).toBeUndefined();
        expect(buildManualDraft(manualLog({}))).toBeUndefined();
    });

    // ── every way a log can be AI-originated must be withheld ────────────────

    it('omits a voice confirm carrying a job id — the server derives from that AiJob', () => {
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5 }],
            meta: { provenance: { source: 'ai', sourceAiJobId: 'job-1', timestamp: 'x' } },
        } as unknown as Partial<DailyLog>));

        expect(draft).toBeUndefined();
    });

    it('omits an AI-parsed log that has NO sourceAiJobId', () => {
        // THE REGRESSION THIS PINS. `sourceAiJobId` is optional even on AI logs
        // (LogProvenance.ts:36) and two live producers stamp source:'ai' without one —
        // the streaming parse path (useVoiceRecorder.ts:253-258) and BackendAiClient.ts:149
        // (`apiResult.sourceAiJobId ?? undefined`). Gating on the job id would ship these
        // AI-extracted figures as a manual draft, and the server would stamp them
        // Provenance.Manual — an inferred number recorded forever as hand-typed (P8).
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5, rate: 350 }],
            inputs: [{ id: 'in-0', productName: 'MKP', quantity: 4 }],
            meta: {
                provenance: {
                    source: 'ai',
                    timestamp: '2026-08-14T10:00:00.000Z',
                    promptVersion: 'v3.2.0',
                    processingTimeMs: 1200,
                },
            },
        } as unknown as Partial<DailyLog>));

        expect(draft).toBeUndefined();
    });

    it('omits a log whose origin is UNMARKED rather than assuming it was typed', () => {
        // Absence is ambiguous: a voice route reaches sync with no provenance at all
        // (useLogCommands.ts:242-250 passes undefined into createFromVoice, then
        // enqueues). Shipping is the irreversible direction, so an unmarked log is
        // withheld. Genuinely-manual producers declare themselves instead.
        expect(buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5 }],
        } as unknown as Partial<DailyLog>))).toBeUndefined();

        expect(buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5 }],
            meta: { createdAtISO: '2026-08-14T10:00:00.000Z' },
        } as unknown as Partial<DailyLog>))).toBeUndefined();
    });

    it('omits a pre_spine backfilled log — its origin was never recorded', () => {
        const draft = buildManualDraft(makeLog({
            labour: [{ id: 'lb-0', type: 'HIRED', count: 5 }],
            meta: { provenance: { source: 'pre_spine', timestamp: 'x' } },
        } as unknown as Partial<DailyLog>));

        expect(draft).toBeUndefined();
    });
});

/**
 * spec: dfes-companion-2026-07-11 (wave-3.10) — FOUNDER DECISION 8 (2026-08-16).
 *
 * A declared no-work day carries NO buckets at all. Before this task `buildManualDraft`
 * returned `undefined` for exactly that shape — every key empty — so the declaration
 * would never have left the device however well the rest of the six layers were wired.
 * This is the client end of that chain; the server end is proven on real Postgres by
 * `DeclaredNoWorkDayTests`.
 */
describe('buildManualDraft — a declared no-work day (wave-3.10)', () => {
    it('ships a bucket-less declaration that would otherwise have been dropped', () => {
        const draft = buildManualDraft(manualLog({
            dayOutcome: 'NO_WORK_PLANNED',
        } as Partial<DailyLog>));

        expect(draft).toEqual({ dayOutcome: 'NO_WORK_PLANNED' });
    });

    it('carries the optional chip when he gave one', () => {
        const draft = buildManualDraft(manualLog({
            dayOutcome: 'NO_WORK_PLANNED',
            disturbance: { scope: 'FULL_DAY', group: 'no_work', reason: 'WEATHER', cause: 'WEATHER', blockedSegments: [] },
        } as unknown as Partial<DailyLog>));

        expect(draft?.dayOutcome).toBe('NO_WORK_PLANNED');
        expect(draft?.disturbance).toEqual({ scope: 'FULL_DAY', cause: 'WEATHER', reason: 'WEATHER' });
    });

    it('P9 — the same declaration without a chip still ships, and carries no disturbance', () => {
        const draft = buildManualDraft(manualLog({
            dayOutcome: 'NO_WORK_PLANNED',
            disturbance: undefined,
        } as Partial<DailyLog>));

        expect(draft).toBeDefined();
        expect(draft?.disturbance).toBeUndefined();
    });

    it('never puts WORK_RECORDED on the wire — an ordinary day declares nothing', () => {
        // WORK_RECORDED is LogFactory's DEFAULT for any day, not something the farmer
        // said. Sending it would turn silence into a stored declaration (P4), and every
        // ordinary manual day would start writing a day_outcome it never earned.
        const draft = buildManualDraft(manualLog({
            dayOutcome: 'WORK_RECORDED',
            labour: [{ id: 'lb-0', type: 'HIRED', count: 3 }],
        } as unknown as Partial<DailyLog>));

        expect(draft?.dayOutcome).toBeUndefined();
        expect(Object.keys(draft ?? {})).toEqual(['labour']);
    });

    it('a chip with no reason is not sent — an empty reason would be dropped server-side anyway', () => {
        const draft = buildManualDraft(manualLog({
            dayOutcome: 'NO_WORK_PLANNED',
            disturbance: { scope: 'FULL_DAY', group: 'no_work', reason: '', blockedSegments: [] },
        } as unknown as Partial<DailyLog>));

        expect(draft?.disturbance).toBeUndefined();
        expect(draft?.dayOutcome).toBe('NO_WORK_PLANNED');
    });
});
