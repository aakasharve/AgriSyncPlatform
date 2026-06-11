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
import { TranscribeStreamConsumer } from '../../infrastructure/ai/TranscribeStreamConsumer';

// TASK 3 (voice-live-captions-banner-2026-06-10) — yield to the browser so a
// just-committed React state change can paint before heavy synchronous-ish
// work runs on the same async stack. Prefers requestAnimationFrame (fires
// right before the next paint); falls back to a setTimeout(0) macrotask when
// rAF is unavailable (jsdom / non-browser). Resolves immediately if neither
// exists. Kept out of the component so it's allocation-free per render.
const yieldToPaint = (): Promise<void> =>
    new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
            return;
        }
        if (typeof setTimeout === 'function') {
            setTimeout(() => resolve(), 0);
            return;
        }
        resolve();
    });

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
    //
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2 (cost-safe
    // 2-stage client split): the union gains `'transcribing'`. When audio
    // input arrives and the live-caption path is enabled, handleAudioReady
    // runs a Sarvam transcribe-stream stage first (phase='transcribing'),
    // streaming `transcript_partial` events into `liveCaption` state for the
    // mounted `<LiveCaption />` to render. On `transcript_final`, the flow
    // converts the result into a text payload and re-enters processInput,
    // which routes through the existing streaming Gemini structurer
    // (phase='streaming'). Net Sarvam call count per recording stays at 1;
    // the structurer parse-voice-stream call sends `transcript` text only
    // (no audio re-upload), and the server-side path is Gemini-only.
    const [voiceStreamingPhase, setVoiceStreamingPhase] = useState<'idle' | 'transcribing' | 'streaming' | 'complete' | 'error'>('idle');
    const [voiceStreamingFieldsArrived, setVoiceStreamingFieldsArrived] = useState<ReadonlySet<string>>(() => new Set());
    const [liveCaption, setLiveCaption] = useState<string>('');
    const lastVoiceSessionMetadataRef = useRef<VoiceSessionMetadata | null>(null);
    const lastVoiceIdempotencySeedRef = useRef<string | null>(null);
    const transcribeConsumerRef = useRef<TranscribeStreamConsumer | null>(null);
    const transcribeAbortRef = useRef<AbortController | null>(null);
    if (!transcribeConsumerRef.current) {
        transcribeConsumerRef.current = new TranscribeStreamConsumer();
    }

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

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2
    // stage 1: Sarvam transcribe-stream. Opens an SSE against
    // POST /shramsafal/ai/transcribe-stream, streams `transcript_partial`
    // chunks into `liveCaption` state, and resolves to the assembled
    // transcript (or an error). The blob argument is the raw recorded
    // audio (pre-preprocessor) because TranscribeStreamConsumer ships a
    // multipart form containing the original blob — server-side ffmpeg
    // handles transcoding to PCM 16 kHz mono per Phase 2.3a.
    //
    // Cost note: this is the ONLY Sarvam call per recording. The stage-2
    // parse-voice-stream call (handled by runStreamingParse via the
    // existing text branch) is Gemini-only and never re-issues a Sarvam
    // request — verified in BackendAiClient.streamOrFallback where the
    // text path goes through fetchParseVoiceStream (Gemini structurer).
    const runTranscribeStage = async (
        blob: Blob,
        recordedAtUtc: string,
    ): Promise<{ transcript: string } | { error: string }> => {
        setVoiceStreamingPhase('transcribing');
        setLiveCaption('');
        // Reset any previous structurer field-arrivals so the wizard does
        // not surface stale indicators while the new transcribe runs.
        setVoiceStreamingFieldsArrived(new Set());

        // Cancel any prior in-flight transcribe (defensive — typical flow
        // is one stream per recording but a user double-tap could race).
        if (transcribeAbortRef.current) {
            transcribeAbortRef.current.abort();
        }
        const controller = new AbortController();
        transcribeAbortRef.current = controller;

        let assembled = '';
        let finalTranscript: string | null = null;
        let streamError: string | null = null;

        try {
            for await (const event of transcribeConsumerRef.current!.consume(
                blob,
                'mr-IN',
                'codemix',
                recordedAtUtc,
                controller.signal,
            )) {
                if (controller.signal.aborted) break;
                if (event.type === 'transcript_partial') {
                    // Backend wire semantics: each partial is the DELTA to
                    // append (per useTranscribeStream comment). Mirror the
                    // existing hook's accumulation behavior.
                    assembled += event.text;
                    setLiveCaption(assembled);
                } else if (event.type === 'transcript_final') {
                    finalTranscript = event.text;
                    // Final may be the full assembled string or a redacted
                    // canonical form. Show it as the caption surface.
                    setLiveCaption(event.text);
                } else if (event.type === 'error') {
                    streamError = event.message || event.code || 'Transcribe stream error.';
                }
            }
        } catch (err) {
            if (controller.signal.aborted) {
                return { error: 'aborted' };
            }
            streamError = err instanceof Error && err.message
                ? err.message
                : 'Voice transcribe stream failed.';
        } finally {
            if (transcribeAbortRef.current === controller) {
                transcribeAbortRef.current = null;
            }
        }

        if (streamError) {
            return { error: streamError };
        }
        const transcript = (finalTranscript ?? assembled).trim();
        if (!transcript) {
            return { error: 'Transcribe stream returned empty transcript.' };
        }
        return { transcript };
    };

    const handleAudioReady = async (audioData: AudioData) => {
        setStatus('processing');
        setError(null);
        // TASK 3 (voice-live-captions-banner-2026-06-10): the "Your Shram
        // sathi is trying to understand…" banner is driven by status ===
        // 'processing'. preprocessAudio below is heavy (AudioWorklet
        // silence-trim + hashing + base64) and, run synchronously in the
        // same tick as the setStatus commit, blocks the browser from
        // painting the banner until it finishes — so on long clips the
        // banner appears late. Yield to the next animation frame (with a
        // macrotask fallback for non-rAF environments / jsdom) so React
        // flushes the 'processing' state and the browser paints the banner
        // BEFORE the heavy preprocessing starts. This is purely a paint
        // ordering fix: no change to what runs, only when the first paint
        // happens relative to the CPU work.
        await yieldToPaint();
        const preprocessed = await preprocessAudio(audioData);
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix (Option
        // B): pass the recordedAtUtc from the recorder upward to the
        // VoiceInput envelope so AgriSyncClient.parseVoiceLog can send
        // it as the multipart `recorded_at` form field. If a legacy
        // AudioRecorder build didn't stamp the field, fall back to now
        // — this is still closer to recording-time than the server's
        // request-receipt wall clock would be.
        const recordedAtUtc = audioData.recordedAtUtc ?? new Date().toISOString();

        // The single PROVEN batch audio path — the guaranteed safety net.
        // /ai/voice-parse → Gemini multimodal → buckets. This is invoked
        // when streaming is off OR when ANY streaming stage fails. Its
        // behavior is preserved exactly as the pre-streaming flow.
        const runBatchAudioPath = (): Promise<void> =>
            processInput({
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

        // SARVAM_PRIMARY_VOICE_PIPELINE / voice-sarvam-live-captions-2026-06-11
        // — LiveCaption is the PRIMARY voice path: attempt the 2-stage
        // streaming flow (Sarvam transcribe-stream = the live caption →
        // Gemini parse-voice-stream with text). Preconditions: the parser
        // exposes parseInputStream (so stage 2 is reachable), the
        // streaming-parse flag is on, the browser is online, and the
        // recording produced a blob. On ANY precondition miss OR ANY
        // streaming failure (transcribe error/empty/network, parse error/
        // no-terminal-event), we fall through to runBatchAudioPath so a log
        // is ALWAYS created and auto-bucketed — the founder rule "voice can
        // NEVER break" holds.
        const canRunLiveCaption =
            DEFAULT_VOICE_CONFIG.useStreamingParse
            && typeof parser.parseInputStream === 'function'
            && (typeof navigator === 'undefined' || navigator.onLine)
            && !!audioData.blob;

        if (canRunLiveCaption) {
            const result = await runTranscribeStage(audioData.blob, recordedAtUtc);
            if ('transcript' in result) {
                // Stage 2: text-only parse via the streaming structurer.
                // runStreamingTextParse returns true only when the stream
                // delivered a usable draft (terminal `complete` with a
                // payload). On false (terminal error, no-terminal-event,
                // empty payload, or thrown stream), we fall back to the
                // PROVEN batch AUDIO path below — NOT the text payload —
                // so the gold-standard Gemini-multimodal parse runs and a
                // log is guaranteed. The original audio is preserved in
                // `preprocessed` for exactly this purpose.
                const streamCommitted = await runStreamingTextParse(result.transcript, recordedAtUtc);
                if (streamCommitted) {
                    return;
                }
                console.warn('[useVoiceRecorder] streaming parse stage produced no committable draft; falling back to batch audio path.');
                // Reset streaming-side UI so the batch attempt is clean;
                // keep liveCaption so the farmer still sees what was heard.
                setVoiceStreamingPhase('idle');
                setVoiceStreamingFieldsArrived(new Set());
                await runBatchAudioPath();
                return;
            }
            // Transcribe (Stage 1) failed, was empty, or aborted. Fall
            // through to the batch audio path so the save/audit/diary
            // pipeline still runs end-to-end. Reset transcribe-side UI
            // state so the recorder doesn't show stale captions.
            setLiveCaption('');
            setVoiceStreamingPhase('idle');
            if (result.error !== 'aborted') {
                console.warn('[useVoiceRecorder] live-caption transcribe stage failed; falling back to batch audio path.', result.error);
            }
            if (result.error === 'aborted') {
                // User cancelled the recording mid-transcribe — do NOT
                // silently re-submit a batch parse they didn't ask for.
                return;
            }
        }

        await runBatchAudioPath();
    };

    // voice-sarvam-live-captions-2026-06-11 — Stage 2 streaming structurer.
    // Drives parser.parseInputStream over the transcript text and commits the
    // draft on the terminal `complete` event. Returns true ONLY when a usable
    // draft was committed; returns false on every failure mode (terminal
    // error, stream threw, no terminal event, empty payload, IRRELEVANT_INPUT
    // clarification handled here) so handleAudioReady can fall back to the
    // proven batch audio path. This function NEVER sets a terminal user-facing
    // error on stream failure — that decision belongs to the fallback path so
    // voice can never dead-end with no log.
    const runStreamingTextParse = async (
        transcript: string,
        recordedAtUtc: string,
    ): Promise<boolean> => {
        const result = await runStreamingParse({
            type: 'text',
            content: transcript,
            recordedAtUtc,
        } as unknown as { type: 'audio' | 'text' } & Record<string, unknown>);

        if (!result.success || !result.data) {
            // Streaming failed — signal the caller to fall back to batch.
            // Do NOT setError here: the batch fallback is the source of
            // truth for whether voice ultimately succeeded.
            return false;
        }

        return commitParsedDraft(result, transcript);
    };

    // voice-sarvam-live-captions-2026-06-11 — shared draft-commit logic.
    // Extracted from processInput so BOTH the streaming-text stage and the
    // batch path run identical re-entry / IRRELEVANT_INPUT / segment-merge
    // / draft handling. Returns true when the result reached a terminal
    // state (committed a draft, opened a clarification, or surfaced an
    // IRRELEVANT_INPUT) — i.e. nothing more to do. Returns false ONLY when
    // the parse failed and the caller should fall back to the batch path.
    // `originalData` is the transcript/text the input carried, used as the
    // pending-transcript seed for the clarification re-entry flow.
    const commitParsedDraft = async (
        result: VoiceParseResult,
        originalData: string,
    ): Promise<boolean> => {
        if (!result.success || !result.data) {
            return false;
        }

        const isSegmentUpdate = !!draftLog && !!recordingSegment;
        const focusCategory = isSegmentUpdate ? recordingSegment : undefined;
        const focusBucket = focusCategory ? normalizeLegacyLogSegmentId(focusCategory) : undefined;

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
            return true;
        }

        // CHECK: Out of Context / Irrelevant Input
        if (response.dayOutcome === 'IRRELEVANT_INPUT') {
            // PHASE 25: Check for Empathetic Clarification (CONTEXT_CHECK)
            const contextQuestion = response.questionsForUser?.find(q => q.type === 'CONTEXT_CHECK');

            if (contextQuestion) {
                setStatus('idle');
                setClarificationNeeded(contextQuestion);
                // Store the original intent (e.g., "Watered") to combine with the answer
                setPendingTranscript(response.fullTranscript || originalData);
                return true;
            }

            setStatus('idle');
            setError(response.summary || "Input seems unrelated to selected crop.");
            setErrorTranscript(response.fullTranscript); // Show what was heard
            return true;
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
        return true;
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
                // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption
                // Way-2 stage 2: thread recordedAtUtc through to the
                // text-only parse-voice-stream call so the Gemini
                // structurer can still resolve "आज"/"काल" against the
                // original recording instant rather than now(). The
                // payload's text-variant doesn't have a recordedAtUtc
                // in its compile-time shape; BackendAiClient reads it
                // via a runtime cast (see fetchParseVoiceStream).
                : { type: 'text' as const, content: payloadInput.data, recordedAtUtc: payloadInput.recordedAtUtc };

            // VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.12) — streaming routing.
            // Conditions for the SSE path: flag on AND adapter implements
            // parseInputStream AND input is text. Audio always uses the batch
            // path (the streaming endpoint accepts only transcripts today;
            // STT-then-stream is a future phase). On any precondition miss
            // the existing batch path runs unchanged.
            //
            // voice-sarvam-live-captions-2026-06-11 — NOTE: the PRIMARY
            // streaming flow for voice now enters via handleAudioReady →
            // runStreamingTextParse (which calls runStreamingParse directly
            // and falls back to the batch AUDIO path on failure). This
            // canStream branch still covers text inputs that arrive through
            // handleTextReady / clarification re-entry; on streaming failure
            // here the batch TEXT path (parseVoiceToDraft) runs so a log is
            // still created from the typed/combined text.
            const canStream =
                DEFAULT_VOICE_CONFIG.useStreamingParse &&
                typeof parser.parseInputStream === 'function' &&
                payload.type === 'text';

            let result: VoiceParseResult;
            if (canStream) {
                result = await runStreamingParse(payload);
                if (!result.success || !result.data) {
                    // voice-sarvam-live-captions-2026-06-11 — streaming text
                    // parse failed; fall back to the batch TEXT path so a log
                    // is still created from the same transcript rather than
                    // dead-ending with an error.
                    console.warn('[useVoiceRecorder] streaming text parse failed; falling back to batch text path.', result.error);
                    setVoiceStreamingPhase('idle');
                    setVoiceStreamingFieldsArrived(new Set());
                    result = await parseVoiceToDraft(
                        payload,
                        logScope,
                        crops,
                        farmerProfile,
                        parser,
                        { focusCategory: focusCategory || undefined }
                    );
                }
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

            await commitParsedDraft(result, input.data);

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
        // Abort any in-flight transcribe stream + clear live captions.
        if (transcribeAbortRef.current) {
            transcribeAbortRef.current.abort();
            transcribeAbortRef.current = null;
        }
        setLiveCaption('');
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
        //
        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2:
        // `liveCaption` accumulates Sarvam transcript_partial chunks during
        // voiceStreamingPhase === 'transcribing'. Consumers mount the
        // <LiveCaption /> component reading this value to surface
        // farmer-visible live text. Stays empty on the batch fallback path.
        voiceStreamingPhase,
        voiceStreamingFieldsArrived,
        liveCaption,
    };
};
