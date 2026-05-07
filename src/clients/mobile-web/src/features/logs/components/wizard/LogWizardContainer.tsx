import React, { useEffect, useRef, useState } from 'react';
import Step1_ContextLock from './Step1_ContextLock';
import Step2_WorkBuckets from './Step2_WorkBuckets';
import Step3_Details from './Step3_Details';
import Step4_Readback from './Step4_Readback';
import SathiStepper from '../../../sathi/components/SathiStepper';
import { AgriLogResponse, CropProfile, DailyLog, FarmerProfile } from '../../../../types';
import { X } from 'lucide-react';
import {
    splitLogSubmission,
    type WizardLogContext,
} from '../../services/logSubmissionService';
import { deriveEditableBucketsFromParseResult } from '../../services/bucketDerivation';
import {
    emitClosureSubmitted,
    emitClosureAbandoned,
} from '../../../../core/telemetry/eventEmitters';
import { useFarmContext } from '../../../../core/session/FarmContext';

interface LogWizardContainerProps {
    isOpen: boolean;
    onClose: () => void;
    profile: FarmerProfile;
    crops: CropProfile[];
    voiceParseResult?: AgriLogResponse;
    onSubmit: (logs: DailyLog[]) => Promise<void> | void;
    /**
     * VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.11) — optional streaming
     * lifecycle from `useVoiceRecorder`. When `voiceStreamingPhase === 'streaming'`
     * AND `voiceParseResult` is still null, the header renders an
     * "AI is reading…" indicator with the count of top-level fields seen so far.
     * Both props stay falsy/empty on the batch (default) path; the indicator
     * stays hidden and the wizard renders unchanged.
     *
     * Mount-gated by `DEFAULT_VOICE_CONFIG.useStreamingParse` upstream
     * (default false). The conditional render path below is unreachable in
     * any production code path until the flag flips. L5b becomes mandatory
     * at flag-flip time per plan §9.6.
     */
    voiceStreamingPhase?: 'idle' | 'streaming' | 'complete' | 'error';
    voiceStreamingFieldsArrived?: ReadonlySet<string>;
}

