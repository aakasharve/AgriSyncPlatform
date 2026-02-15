import { useState } from 'react';
import { LogVerificationStatus, AppStatus, LogSegment, AudioData, FarmContext, CropProfile, FarmerProfile, InputMode, AgriLogResponse, QuestionForUser } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { VoiceParserPort, VoiceInput } from '../../application/ports';
import { parseVoiceToDraft } from '../../application/usecases/ParseVoiceToDraft';
import { LogScope } from '../../domain/types/log.types';
import { hasSuccessfulIrrigation } from '../../domain/ai/IrrigationStatusHeuristics';

interface UseVoiceRecorderProps {
    currentLogContext: FarmContext | null;
    logScope: LogScope; // Needed for parser
    hasActiveLogContext: boolean;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    setMode: (mode: InputMode) => void;
    onAutoSave?: (log: AgriLogResponse, provenance?: LogProvenance) => void;
    parser: VoiceParserPort;
}

export const useVoiceRecorder = ({
    currentLogContext,
    logScope,
    hasActiveLogContext,
    crops,
    farmerProfile,
    setMode,
    onAutoSave,
    parser
}: UseVoiceRecorderProps) => {

    const [status, setStatus] = useState<AppStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [errorTranscript, setErrorTranscript] = useState<string | undefined>(undefined);
    const [draftLog, setDraftLog] = useState<AgriLogResponse | null>(null);
    const [provenance, setProvenance] = useState<LogProvenance | null>(null);
    const [recordingSegment, setRecordingSegment] = useState<LogSegment | null>(null);
    const [clarificationNeeded, setClarificationNeeded] = useState<QuestionForUser | null>(null);
    const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);

    const handleAudioReady = async (audioData: AudioData) => {
        await processInput({ type: 'audio', data: audioData.base64, mimeType: audioData.mimeType });
    };

    const handleTextReady = async (text: string) => {
        await processInput({ type: 'text', data: text }); // mimeType not needed for text
    };

    const processInput = async (input: { type: 'audio' | 'text', data: string, mimeType?: string }) => {
        if (!hasActiveLogContext) {
            // PHASE 25: Allow Global Log (Removed Blocker)
            // We pass a "NULL" flag or leave it as is, Parser handles it.
            // console.warn("No active context, proceeding in Global Mode");
        }

        setStatus('processing');
        setError(null);

        // RE-ENTRY: If we have a text input (answer) and a pending transcript, combine them upfront if possible?
        // No, if input is AUDIO, we need to parse it first to get text.
        // If input is TEXT (clicked option), we can combine immediately.
        let payloadInput = input;
        if (input.type === 'text' && pendingTranscript) {
            const combined = `${pendingTranscript} ${input.data}`;
            payloadInput = { type: 'text', data: combined };
            // We will clear pendingTranscript later to be safe, or right here?
            // Let's clear it here.
            setPendingTranscript(null);
            setClarificationNeeded(null);
            // Update the scope console log if needed
            console.log("🔄 Combined Clarification:", combined);
        }

        const isSegmentUpdate = !!draftLog && !!recordingSegment;
        const focusCategory = isSegmentUpdate ? recordingSegment : undefined;

        try {
            // Construct correct payload type
            const payload = payloadInput.type === 'audio'
                ? { type: 'audio' as const, data: payloadInput.data, mimeType: payloadInput.mimeType! }
                : { type: 'text' as const, content: payloadInput.data };

            const result = await parseVoiceToDraft(
                payload,
                logScope,
                crops,
                farmerProfile,
                parser,
                { focusCategory: focusCategory || undefined }
            );

            if (!result.success || !result.data) {
                setStatus('idle');
                setError(result.error || "Could not process audio");
                return;
            }

            const response = result.data;
            const prov = result.provenance;
            setProvenance(prov || null);

            // RE-ENTRY LOGIC (Audio Answer):
            // If we had a pending transcript and just parsed new audio -> Combine and Re-Process
            if (pendingTranscript && response.fullTranscript) {
                const combined = `${pendingTranscript} ${response.fullTranscript}`;
                console.log("🎤 Combined Voice Clarification:", combined);
                setPendingTranscript(null);
                setClarificationNeeded(null);

                // Recursive call with combined text
                await processInput({ type: 'text', data: combined });
                return;
            }

            // CHECK: Out of Context / Irrelevant Input
            if (response.dayOutcome === 'IRRELEVANT_INPUT') {
                // PHASE 25: Check for Empathetic Clarification (CONTEXT_CHECK)
                const contextQuestion = response.questionsForUser?.find(q => q.type === 'CONTEXT_CHECK');

                if (contextQuestion) {
                    setStatus('idle');
                    setClarificationNeeded(contextQuestion);
                    // Store the original intent (e.g., "Watered") to combine with the answer
                    setPendingTranscript(response.fullTranscript || input.data);
                    return;
                }

                setStatus('idle');
                setError(response.summary || "Input seems unrelated to selected crop.");
                setErrorTranscript(response.fullTranscript); // Show what was heard
                return;
            }

            // AUTO-SAVE LOGIC (AV-6: DFES Voice Safety Gate)
            const suggestedAction = result.confidenceAssessment?.suggestedAction;
            const hasUnclearSegments = response.unclearSegments && response.unclearSegments.length > 0;

            // Auto-save if confidence assessment says auto_confirm,
            // or legacy fallback: no confidence data AND no unclear segments
            const shouldAutoSave = suggestedAction === 'auto_confirm'
                || (!suggestedAction && !hasUnclearSegments);

            if (onAutoSave && !isSegmentUpdate && shouldAutoSave) {
                // IMPORTANT: Pass provenance so backend can link audio if needed
                onAutoSave(response, prov);

                // Reset state immediately as we are done
                setDraftLog(null);
                setRecordingSegment(null);
                setClarificationNeeded(null); // Clear any pending clarification
                setStatus('idle');
                // Note: The onAutoSave callback in compositionRoot.ts will set status to 'success'
                return;
            }

            if (isSegmentUpdate) {
                const mergedDraft = { ...draftLog! };

                // Merge Logic aligned with App.tsx
                if (focusCategory === 'crop_activity' && response.cropActivities.length > 0) mergedDraft.cropActivities = response.cropActivities;
                if (focusCategory === 'irrigation' && response.irrigation.length > 0) mergedDraft.irrigation = response.irrigation;
                if (focusCategory === 'labour' && response.labour.length > 0) mergedDraft.labour = response.labour;
                if (focusCategory === 'input' && response.inputs.length > 0) mergedDraft.inputs = response.inputs;
                if (focusCategory === 'machinery' && response.machinery.length > 0) mergedDraft.machinery = response.machinery;
                if (response.activityExpenses && response.activityExpenses.length > 0) mergedDraft.activityExpenses = response.activityExpenses;

                // Merge transcript (Replace is safer for now as segments are usually re-records)
                if (response.fullTranscript) mergedDraft.fullTranscript = response.fullTranscript;

                if (response.disturbance) {
                    const existingDisturbance = mergedDraft.disturbance;
                    if (existingDisturbance) {
                        const mergedBlocked = Array.from(new Set([...existingDisturbance.blockedSegments, ...response.disturbance.blockedSegments]));
                        mergedDraft.disturbance = {
                            ...existingDisturbance,
                            blockedSegments: mergedBlocked,
                            reason: response.disturbance.reason || existingDisturbance.reason,
                            note: `${existingDisturbance.note || ''} | ${response.disturbance.note || ''}`
                        };
                    } else {
                        mergedDraft.disturbance = response.disturbance;
                    }

                    const hasWork = mergedDraft.cropActivities.length > 0
                        || hasSuccessfulIrrigation(mergedDraft.irrigation || [], mergedDraft.fullTranscript)
                        || mergedDraft.labour.length > 0
                        || mergedDraft.inputs.length > 0
                        || mergedDraft.machinery.length > 0;
                    if (hasWork && mergedDraft.disturbance) {
                        mergedDraft.disturbance.scope = 'PARTIAL';
                    }
                }

                const hasWorkFinal = mergedDraft.cropActivities.length > 0
                    || hasSuccessfulIrrigation(mergedDraft.irrigation || [], mergedDraft.fullTranscript)
                    || mergedDraft.labour.length > 0
                    || mergedDraft.inputs.length > 0
                    || mergedDraft.machinery.length > 0;
                if (hasWorkFinal) {
                    mergedDraft.dayOutcome = 'WORK_RECORDED';
                } else if (mergedDraft.disturbance) {
                    mergedDraft.dayOutcome = 'DISTURBANCE_RECORDED';
                }

                if (focusCategory === 'labour' && response.labour.length > 0) {
                    mergedDraft.questionsForUser = mergedDraft.questionsForUser?.filter(q => q.target !== 'LABOUR');
                }

                setDraftLog(mergedDraft);
                setRecordingSegment(null);
            } else {
                // Fallback: If no auto-save prop (e.g. testing) or it was unclear, set draft
                setDraftLog(response);
            }

            setStatus('idle');
            setMode('manual');

        } catch (err) {
            console.error(err);
            setError("Could not process log. Please try again.");
            setStatus('idle');
        }
    };

    const handleReRecordSegment = (segment: LogSegment) => {
        setRecordingSegment(segment);
        setStatus('idle');
    };

    const handleResetVoice = () => {
        setDraftLog(null);
        setProvenance(null);
        setRecordingSegment(null);
        setClarificationNeeded(null);
        setPendingTranscript(null);
        setStatus('idle');
        setError(null);
        setErrorTranscript(undefined);
    };

    return {
        status, setStatus,
        error, setError,
        errorTranscript,
        draftLog, setDraftLog,
        provenance, // EXPOSE PROVENANCE
        recordingSegment, setRecordingSegment,
        handleAudioReady,
        handleTextReady,
        handleReRecordSegment,
        handleResetVoice,
        clarificationNeeded // EXPOSE FOR UI
    };
};
