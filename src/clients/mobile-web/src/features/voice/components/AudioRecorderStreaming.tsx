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
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, AlertCircle, ArrowUp, X } from 'lucide-react';
import { AudioData } from '../../../types';
import { useLanguage } from '../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../shared/utils/haptics';
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
}) => {
  const { t } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [internalError, setInternalError] = useState<string | null>(null);

  const displayError = externalError || internalError;

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

      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const currentDuration = Math.floor((Date.now() - startTime) / 1000);
        setDuration(currentDuration);
        if (currentDuration >= 60) {
          // Auto-stop at 60s — same as AudioRecorder.tsx behavior.
          void stopRecording();
        }
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone (streaming):', err);
      setInternalError(t('voice.micError'));
      setIsRecording(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopRecording is a stable callback
  }, [t]);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current || !isRecording) return;

    // VOICE_LATENCY_PIPELINE_V2 perf instrumentation (Step 4) — streaming path entry mark.
    try { performance.mark('voice:stop'); } catch { /* observability-only */ }

    setIsRecording(false);
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
      setInternalError(t('voice.micError'));
    } finally {
      recorderRef.current = null;
      trimmerRef.current = null;
      hasherRef.current = null;
    }
  }, [isRecording, onAudioCaptured, t]);

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="flex flex-col items-center justify-center p-10 bg-white/80 backdrop-blur-2xl rounded-[3rem] shadow-2xl shadow-emerald-100/50 mb-[-2rem] pb-24 relative z-0 border-t border-white/60 overflow-hidden"
      style={{
        maskImage: 'radial-gradient(circle at 50% 100%, transparent 40px, black 40.5px)',
        WebkitMaskImage: 'radial-gradient(circle at 50% 100%, transparent 40px, black 40.5px)'
      }}
    >
      {disabled && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-start pt-12 cursor-pointer transition-all duration-300 animate-in fade-in"
          onClick={onRequestContextSelection}
        >
          <div className="absolute top-4 animate-bounce text-emerald-600">
            <ArrowUp size={48} strokeWidth={2.5} />
          </div>
          <div className="bg-white/90 backdrop-blur-md p-6 rounded-3xl shadow-xl mt-8 border border-emerald-100 max-w-[280px] text-center transform hover:scale-105 transition-transform">
            <p className="text-lg font-black text-slate-800 leading-snug">
              {t('voice.selectCropFirst')}
            </p>
            <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider mt-3">
              {t('voice.tapToSelect')}
            </p>
          </div>
        </div>
      )}

      <div className={`flex flex-col items-center w-full transition-all duration-500 ${disabled ? 'blur-md opacity-30 pointer-events-none grayscale' : ''}`}>

        <div className="relative mb-8">
          {suggestInteraction && !isRecording && (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 opacity-100 animate-ping" style={{ animationDuration: '2s' }}></div>
              <div className="absolute -inset-6 rounded-full border-2 border-emerald-600/20 opacity-40 animate-pulse"></div>
            </>
          )}

          <button
            onClick={isRecording ? () => { void stopRecording(); } : (!disabled ? () => { void startRecording(); } : onRequestContextSelection)}
            disabled={false}
            className={`relative flex items-center justify-center w-32 h-32 rounded-full transition-all duration-500 outline-none z-10 group
              ${disabled
                ? 'bg-stone-200 cursor-not-allowed shadow-none grayscale opacity-70 ring-4 ring-stone-100'
                : isRecording
                  ? 'bg-gradient-to-br from-rose-500 to-red-600 scale-110 shadow-red-500/50 shadow-2xl ring-4 ring-rose-200'
                  : suggestInteraction
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 scale-110 shadow-2xl shadow-emerald-500/40 ring-4 ring-emerald-500/20'
                    : 'bg-gradient-to-br from-emerald-400 to-emerald-600 hover:scale-105 shadow-emerald-500/30 shadow-xl cursor-pointer ring-4 ring-transparent hover:ring-emerald-200'
              }
            `}
            aria-label={isRecording ? "Stop Recording" : disabled ? "Select a Plot First" : "Start Recording"}
          >
            {!disabled && <div className="absolute inset-x-4 top-2 h-1/2 bg-gradient-to-b from-white/40 to-transparent rounded-full opacity-80 pointer-events-none"></div>}
            <div className="absolute inset-0 rounded-full shadow-inner opacity-30 pointer-events-none mix-blend-multiply"></div>
            {isRecording && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-20 animate-ping"></span>
            )}
            {isRecording ? (
              <div className="text-white drop-shadow-md">
                <Square size={36} fill="currentColor" className="animate-pulse" />
              </div>
            ) : (
              <div className={`text-white drop-shadow-md transform transition-transform group-hover:scale-110 ${disabled ? 'opacity-50' : ''}`}>
                <Mic size={48} className={suggestInteraction ? 'animate-bounce-subtle' : ''} />
              </div>
            )}
          </button>
        </div>

        {isRecording && (
          <button
            type="button"
            onClick={() => {
              hapticFeedback.medium();
              cancelRecording();
            }}
            className="mb-4 flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-6 py-2.5 text-sm font-bold text-rose-600 active:scale-95 transition-all duration-150"
          >
            <X size={14} strokeWidth={2.5} />
            {t('voice.discardRecording')}
          </button>
        )}

        <div className="text-center mb-6 w-full">
          {isRecording ? (
            <div>
              <h3 className="text-2xl font-bold text-stone-800 mb-2">{t('logPage.listening')}</h3>
              <p className="text-6xl font-mono font-medium text-emerald-700 tracking-wider tabular-nums">{formatTime(duration)}</p>
            </div>
          ) : (
            <div>
              <h3 className="text-2xl font-bold text-stone-800">{t('voice.startLogging')}</h3>
              <p className="text-stone-400 text-lg mt-2 mb-4">{t('voice.tapToSpeak')}</p>
            </div>
          )}
        </div>

        {displayError && (
          <div className="flex flex-col items-center w-full mb-6 animate-in slide-in-from-top-2">
            <div className="bg-red-50 text-red-700 px-6 py-4 rounded-xl text-center font-medium border border-red-100 shadow-sm w-full">
              <div className="flex items-center justify-center gap-2 mb-1">
                <AlertCircle size={20} />
                <span className="font-bold">{t('voice.checkInput')}</span>
              </div>
              {displayError}
            </div>
            {transcript && (
              <div className="mt-3 w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-600 italic text-sm text-center">
                "{transcript}"
              </div>
            )}
          </div>
        )}

        {!isRecording && (
          <div className="w-full mt-2 animate-in fade-in slide-in-from-bottom-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled) return;
                const input = (e.currentTarget.elements.namedItem('textInput') as HTMLInputElement);
                const text = input.value.trim();
                if (text && onTextCaptured) {
                  onTextCaptured(text);
                  input.value = '';
                }
              }}
              className={`relative group transition-opacity duration-300 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <input
                name="textInput"
                type="text"
                disabled={disabled}
                placeholder={disabled ? t('voice.selectPlotAbove') : t('voice.orTypeHere')}
                className="w-full bg-slate-100/50 backdrop-blur-sm border border-slate-200 text-slate-700 font-medium px-4 py-3.5 rounded-xl shadow-inner outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white transition-all text-center placeholder:text-slate-400 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={disabled}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-white rounded-lg opacity-0 group-focus-within:opacity-100 transition-opacity shadow-lg scale-90 active:scale-95 disabled:bg-stone-400"
              >
                <ArrowUp size={18} strokeWidth={3} />
              </button>
            </form>
          </div>
        )}

        {isRecording && duration >= 50 && (
          <div className="animate-pulse text-amber-600 font-bold mb-4 text-center">
            {t('voice.autoStopping').replace('{seconds}', String(60 - duration))}
          </div>
        )}

        {isRecording && (
          <p className="text-stone-400 text-sm animate-pulse">{t('voice.tapToStop')}</p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorderStreaming;