const LogWizardContainer: React.FC<LogWizardContainerProps> = ({ isOpen, onClose, profile, crops, voiceParseResult, onSubmit, voiceStreamingPhase, voiceStreamingFieldsArrived }) => {
    // --- STATE ---
    const [phase, setPhase] = useState<number>(1); // 1: Context, 2: Buckets, 3: Details, 4: Review

    // Step 1 Data
    const [contextData, setContextData] = useState<WizardLogContext | null>(null);

    // Step 2 Data
    const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);

    // Step 3 Data (Iterating through buckets)
    const [currentBucketIndex, setCurrentBucketIndex] = useState<number>(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; tightened in T-VOICE-LATENCY-V2-RUN-STREAMING-PARSE-REFACTOR follow-up
    const [collectedData, setCollectedData] = useState<Record<string, any>>({}); // Map bucketId -> data

    // DWC v2 §2.8 — telemetry refs for the wizard's open/submit lifecycle.
    // openedAtRef captures wizard-open wall clock so durationMs is accurate
    // for both submit and abandon paths. submittedRef avoids double-emit on
    // unmount when the wizard closed cleanly via onSubmit.
    const { currentFarmId } = useFarmContext();
    const openedAtRef = useRef<number | null>(null);
    const submittedRef = useRef(false);
    const phaseRef = useRef(phase);
    const farmIdRef = useRef<string | null>(currentFarmId);
    useEffect(() => { phaseRef.current = phase; }, [phase]);
    useEffect(() => { farmIdRef.current = currentFarmId; }, [currentFarmId]);

    useEffect(() => {
        if (isOpen && openedAtRef.current === null) {
            openedAtRef.current = Date.now();
            submittedRef.current = false;
        }
    }, [isOpen]);

    // Emit closure.abandoned when the wizard unmounts before submit fires.
    useEffect(() => {
        return () => {
            if (submittedRef.current) return;
            const farmId = farmIdRef.current;
            if (!farmId || openedAtRef.current === null) return;
            emitClosureAbandoned({
                farmId,
                method: 'wizard',
                durationMs: Math.max(0, Date.now() - openedAtRef.current),
                lastStep: `phase_${phaseRef.current}`,
            });
        };
    }, []);

    if (!isOpen) return null;

    const initialBuckets = voiceParseResult ? deriveEditableBucketsFromParseResult(voiceParseResult) : [];

    // --- MANAGE FLOW ---

    // Total steps calculation for stepper
    // 1 (Context) + 1 (Buckets) + N (Details) + 1 (Review)
    const totalSteps = 1 + 1 + (selectedBuckets.length || 0) + 1;

    const getCurrentStepForStepper = () => {
        if (phase === 1) return 1;
        if (phase === 2) return 2;
        if (phase === 3) return 2 + currentBucketIndex + 1;
        return totalSteps;
    };

    const handleContextNext = (data: WizardLogContext) => {
        setContextData(data);
        setPhase(2);
    };

    const handleBucketsNext = (buckets: string[]) => {
        setSelectedBuckets(buckets);
        setCurrentBucketIndex(0); // Reset index
        setPhase(3);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; data shape varies per Step3_Details bucket variant
    const handleDetailsNext = (data: any) => {
        const currentBucket = selectedBuckets[currentBucketIndex];
        setCollectedData(prev => ({
            ...prev,
            [currentBucket]: data
        }));

        // Advance or Finish Details
        if (currentBucketIndex < selectedBuckets.length - 1) {
            setCurrentBucketIndex(prev => prev + 1);
        } else {
            setPhase(4);
        }
    };

    const handleDetailsBack = () => {
        if (currentBucketIndex > 0) {
            setCurrentBucketIndex(prev => prev - 1);
        } else {
            setPhase(2); // Go back to bucket selection
        }
    };

    const handleSubmit = async () => {
        if (!contextData) {
            return;
        }

        const logs = splitLogSubmission({
            context: contextData,
            activities: collectedData,
        }, crops, profile);

        // DWC v2 §2.8 — emit closure.submitted for the (typically single)
        // wizard-produced log. Fields_used = number of buckets the user
        // touched; durationMs is wizard-open wall clock. Multi-log
        // submissions emit one event each so per-log analytics tracking
        // matches one-to-one with the saved DailyLog rows.
        const farmId = farmIdRef.current;
        const openedAt = openedAtRef.current;
        if (farmId && openedAt !== null) {
            const durationMs = Math.max(0, Date.now() - openedAt);
            for (const log of logs) {
                emitClosureSubmitted({
                    farmId,
                    logId: log.id,
                    method: 'wizard',
                    durationMs,
                    fields_used: selectedBuckets.length,
                });
            }
        }
        submittedRef.current = true;

        await onSubmit(logs);
    };


    // --- HELPERS to format Summary ---
    const getSummaryData = () => {
        return selectedBuckets.map(b => {
            const data = collectedData[b];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; mocked summary mapping
            let items: any[] = [];

            // MOCKED MAPPING based on Step3 mock
            if (b === 'irrigation') {
                items = [
                    { label: 'Duration', value: `${data?.durationHours || 0} hrs` },
                    { label: 'Method', value: data?.method || '-' }
                ];
            } else if (b === 'labour') {
                items = [
                    { label: 'Workers', value: `${data?.count || 0}` },
                    { label: 'Cost', value: `₹${data?.totalCost || 0}` }
                ];
            } else {
                items = [{ label: 'Details', value: 'Captured' }];
            }

            return {
                bucket: b,
                summaryItems: items
            };
        });
    };

    // Find Plot Name for display
    const getPlotName = () => {
        if (!contextData) return '';
        if (contextData.selections.length === 1) {
            return contextData.selections[0].plotName;
        }
        return `${contextData.selections.length} plots`;
    };

    const getTargetLabels = () => {
        return contextData?.selections.map(selection => `${selection.cropName} • ${selection.plotName}`) || [];
    };

    return (
        <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col pt-safe-area pb-safe-area animate-in fade-in duration-300">
            {/* Header */}
            <div className="px-4 py-4 flex items-center justify-between bg-white border-b border-stone-200">
                <SathiStepper
                    currentStep={getCurrentStepForStepper()}
                    totalSteps={totalSteps || 4}
                />
                {/* VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.11) — streaming indicator.
                    Shown only while the SSE parse is in flight AND no terminal payload
                    has landed. Mount-gated upstream by DEFAULT_VOICE_CONFIG.useStreamingParse
                    (default false) — unreachable in production until founder flips the flag
                    (plan §9.6 L5b precondition applies at flip time). */}
                {voiceStreamingPhase === 'streaming' && !voiceParseResult && (
                    <div
                        className="flex items-center gap-2 px-2 py-1 mx-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900"
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        aria-live="polite"
                    >
                        <span className="inline-block w-2 h-2 bg-amber-500 rounded-full animate-pulse" aria-hidden />
                        <span>AI वाचत आहे…</span>
                        {voiceStreamingFieldsArrived && voiceStreamingFieldsArrived.size > 0 && (
                            <span className="font-semibold" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                                ({voiceStreamingFieldsArrived.size})
                            </span>
                        )}
                    </div>
                )}
                <button onClick={onClose} className="p-2 ml-4 -mt-6 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500">
                    <X size={20} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 pb-32">
                <div className="max-w-lg mx-auto">

                    {phase === 1 && (
                        <Step1_ContextLock
                            profile={profile}
                            crops={crops}
                            onNext={handleContextNext}
                        />
                    )}

                    {phase === 2 && (
                        <Step2_WorkBuckets
                            plotName={getPlotName()}
                            initialBuckets={initialBuckets}
                            onNext={handleBucketsNext}
                            onBack={() => setPhase(1)}
                        />
                    )}

                    {phase === 3 && (
                        <Step3_Details
                            bucket={selectedBuckets[currentBucketIndex]}
                            onNext={handleDetailsNext}
                            onBack={handleDetailsBack}
                        />
                    )}

                    {phase === 4 && (
                        <Step4_Readback
                            summaryData={getSummaryData()}
                            targetLabels={getTargetLabels()}
                            onSubmit={handleSubmit}
                            onBack={() => {
                                setCurrentBucketIndex(selectedBuckets.length - 1);
                                setPhase(3);
                            }}
                            onEditItem={(idx) => {
                                setCurrentBucketIndex(idx);
                                setPhase(3);
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default LogWizardContainer;
