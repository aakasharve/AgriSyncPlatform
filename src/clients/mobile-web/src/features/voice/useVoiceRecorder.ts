import { useRef, useState } from 'react';
import { AppStatus, LogSegment, AudioData, FarmContext, CropProfile, FarmerProfile, InputMode, AgriLogResponse, QuestionForUser } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { VoiceParserPort } from '../../application/ports';
import { parseVoiceToDraft } from '../../application/usecases/ParseVoiceToDraft';
import { LogScope } from '../../domain/types/log.types';
import { VoicePreprocessor } from '../../infrastructure/voice/VoicePreprocessor';
import { VoiceIdempotency } from '../../infrastructure/voice/VoiceIdempotency';
import { VoiceSessionMetadata } from '../../infrastructure/voice/types';

const hasSuccessfulIrrigation = (events: Array<{ durationHours?: number; waterVolumeLitres?: number; method?: string; source?: string }>): boolean => {
    return events.some(event => {
        if ((event.durationHours || 0) > 0) return true;
        if ((event.waterVolumeLitres || 0) > 0) return true;
        return Boolean(event.method || event.source);
    });
};

interface UseVoiceRecorderProps {
    currentLogContext: FarmContext | null;
    logScope: LogScope; // Needed for parser
    hasActiveLogContext: boolean;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    setMode: (mode: InputMode) => void;
    onAutoSave?: (log: AgriLogResponse, provenance?: LogProvenance) => void;
    parser: VoiceParserPort;
    voicePreprocessor: VoicePreprocessor;
}

export const useVoiceRecorder = ({
    currentLogContext,
    logScope,
    hasActiveLogContext,
    crops,
    farmerProfile,
    setMode,
    onAutoSave,
    parser,
    voicePreprocessor,
}: UseVoiceRecorderProps) => {

    const [status, setStatus] = useState<AppStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [errorTranscript, setErrorTranscript] = useState<string | undefined>(undefined);
    const [draftLog, setDraftLog] = useState<AgriLogResponse | null>(null);
    const [provenance, setProvenance] = useState<LogProvenance | null>(null);
    const [recordingSegment, setRecordingSegment] = useState<LogSegment | null>(null);
    const [clarificationNeeded, setClarificationNeeded] = useState<QuestionForUser | null>(null);
    const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
    const lastVoiceSessionMetadataRef = useRef<VoiceSessionMetadata | null>(null);
    const lastVoiceIdempotencySeedRef = useRef<string | null>(null);

    const resolveFarmId = (): string => {
        const farmId = currentLogContext?.selection
            .find(selection => typeof selection.farmId === 'string' && selection.farmId.trim().length > 0)
            ?.farmId;
        return farmId ?? 'unknown-farm';
    };

    const resolveUserId = (): string => {
        const userId = farmerProfile.activeOperatorId?.trim();
        return userId && userId.length > 0 ? userId : 'unknown-user';
    };

    const blobToBase64 = async (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                if (!result.includes(',')) {
                    reject(new Error('Unable to encode audio for upload.'));
                    return;
                }
                resolve(result.split(',')[1]);
            };
            reader.onerror = () => reject(new Error('FileReader failed while encoding audio.'));
            reader.readAsDataURL(blob);
        });
    };

    const preprocessAudio = async (audioData: AudioData): Promise<AudioData> => {
        const farmId = resolveFarmId();
        const userId = resolveUserId();
        const sessionId = VoiceIdempotency.createSessionId();

        try {
            const pipelineOutput = await voicePreprocessor.processBlobAsSingleBlob(
                audioData.blob,
                sessionId,
                farmId,
            );
            const deterministicMaterial = await VoiceIdempotency.buildSegmentMaterial({
                userId,
                farmId,
                sessionId,
                segmentIndex: 0,
                contentHash: pipelineOutput.contentHash,
            });

            lastVoiceSessionMetadataRef.current = pipelineOutput.metadata;
            lastVoiceIdempotencySeedRef.current = deterministicMaterial.deterministicSeed;

            return {
                blob: pipelineOutput.audioBlob,
                base64: await blobToBase64(pipelineOutput.audioBlob),
                mimeType: pipelineOutput.mimeType,
            };
        } catch (pipelineError) {
            console.warn('[VoicePreprocessor] Falling back to raw audio upload.', pipelineError);
            lastVoiceSessionMetadataRef.current = null;
            lastVoiceIdempotencySeedRef.current = null;
            return audioData;
        }
    };

    const handleAudioReady = async (audioData: AudioData) => {
        setStatus('processing');
        setError(null);
        const preprocessedAudio = await preprocessAudio(audioData);
        await processInput({
            type: 'audio',
            data: preprocessedAudio.base64,
            mimeType: preprocessedAudio.mimeType,
        });
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
                        || hasSuccessfulIrrigation(mergedDraft.irrigation || [])
                        || mergedDraft.labour.length > 0
                        || mergedDraft.inputs.length > 0
                        || mergedDraft.machinery.length > 0;
                    if (hasWork && mergedDraft.disturbance) {
                        mergedDraft.disturbance.scope = 'PARTIAL';
                    }
                }

                const hasWorkFinal = mergedDraft.cropActivities.length > 0
                    || hasSuccessfulIrrigation(mergedDraft.irrigation || [])
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
        lastVoiceSessionMetadataRef.current = null;
        lastVoiceIdempotencySeedRef.current = null;
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
