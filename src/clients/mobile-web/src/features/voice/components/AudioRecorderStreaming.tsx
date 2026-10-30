/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 Phase 2 — sibling of AudioRecorder.tsx.
 * Same prop contract, same callback shape, byte-for-byte identical UI.
 * Internally swaps MediaRecorder for the streaming PCM pipeline:
 *   StreamingPcmRecorder → StreamingSilenceTrimmer + StreamingHasher (live during recording)
 *   On stop: VoicePreprocessor.processStreamingResult → encoded webm Blob.
 *
 * Mount-gated by DEFAULT_VOICE_CONFIG.streamingPcm.enabled (default false).
 * When the flag flips, this is the recorder users get; until then it's
 * dead code by flag.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — it shows the SAME founder-approved
 * face as AudioRecorder (`recorder/RecorderFace`). Its level meter listens to the recorder's own
 * live stream through the read-only `StreamingPcmRecorder.liveStream`; capture, trim, hash and
 * encode are untouched.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AudioData } from '../../../types';
import { useMicLevel } from '../hooks/useMicLevel';
import RecorderFace from './recorder/RecorderFace';
import { AUTO_STOP_SEC, REC_WORDS, readableError } from './recorder/recorderWords';
import { DEFAULT_VOICE_CONFIG } from '../../../infrastructure/voice/types';
import { StreamingPcmRecorder } from '../../../infrastructure/voice/StreamingPcmRecorder';
import { StreamingSilenceTrimmer } from '../../../infrastructure/voice/StreamingSilenceTrimmer';
import { StreamingHasher } from '../../../infrastructure/voice/StreamingHasher';
import { VoicePreprocessor } from '../../../infrastructure/voice/VoicePreprocessor';
import { VoiceIdempotency } from '../../../infrastructure/voice/VoiceIdempotency';

interface AudioRecorderStreamingProps {
  onAudioCaptured: (audioData: AudioData) => void;
  onTextCaptured?: (text: string) => void;
  disabled?: boolean;
  externalError?: string | null;
  transcript?: string;
  suggestInteraction?: boolean;
  onRequestContextSelection?: () => void;
  /** Fired the instant Stop is tapped, BEFORE the heavy trim/encode/hash +
   *  base64 finalize work, so the parent paints the processing banner with zero
   *  latency (voice-live-captions-banner-2026-06-10). */
  onProcessingStart?: () => void;
  /** Told when the mic starts / stops listening (the entry flow hides its choices meanwhile). */
  onRecordingChange?: (recording: boolean) => void;
}

async function blobToBase64NoPrefix(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf(',');
      if (idx < 0) {
        reject(new Error('Unable to encode audio for upload.'));
        return;
      }
      resolve(result.slice(idx + 1));
    };
    reader.onerror = () => reject(new Error('FileReader failed while encoding audio.'));
    reader.readAsDataURL(blob);
  });
}

