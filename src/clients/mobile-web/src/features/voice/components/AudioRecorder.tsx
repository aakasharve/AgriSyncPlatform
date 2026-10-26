/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The batch (MediaRecorder) recorder. HOW audio is captured and handed on is unchanged: one
 * MediaRecorder on the mic stream, chunks -> one audio/webm Blob -> base64 -> `onAudioCaptured`,
 * auto-stop at 60 s, cancel empties the chunks (the clip is discarded).
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-04, LP-06) — what it SHOWS is the
 * founder-approved mic (`recorder/RecorderFace`): his sentence on the idle card, "ऐकत आहे" with a
 * LIVE level meter (an AnalyserNode that only listens to this same stream), the stop hint after 10 s,
 * cancel set apart, and the quiet "type instead" way in (same `onTextCaptured` parse as before).
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AudioData } from '../../../types';
import { acquireMicStream } from '../../../infrastructure/voice/acquireMicStream';
import { useMicLevel } from '../hooks/useMicLevel';
import RecorderFace from './recorder/RecorderFace';
import { REC_WORDS, readableError } from './recorder/recorderWords';

interface AudioRecorderProps {
  onAudioCaptured: (audioData: AudioData) => void;
  onTextCaptured?: (text: string) => void;
  disabled?: boolean;
  externalError?: string | null;
  transcript?: string;
  suggestInteraction?: boolean;
  onRequestContextSelection?: () => void;
  /** Told when the mic starts / stops listening (the entry flow hides its choices meanwhile). */
  onRecordingChange?: (recording: boolean) => void;
  /** The real hand-filled form, offered quietly in the typing sheet. */
  onOpenForm?: () => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onAudioCaptured, onTextCaptured, disabled, externalError, transcript, suggestInteraction, onRequestContextSelection, onRecordingChange, onOpenForm }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  // I12-V1-m3 — the mic's own failure, in Marathi whatever the app language; its technical cause
  // (`internalErrorCode`) is kept apart and never shown as words.
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalErrorCode, setInternalErrorCode] = useState<string | null>(null);
  // I12 — the open mic stream, ONLY so the level meter can listen to it; and two facts the face needs.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [micRefused, setMicRefused] = useState(false);
  const [lastInputTyped, setLastInputTyped] = useState(false);
  const level = useMicLevel(isRecording ? liveStream : null);

  // Combine errors: External (from AI) takes precedence if present, otherwise internal (mic permission).
  // An English message from the parse service is shown as plain Marathi (no English on this screen).
  const displayError = externalError ? readableError(externalError) : internalError;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // I12 — a cancelled recording must never be sent. MediaRecorder.stop() fires one LAST
  // `dataavailable` (with everything recorded, when no timeslice is used) and only then `stop`,
  // so emptying the chunks before stop() did not discard anything: the clip was still emitted.
  // The streaming recorder already guards with the same flag.
  const cancelledRef = useRef(false);

  const recordingChangeRef = useRef(onRecordingChange);
  recordingChangeRef.current = onRecordingChange;
  useEffect(() => { recordingChangeRef.current?.(isRecording); }, [isRecording]);

  const startRecording = useCallback(async () => {
    setInternalError(null);
    setInternalErrorCode(null);
    setMicRefused(false);

    // Platform / secure-context guard: navigator.mediaDevices is undefined in insecure
    // contexts and some WebViews; without this it surfaces as a confusing generic
    // "permission" error even though it's really a context/availability problem.
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setInternalError(REC_WORDS.micError);
      setInternalErrorCode('no-mediaDevices');
      return;
    }

    try {
      const stream = await acquireMicStream({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // VOICE_LATENCY_PIPELINE_V2 perf instrumentation (Step 4) — batch path.
        try { performance.mark('voice:processing-start'); } catch { /* observability-only */ }
        if (cancelledRef.current) {
          // Cancel path: drop the recording, do not emit (the clip is discarded).
          chunksRef.current = [];
        }
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64String = reader.result as string;
            const base64 = base64String.split(',')[1];

            try { performance.mark('voice:processing-done'); } catch { /* observability-only */ }
            try { performance.measure('voice:batch-pipeline', 'voice:processing-start', 'voice:processing-done'); } catch { /* duplicate-name in same session */ }
            try { performance.measure('voice:batch-total', 'voice:stop', 'voice:processing-done'); } catch { /* duplicate-name in same session */ }

            onAudioCaptured({
              blob,
              base64,
              mimeType: 'audio/webm'
            });
          };
        }

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        setLiveStream(null);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setLastInputTyped(false);
      setLiveStream(stream);

      // Timer
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const currentDuration = Math.floor((Date.now() - startTime) / 1000);
        setDuration(currentDuration);

        if (currentDuration >= 60) {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
          setIsRecording(false);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, 1000);

    } catch (err) {
      // Keep the precise failure code — it distinguishes denied (NotAllowedError) from
      // mic-busy (NotReadableError), no-device (NotFoundError) or recorder/codec
      // (NotSupportedError). I12-V1-m3: no longer appended to the farmer's words (no English
      // on this screen); it rides on the error box as `data-error-code` and in the console.
      const name = (err as { name?: string })?.name || 'Error';
      console.error("Error accessing microphone:", err);

      // spec: dfes-companion-2026-07-11 (wave-4.3) — REFUSING THE MICROPHONE MUST NOT
      // BLOCK MANUAL ENTRY. The typing way in has always stayed available through a mic
      // failure, and the message says so; I12 also lifts the "type instead" line to full
      // strength, because it is now the way in. A denial is an OS decision, never a
      // withdrawal of consent — nothing here touches the consent record.
      setMicRefused(name === 'NotAllowedError');
      setInternalError(name === 'NotAllowedError' ? REC_WORDS.micDenied : REC_WORDS.micError);
      setInternalErrorCode(name);
    }
  }, [onAudioCaptured]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      // VOICE_LATENCY_PIPELINE_V2 perf instrumentation (Step 4) — batch path entry mark.
      try { performance.mark('voice:stop'); } catch { /* observability-only */ }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDuration(0);
    }
  }, [isRecording]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      cancelledRef.current = true;
      chunksRef.current = [];
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDuration(0);
      return;
    }

    setDuration(0);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
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
      onStop={stopRecording}
      onCancel={cancelRecording}
      onRequestContextSelection={onRequestContextSelection}
      onTextCaptured={onTextCaptured ? sendTyped : undefined}
      onOpenForm={onOpenForm}
    />
  );
};


export default AudioRecorder;
