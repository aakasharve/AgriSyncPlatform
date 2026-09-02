/**
 * Labour V2 R1 Task 3.4b — the invoking feature owns the result surface;
 * the mic shell and the processing screen stay SHARED.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// FEATURE_FLAGS.dailyLoop is false in the vitest environment (VITE_DAILY_LOOP
// unset), so the flag is forced ON here — the doc's parenthetical. A STATIC
// vi.mock (hoisted before all imports), NOT the doMock+resetModules dance of
// AppRouter.feature-gate.test.tsx: resetModules would give this file a
// DIFFERENT ShramSathiUnderstanding module instance than the one mainView
// renders, and the third test below is an IDENTITY assertion. The flag itself
// is not under test; every other flag keeps its production-default false.
vi.mock('../../../app/featureFlags', () => ({
    FEATURE_FLAGS: {
        DwcChip: false,
        understandingMeter: false,
        stageQuestions: false,
        disciplineSystem: false,
        voiceContinuity: false,
        dailyLoop: true,
        intelligenceInsights: false,
        taskCloseConfirm: false,
        morningNotification: false,
        spokenUnlockReward: false,
        unlockCounterPaused: false,
        simulateUnlock: false,
    },
    IS_E2E_HARNESS_ENABLED: false,
    isE2EHarnessEnabled: () => false,
    isFarmGeographyV2Enabled: () => false,
    isWeatherBackendFetchEnabled: () => false,
    isVoiceDoomLoopDetectorEnabled: () => true,
    IS_OVERSIGHT_PREVIEW_ENABLED: false,
}));

import { renderLogView, LabourResultHost } from '../mainView';
import type { AppRouterContext } from '../routeContext';
import AttendanceResult, { type AttendanceResultProps } from '../../../features/labour/components/AttendanceResult';
import ManualEntry from '../../../features/logs/components/ManualEntry';
import { ShramSathiUnderstanding } from '../../../features/logs/components/shramsathi/ShramSathiUnderstanding';

function findByType(node: React.ReactNode, type: unknown): React.ReactElement | null {
    if (!React.isValidElement(node)) {
        if (Array.isArray(node)) {
            for (const child of node) { const hit = findByType(child, type); if (hit) return hit; }
        }
        return null;
    }
    if (node.type === type) return node;
    const children = (node.props as { children?: React.ReactNode }).children;
    return children ? findByType(children, type) : null;
}

const labourDraft = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [],
    labour: [{ id: 'l1', type: 'hired', count: 12 }], inputs: [], machinery: [],
    activityExpenses: [], missingSegments: [],
};

function ctx(partial: Record<string, unknown>): AppRouterContext {
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'manual',
        recordingSegment: null, crops: [], logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
        hasActiveLogContext: true, isContextReady: true, error: null, errorTranscript: null,
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(), handleManualSubmit: vi.fn(),
        currentLogContext: { selection: [] }, ledgerDefaults: {}, farmerProfile: {},
        draftLog: null, setDraftLog: vi.fn(), provenance: null,
        voiceStreamingPhase: 'idle', liveCaption: '', continuityLevel: null, savedPendingCaptureId: null,
        getTodayCounts: vi.fn(() => ({})), getContextColorIndicator: vi.fn(() => null),
        plannedTasks: [], handleUpdateTask: vi.fn(), history: [], todayLogs: [], operatorNameById: {},
        getLogContextSnapshot: vi.fn(), handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0 },
        yesterdayCost: 0, setRecordingSegment: vi.fn(), lastSavedLogSummary: null, lastSavedLogIds: [],
        mockHistory: [], handleReset: vi.fn(), logIntent: null, todayDayState: { pendingCount: 0, closurePercent: 0 },
        weatherData: null,
        ...partial,
    } as unknown as AppRouterContext;
}

describe('Task 3.4b — Labour owns the parse result', () => {
    it('a labour-intent draft renders AttendanceResult, and handleManualSubmit is NOT called by rendering', () => {
        const submit = vi.fn();
        const node = renderLogView(ctx({ logIntent: 'labour', draftLog: labourDraft, handleManualSubmit: submit }));
        expect(findByType(node, AttendanceResult)).not.toBeNull();
        expect(submit).not.toHaveBeenCalled();                 // Task 3.4a: nothing saves on landing
    });
    it('the generic door is untouched: no AttendanceResult without labour intent', () => {
        const node = renderLogView(ctx({ logIntent: null, draftLog: labourDraft }));
        expect(findByType(node, AttendanceResult)).toBeNull();
    });
    it('the labour path renders the SAME processing component — identity, not a copy', () => {
        const node = renderLogView(ctx({ logIntent: 'labour', status: 'processing' }));
        // FEATURE_FLAGS.dailyLoop ON in prod config renders the founder-approved
        // श्रम साथी screen; identity equality forbids a labour-owned duplicate.
        expect(findByType(node, ShramSathiUnderstanding)).not.toBeNull();
    });
});

// ─── Implementer additions (Task 3.4b, beyond the doc's three pins) ─────────
//
// D9.6: बदल करा corrects; nothing is rebuilt. These pins assert — still with
// plain-node traversal, no mount — that the edit surface AttendanceResult
// offers is the SAME ManualEntry(attendanceOnly) call that used to be the
// landing (moved, not modified), fed the attendance-only view of the draft.
describe('Task 3.4b — the edit surface is the moved ManualEntry, not a rebuild', () => {
    it('renderEditSurface yields ManualEntry with attendanceOnly and the labour-only draft', () => {
        const node = renderLogView(ctx({ logIntent: 'labour', draftLog: labourDraft }));
        const result = findByType(node, AttendanceResult) as React.ReactElement<AttendanceResultProps> | null;
        expect(result).not.toBeNull();
        const manual = findByType(result!.props.renderEditSurface(), ManualEntry);
        expect(manual).not.toBeNull();
        const props = manual!.props as {
            attendanceOnly?: boolean;
            initialData?: { labour: unknown[]; cropActivities: unknown[]; irrigation: unknown[] };
        };
        expect(props.attendanceOnly).toBe(true);
        // toAttendanceOnlyDraft's view: labour kept, the other door's buckets emptied.
        expect(props.initialData?.labour).toHaveLength(1);
        expect(props.initialData?.cropActivities).toHaveLength(0);
        expect(props.initialData?.irrigation).toHaveLength(0);
    });
    it('a labour draft with no labour rows falls through to the plain ManualEntry landing', () => {
        const node = renderLogView(ctx({ logIntent: 'labour', draftLog: { ...labourDraft, labour: [] } }));
        expect(findByType(node, AttendanceResult)).toBeNull();
        // The frame is there, empty; its fall-through renders the byte-for-byte
        // ManualEntry (invisible to plain-node traversal until the frame runs,
        // so it is asserted through the frame's own render prop).
        const host = findByType(node, LabourResultHost) as React.ReactElement<{
            children?: React.ReactNode; renderManualEntry: () => React.ReactNode;
        }> | null;
        expect(host).not.toBeNull();
        expect(host!.props.children ?? null).toBeNull();
        expect(findByType(host!.props.renderManualEntry(), ManualEntry)).not.toBeNull();
    });
});
