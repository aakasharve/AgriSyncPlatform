/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LogFactory — voice provenance threaded through the "manual" factory branch.
 *
 * BUGFIX_2026-07-19 (spec: dfes-companion-2026-07-11): a live founder voice
 * log saved with `source='manual'` and `source_ai_job_id=NULL` in
 * ssf.daily_logs, even though the voice parse succeeded and produced a real
 * AiJob — the backend DFES scorer then skips the log entirely
 * (0/UnaccountedDay). Root cause: the confirm screen (ManualEntry) is the
 * SINGLE submission surface for both genuinely-manual entries AND
 * voice-drafted logs under review, and ALWAYS submits through
 * LogFactory.createFromManualEntry (the "manual" factory branch) — which,
 * before this fix, never stamped the real AI provenance it was handed, so
 * `meta.provenance` (and therefore `sourceAiJobId`, read downstream by
 * logSyncMutationService) was always undefined regardless of where the
 * draft actually came from.
 *
 * These tests cover the factory-level contract directly: given the REAL
 * provenance object (as ManualEntry now threads it through `userDraft`),
 * createFromManualEntry (and its farm-global sibling) must stamp it onto
 * `log.meta.provenance` — and must NOT fabricate one when none is supplied
 * (genuinely-manual entries stay byte-equivalent to pre-fix behaviour).
 */

import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import type { FarmerProfile, CropProfile, LogScope, CropActivityEvent, LabourEvent } from '../../../types';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';

function makeProfile(): FarmerProfile {
    return {
        activeOperatorId: 'owner',
        trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false },
        operators: [],
    } as unknown as FarmerProfile;
}

function makeCrops(): CropProfile[] {
    const basePlot = (id: string, name: string) => ({
        id,
        name,
        baseline: { unit: 'Acre' as const },
        schedule: {
            id: 'sched-1',
            plotId: id,
            templateId: 'template-1',
            referenceType: 'PLANTING' as const,
            referenceDate: '2026-01-01',
            stageOverrides: [],
            expectationOverrides: [],
        },
    });
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [basePlot('plot-a', 'Plot A')] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeSinglePlotScope(): LogScope {
    return {
        selectedPlotIds: ['plot-a'],
        selectedCropIds: ['crop-grapes'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

function makeFarmGlobalScope(): LogScope {
    return {
        selectedPlotIds: [],
        selectedCropIds: ['FARM_GLOBAL'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

/** Real voice-parse provenance shape, as BackendAiClient.ts stamps it. */
function makeAiProvenance(overrides: Partial<LogProvenance> = {}): LogProvenance {
    return {
        source: 'ai',
        model: 'gemini-2.5-flash',
        modelVersion: 'gemini-2.5-flash',
        providerUsed: 'gemini',
        fallbackUsed: false,
        promptVersion: 'v12',
        sourceAiJobId: 'ai-job-123',
        rawInputRef: null,
        timestamp: '2026-07-19T06:00:00.000Z',
        validation: { stage: 'infrastructure_parser', outcome: 'pass' },
        ...overrides,
    };
}

const RICH_DATA = {
    date: '2026-07-19',
    cropActivities: [
        { id: 'ca1', title: 'Pruning', status: 'completed' as const, targetPlotName: 'Plot A' },
    ] as CropActivityEvent[],
    labour: [
        { id: 'lab1', type: 'HIRED' as const, count: 5, wagePerPerson: 400, totalCost: 2000, targetPlotName: 'Plot A' },
    ] as LabourEvent[],
};

describe('LogFactory.createFromManualEntry — voice provenance threading (BUGFIX_2026-07-19)', () => {
    it('stamps the real AI provenance (source + sourceAiJobId) onto meta when a voice-originated draft is confirmed via the manual branch', () => {
        const provenance = makeAiProvenance();
        const logs = LogFactory.createFromManualEntry(
            { ...RICH_DATA, provenance },
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );

        expect(logs).toHaveLength(1);
        const [log] = logs;
        expect(log!.meta?.provenance).toBeDefined();
        expect(log!.meta?.provenance?.source).toBe('ai');
        expect(log!.meta?.provenance?.sourceAiJobId).toBe('ai-job-123');
    });

    it('stamps the real AI provenance on the farm-global manual branch too', () => {
        const provenance = makeAiProvenance({ sourceAiJobId: 'ai-job-global-456' });
        const logs = LogFactory.createFromManualEntry(
            { ...RICH_DATA, provenance },
            makeFarmGlobalScope(),
            makeCrops(),
            makeProfile(),
        );

        expect(logs).toHaveLength(1);
        const [log] = logs;
        expect(log!.meta?.provenance?.source).toBe('ai');
        expect(log!.meta?.provenance?.sourceAiJobId).toBe('ai-job-global-456');
    });

    it('does NOT fabricate provenance for a genuinely-manual entry (no provenance supplied) — byte-equivalent no-op', () => {
        const logs = LogFactory.createFromManualEntry(
            RICH_DATA,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );

        expect(logs).toHaveLength(1);
        const [log] = logs;
        expect(log!.meta?.provenance).toBeUndefined();
    });
});
