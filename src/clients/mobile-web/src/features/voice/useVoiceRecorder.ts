import { useRef, useState } from 'react';
import { AppStatus, LogSegment, AudioData, FarmContext, CropProfile, FarmerProfile, InputMode, AgriLogResponse, QuestionForUser } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { VoiceParserPort, VoiceParseResult } from '../../application/ports';
import { parseVoiceToDraft } from '../../application/usecases/ParseVoiceToDraft';
import { parseVoiceToDraftStream } from '../../application/usecases/ParseVoiceToDraftStream';
import { LogScope } from '../../domain/types/log.types';
import { VoicePreprocessor } from '../../infrastructure/voice/VoicePreprocessor';
import { VoiceIdempotency } from '../../infrastructure/voice/VoiceIdempotency';
import { DEFAULT_VOICE_CONFIG, VoiceSessionMetadata } from '../../infrastructure/voice/types';
import { normalizeLegacyLogSegmentId } from '../../domain/ai/BucketId';

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
    // VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.12) — streaming UX state.
    // streamingPhase tracks the SSE lifecycle when DEFAULT_VOICE_CONFIG.useStreamingParse
    // is on; fieldsArrived collects the top-level field names from `field_complete`
    // events so consumers (the wizard) can render an arrival indicator before the
    // terminal `complete` event lands. Both stay at idle/empty on the batch path.
    const [voiceStreamingPhase, setVoiceStreamingPhase] = useState<'idle' | 'streaming' | 'complete' | 'error'>('idle');
    const [voiceStreamingFieldsArrived, setVoiceStreamingFieldsArrived] = useState<ReadonlySet<string>>(() => new Set());
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

    type PreprocessedAudioResult = {
        base64: string;
        mimeType: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        idempotencyKey?: string;
        requestPayloadHash?: string;
    };

    const preprocessAudio = async (audioData: AudioData): Promise<PreprocessedAudioResult> => {
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

            const speechMs = Math.round(pipelineOutput.metadata.totalSpeechDurationMs);
            const rawMs = Math.round(pipelineOutput.metadata.totalRawDurationMs);
            const segmentMetadata = {
                sessionId: pipelineOutput.metadata.sessionId,
                farmId: pipelineOutput.metadata.farmId,
                totalSegments: pipelineOutput.metadata.totalSegments,
                totalSpeechDurationMs: speechMs,
                totalRawDurationMs: rawMs,
                totalSilenceRemovedMs: Math.round(pipelineOutput.metadata.totalSilenceRemovedMs),
            };

            return {
                base64: await blobToBase64(pipelineOutput.audioBlob),
                mimeType: pipelineOutput.mimeType,
                inputSpeechDurationMs: speechMs,
                inputRawDurationMs: rawMs,
                segmentMetadataJson: JSON.stringify(segmentMetadata),
                idempotencyKey: deterministicMaterial.deterministicKey,
                requestPayloadHash: pipelineOutput.contentHash,
            };
        } catch (pipelineError) {
            console.warn('[VoicePreprocessor] Falling back to raw audio upload.', pipelineError);
            lastVoiceSessionMetadataRef.current = null;
            lastVoiceIdempotencySeedRef.current = null;
            return {
                base64: audioData.base64,
                mimeType: audioData.mimeType,
            };
        }
    };

    // VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.12) — drive the SSE consumer
    // and synthesize a VoiceParseResult so downstream code stays path-agnostic.
    // Field arrivals stream into voiceStreamingFieldsArrived for live UX; the
    // payload only commits on the terminal `complete` event (per backend contract,
    // field_complete events carry null fieldValue today). Errors fall through as
    // a normal failure VoiceParseResult — the existing setError path handles them.
    const runStreamingParse = async (
        payload: { type: 'audio' | 'text' } & Record<string, unknown>,
    ): Promise<VoiceParseResult> => {
        setVoiceStreamingPhase('streaming');
        const fieldsArrived = new Set<string>();
        setVoiceStreamingFieldsArrived(fieldsArrived);

        let streamPayload: AgriLogResponse | null = null;
        let streamError: string | null = null;
        let streamPromptVersion: string | undefined;
        let streamModelMs: number | undefined;

        try {
            const stream = parser.parseInputStream!(
                payload as unknown as Parameters<NonNullable<VoiceParserPort['parseInputStream']>>[0],
                logScope,
                crops,
                farmerProfile,
                { focusCategory: undefined },
            );
            await parseVoiceToDraftStream(stream, {
                onFieldComplete: (fieldPath) => {
                    fieldsArrived.add(fieldPath);
                    // Replace the Set reference so React picks up the change.
                    setVoiceStreamingFieldsArrived(new Set(fieldsArrived));
                },
                onComplete: (completePayload, meta) => {
                    streamPayload = completePayload;
                    streamPromptVersion = meta.promptVersion;
                    streamModelMs = meta.modelMs;
                },
                onError: (errMsg, meta) => {
                    streamError = errMsg;
                    streamPromptVersion = meta.promptVersion;
                    streamModelMs = meta.modelMs;
                },
            });
        } catch (streamException) {
            streamError = streamException instanceof Error
                ? streamException.message
                : 'Voice stream failed.';
        }

        if (streamPayload) {
            setVoiceStreamingPhase('complete');
            const provenance: LogProvenance = {
                source: 'ai',
                timestamp: new Date().toISOString(),
                promptVersion: streamPromptVersion,
                processingTimeMs: streamModelMs,
            };
            return {
                success: true,
                data: streamPayload,
                provenance,
            };
        }

        setVoiceStreamingPhase('error');
        return {
            success: false,
            error: streamError ?? 'Voice stream returned no payload.',
        };
    };

    const handleAudioReady = async (audioData: AudioData) => {
        setStatus('processing');
        setError(null);
        const preprocessed = await preprocessAudio(audioData);
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix (Option
        // B): pass the recordedAtUtc from the recorder upward to the
        // VoiceInput envelope so AgriSyncClient.parseVoiceLog can send
        // it as the multipart `recorded_at` form field. If a legacy
        // AudioRecorder build didn't stamp the field, fall back to now
        // — this is still closer to recording-time than the server's
        // request-receipt wall clock would be.
        const recordedAtUtc = audioData.recordedAtUtc ?? new Date().toISOString();
        await processInput({
            type: 'audio',
            data: preprocessed.base64,
            mimeType: preprocessed.mimeType,
            inputSpeechDurationMs: preprocessed.inputSpeechDurationMs,
            inputRawDurationMs: preprocessed.inputRawDurationMs,
            segmentMetadataJson: preprocessed.segmentMetadataJson,
            idempotencyKey: preprocessed.idempotencyKey,
            requestPayloadHash: preprocessed.requestPayloadHash,
            recordedAtUtc,
        });
    };

    const handleTextReady = async (text: string) => {
        await processInput({ type: 'text', data: text }); // mimeType not needed for text
    };

    const processInput = async (input: {
        type: 'audio' | 'text';
        data: string;
        mimeType?: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        idempotencyKey?: string;
        requestPayloadHash?: string;
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — only
        // applies to the audio branch; text inputs don't have a
        // recording moment (the farmer typed). When present, threaded
        // into VoiceInput so BackendAiClient can stamp the multipart
        // form field.
        recordedAtUtc?: string;
    }) => {
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
        const focusBucket = focusCategory ? normalizeLegacyLogSegmentId(focusCategory) : undefined;

        try {
            // Construct correct payload type — forward preprocessor metadata for audio
            // so BackendAiClient uses authoritative durations and idempotency key.
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — also
            // forward recordedAtUtc so the backend structurer resolves
            // "काल"/"आज" against the recording instant, not request-receipt.
            const payload = payloadInput.type === 'audio'
                ? {
                    type: 'audio' as const,
                    data: payloadInput.data,
                    mimeType: payloadInput.mimeType!,
                    inputSpeechDurationMs: payloadInput.inputSpeechDurationMs,
                    inputRawDurationMs: payloadInput.inputRawDurationMs,
                    segmentMetadataJson: payloadInput.segmentMetadataJson,
                    idempotencyKey: payloadInput.idempotencyKey,
                    requestPayloadHash: payloadInput.requestPayloadHash,
                    recordedAtUtc: payloadInput.recordedAtUtc,
                }
                : { type: 'text' as const, content: payloadInput.data };

            // VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.12) — streaming routing.
            // Conditions for the SSE path: flag on AND adapter implements
            // parseInputStream AND input is text. Audio always uses the batch
            // path (the streaming endpoint accepts only transcripts today;
            // STT-then-stream is a future phase). On any precondition miss
            // the existing batch path runs unchanged.
            const canStream =
                DEFAULT_VOICE_CONFIG.useStreamingParse &&
                typeof parser.parseInputStream === 'function' &&
                payload.type === 'text';

            let result: VoiceParseResult;
            if (canStream) {
                result = await runStreamingParse(payload);
            } else {
                result = await parseVoiceToDraft(
                    payload,
                    logScope,
                    crops,
                    farmerProfile,
                    parser,
                    { focusCategory: focusCategory || undefined }
                );
            }

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

            // Always show ManualEntry for review — never skip to auto-save.
            // User must see what was parsed before it is written to the ledger.

            // FUTURE: if selections.length > 1 and draftLog is ready, auto-open wizard
            if (isSegmentUpdate) {
                const mergedDraft = { ...draftLog! };

                // Merge Logic aligned with App.tsx
                if (focusBucket === 'cropActivities' && response.cropActivities.length > 0) mergedDraft.cropActivities = response.cropActivities;
                if (focusBucket === 'irrigation' && response.irrigation.length > 0) mergedDraft.irrigation = response.irrigation;
                if (focusBucket === 'labour' && response.labour.length > 0) mergedDraft.labour = response.labour;
                if (focusBucket === 'inputs' && response.inputs.length > 0) mergedDraft.inputs = response.inputs;
                if (focusBucket === 'machinery' && response.machinery.length > 0) mergedDraft.machinery = response.machinery;
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

                if (focusBucket === 'labour' && response.labour.length > 0) {
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
        setVoiceStreamingPhase('idle');
        setVoiceStreamingFieldsArrived(new Set());
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
        clarificationNeeded, // EXPOSE FOR UI
        // VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.12) — streaming UX state.
        // Consumers (LogWizardContainer wrapper) may render an "AI is reading…"
        // indicator while voiceStreamingPhase === 'streaming'. Both stay
        // idle/empty whenever the batch path runs.
        voiceStreamingPhase,
        voiceStreamingFieldsArrived,
    };
};
