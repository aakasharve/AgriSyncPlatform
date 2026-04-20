/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, AlertCircle, ArrowUp, X } from 'lucide-react';
import Button from '../../../shared/components/ui/Button';
import { AudioData } from '../../../types';
import { useLanguage } from '../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../shared/utils/haptics';

interface AudioRecorderProps {
  onAudioCaptured: (audioData: AudioData) => void;
  onTextCaptured?: (text: string) => void;
  disabled?: boolean;
  externalError?: string | null;
  transcript?: string;
  suggestInteraction?: boolean;
  onRequestContextSelection?: () => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onAudioCaptured, onTextCaptured, disabled, externalError, transcript, suggestInteraction, onRequestContextSelection }) => {
  const { t } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [internalError, setInternalError] = useState<string | null>(null);

  // Combine errors: External (from AI) takes precedence if present, otherwise internal (mic permission)
  const displayError = externalError || internalError;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    setInternalError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64String = reader.result as string;
            const base64 = base64String.split(',')[1];

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
      };

      mediaRecorder.start();
      setIsRecording(true);

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
      console.error("Error accessing microphone:", err);
      setInternalError(t('voice.micError'));
    }
  }, [onAudioCaptured, t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
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
      {/* LOCKED STATE OVERLAY */}
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

      {/* MAIN CONTENT WRAPPER - BLURS WHEN DISABLED */}
      <div className={`flex flex-col items-center w-full transition-all duration-500 ${disabled ? 'blur-md opacity-30 pointer-events-none grayscale' : ''}`}>

        {/* MIC ICON - CLICK TO START */}
        <div className="relative mb-8">
          {/* WAVE ANIMATION for User Suggestion */}
          {suggestInteraction && !isRecording && (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 opacity-100 animate-ping" style={{ animationDuration: '2s' }}></div>
              <div className="absolute -inset-6 rounded-full border-2 border-emerald-600/20 opacity-40 animate-pulse"></div>
            </>
          )}

          <button
            onClick={isRecording ? stopRecording : (!disabled ? startRecording : onRequestContextSelection)}
            disabled={false} // Clickable for interaction guidance
            className={`relative flex items-center justify-center w-32 h-32 rounded-full transition-all duration-500 outline-none z-10 group
              ${disabled
                ? 'bg-stone-200 cursor-not-allowed shadow-none grayscale opacity-70 ring-4 ring-stone-100' // LOCKED STATE
                : isRecording
                  ? 'bg-gradient-to-br from-rose-500 to-red-600 scale-110 shadow-red-500/50 shadow-2xl ring-4 ring-rose-200'
                  : suggestInteraction
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 scale-110 shadow-2xl shadow-emerald-500/40 ring-4 ring-emerald-500/20'
                    : 'bg-gradient-to-br from-emerald-400 to-emerald-600 hover:scale-105 shadow-emerald-500/30 shadow-xl cursor-pointer ring-4 ring-transparent hover:ring-emerald-200'
              }
            `}
            aria-label={isRecording ? "Stop Recording" : disabled ? "Select a Plot First" : "Start Recording"}
          >
            {/* GLOSS EFFECT OVERLAY (Top Shine) - Hide if disabled */}
            {!disabled && <div className="absolute inset-x-4 top-2 h-1/2 bg-gradient-to-b from-white/40 to-transparent rounded-full opacity-80 pointer-events-none"></div>}

            {/* Inner Shadow / Depth */}
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

        {/* ERROR DISPLAY */}
        {displayError && (
          <div className="flex flex-col items-center w-full mb-6 animate-in slide-in-from-top-2">
            <div className="bg-red-50 text-red-700 px-6 py-4 rounded-xl text-center font-medium border border-red-100 shadow-sm w-full">
              <div className="flex items-center justify-center gap-2 mb-1">
                <AlertCircle size={20} />
                <span className="font-bold">{t('voice.checkInput')}</span>
              </div>
              {displayError}
            </div>

            {/* TRANSCRIPT DISPLAY FOR ERROR CONTEXT */}
            {transcript && (
              <div className="mt-3 w-full bg-stone-50 border border-stone-200 rounded-lg p-3 text-stone-600 italic text-sm text-center">
                "{transcript}"
              </div>
            )}
          </div>
        )}

        {/* TEXT INPUT FALLBACK (New Requirement) */}
        {!isRecording && (
          <div className="w-full mt-2 animate-in fade-in slide-in-from-bottom-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled) return; // Prevent submission if disabled
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

        {/* FOOTER BUTTON REMOVED - Using Mic Icon Interaction */}
        {isRecording && (
          <p className="text-stone-400 text-sm animate-pulse">{t('voice.tapToStop')}</p>
        )}
      </div>
    </div>
  );
};


export default AudioRecorder;