const AudioRecorderStreaming: React.FC<AudioRecorderStreamingProps> = ({
  onAudioCaptured,
  onTextCaptured,
  disabled,
  externalError,
  transcript,
  suggestInteraction,
  onRequestContextSelection,
  onProcessingStart,
  onRecordingChange,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  // I12-V1-m3 — the mic's own failure, in Marathi whatever the app language; its technical cause
  // (`internalErrorCode`) is kept apart and never shown as words.
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalErrorCode, setInternalErrorCode] = useState<string | null>(null);
  // I12 — the recorder's own live stream, ONLY so the level meter can listen; and two facts the face needs.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [micRefused, setMicRefused] = useState(false);
  const [lastInputTyped, setLastInputTyped] = useState(false);
  const level = useMicLevel(isRecording ? liveStream : null);

  // An English message from the parse service is shown as plain Marathi (no English on this screen).
  const displayError = externalError ? readableError(externalError) : internalError;

  const recordingChangeRef = useRef(onRecordingChange);
  recordingChangeRef.current = onRecordingChange;
  useEffect(() => { recordingChangeRef.current?.(isRecording); }, [isRecording]);

  const recorderRef = useRef<StreamingPcmRecorder | null>(null);
  const trimmerRef = useRef<StreamingSilenceTrimmer | null>(null);
  const hasherRef = useRef<StreamingHasher | null>(null);
  const preprocessorRef = useRef<VoicePreprocessor | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const ensurePreprocessor = (): VoicePreprocessor => {
    if (!preprocessorRef.current) {
      preprocessorRef.current = new VoicePreprocessor(DEFAULT_VOICE_CONFIG);
    }
    return preprocessorRef.current;
  };

  const startRecording = useCallback(async () => {
    setInternalError(null);
    setInternalErrorCode(null);
    setMicRefused(false);
    cancelledRef.current = false;

    try {
      const trimmer = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
      const hasher = new StreamingHasher();
      const recorder = new StreamingPcmRecorder(DEFAULT_VOICE_CONFIG.streamingPcm);

      trimmerRef.current = trimmer;
      hasherRef.current = hasher;
      recorderRef.current = recorder;

      await recorder.start((frame) => {
        trimmer.feed(frame);
        hasher.feed(frame);
      });

      setIsRecording(true);
      setLastInputTyped(false);
      setLiveStream(recorder.liveStream ?? null);

      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const currentDuration = Math.floor((Date.now() - startTime) / 1000);
        setDuration(currentDuration);
        if (currentDuration >= AUTO_STOP_SEC) {
          // Auto-stop at the one limit — same as AudioRecorder.tsx. Through the ref: this timer is made
          // once, and the `stopRecording` of that first render still believed nothing was recording, so
          // the stop never came while the face counted down to "0 सेकंदात आपोआप थांबेल" (lane V-1, P5).
          void stopRecordingRef.current();
        }
      }, 1000);
    } catch (err) {
      // Keep the precise cause. A worklet/module load failure (the addModule 404) shows a
      // non-permission error name here, which distinguishes it from a genuine getUserMedia
      // denial. I12-V1-m3: not appended to the farmer's words (no English on this screen);
      // it rides on the error box as `data-error-code` and in the console.
      const name = (err as { name?: string })?.name || 'Error';
      console.error('Error accessing microphone (streaming):', err);
      // A refusal is the farmer's/OS's decision, not a fault: say the typing route is open
      // (same wording as AudioRecorder). Tapping the mic again asks the OS again.
      setMicRefused(name === 'NotAllowedError');
      setInternalError(name === 'NotAllowedError' ? REC_WORDS.micDenied : REC_WORDS.micError);
      setInternalErrorCode(name);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current || !isRecording) return;

    // VOICE_LATENCY_PIPELINE_V2 perf instrumentation (Step 4) — streaming path entry mark.
    try { performance.mark('voice:stop'); } catch { /* observability-only */ }

    setIsRecording(false);
    setLiveStream(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setDuration(0);

    const recorder = recorderRef.current;
    const trimmer = trimmerRef.current;
    const hasher = hasherRef.current;

    try {
      const recording = await recorder.stop();

      if (cancelledRef.current) {
        // Cancel path: drop the recording, do not emit.
        return;
      }

      if (!trimmer || !hasher) {
        console.warn('[AudioRecorderStreaming] missing trimmer/hasher refs; aborting emit.');
        return;
      }

      // BANNER LATENCY FIX (voice-live-captions-banner-2026-06-10): the recorder
      // has stopped and we're committed to emitting — paint the processing banner
      // NOW, before the heavy processStreamingResult (encode) + base64 below that
      // otherwise delay onAudioCaptured (and thus the banner) by the full finalize
      // time. Placed AFTER recorder.stop() so flipping status (which unmounts this
      // recorder block) cannot race the in-flight stop.
      onProcessingStart?.();

      const sessionId = VoiceIdempotency.createSessionId();
      const farmId = 'unknown-farm'; // useVoiceRecorder downstream resolves the real farmId
      // processStreamingResult emits its own internal marks (voice:trim-finalize-done,
      // voice:encode-done, voice:hash-done) and matching span measures.
      const result = await ensurePreprocessor().processStreamingResult({
        recording,
        trimmer,
        hasher,
        sessionId,
        farmId,
      });

      const base64 = await blobToBase64NoPrefix(result.audioBlob);

      try { performance.mark('voice:emit'); } catch { /* observability-only */ }
      try { performance.measure('voice:streaming-emit', 'voice:hash-done', 'voice:emit'); } catch { /* duplicate-name in same session */ }
      try { performance.measure('voice:streaming-total', 'voice:stop', 'voice:emit'); } catch { /* duplicate-name in same session */ }

      // Match AudioRecorder.tsx's onAudioCaptured shape byte-for-byte:
      // { blob, base64, mimeType } where mimeType is 'audio/webm' (no codec suffix).
      onAudioCaptured({
        blob: result.audioBlob,
        base64,
        mimeType: 'audio/webm',
      });
    } catch (err) {
      console.error('Error finalizing streaming recording:', err);
      setInternalError(REC_WORDS.micError);
    } finally {
      recorderRef.current = null;
      trimmerRef.current = null;
      hasherRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onProcessingStart is optional + behavior-stable (parent's setStatus from useState is stable); omitting it keeps stopRecording stable for the unmount-cleanup effect
  }, [isRecording, onAudioCaptured]);
  // The latest stopRecording, for the timer made once in startRecording.
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const cancelRecording = useCallback(() => {
    if (recorderRef.current && isRecording) {
      cancelledRef.current = true;
      void stopRecording();
      return;
    }
    setDuration(0);
  }, [isRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      // Best-effort cleanup; recorder.stop() is async and we don't await on unmount.
      const r = recorderRef.current;
      if (r) {
        void r.stop().catch(() => {});
      }
    };
  }, []);

  const sendTyped = useCallback((text: string) => {
    setLastInputTyped(true);
    onTextCaptured?.(text);
  }, [onTextCaptured]);

  return (
    <RecorderFace
      isRecording={isRecording}
      seconds={duration}
      level={level}
      disabled={disabled}
      suggest={suggestInteraction}
      error={displayError}
      errorCode={externalError ? null : internalErrorCode}
      transcript={transcript}
      lastInputTyped={lastInputTyped}
      micRefused={micRefused}
      onStart={() => { void startRecording(); }}
      onStop={() => { void stopRecording(); }}
      onCancel={cancelRecording}
      onRequestContextSelection={onRequestContextSelection}
      onTextCaptured={onTextCaptured ? sendTyped : undefined}
    />
  );
};

export default AudioRecorderStreaming;
