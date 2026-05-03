import React, { useEffect } from 'react';
import { Mic, X, Loader2, HelpCircle } from 'lucide-react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import { AudioData, QuestionForUser } from '../../../types';

interface VoiceListeningOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onAudioCaptured: (audioData: AudioData) => void;
    isProcessing?: boolean;
    transcript?: string;
    clarificationNeeded?: QuestionForUser | null;
    onAnswerClarification?: (answer: string) => void;
}

const VoiceListeningOverlay: React.FC<VoiceListeningOverlayProps> = ({
    isOpen,
    onClose,
    onAudioCaptured,
    isProcessing = false,
    transcript,
    clarificationNeeded,
    onAnswerClarification
}) => {

    const {
        isRecording,
        duration: _duration,
        error,
        startRecording,
        stopRecording,
        cancelRecording
    } = useMediaRecorder({
        onAudioCaptured: (data) => {
            onAudioCaptured(data);
            // Don't close immediately, let parent handle state (likely processing)
        },
        onError: (err) => console.error(err)
    });

    // Auto-start recording when opened or when clarification starts
    useEffect(() => {
        if (isOpen && !isProcessing && !clarificationNeeded) {
            startRecording();
        } else if (isOpen && clarificationNeeded && !isRecording && !isProcessing) {
            // Optional: Auto-start recording again for answer?
            // Yes, let's auto-start so they can speak "Plot A" immediately
            startRecording();
        } else if (!isOpen) {
            cancelRecording();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    }, [isOpen, startRecording, cancelRecording, isProcessing, clarificationNeeded]);

    if (!isOpen) return null;

    // Calculate dynamic scale for pulsing effect based on duration (simulating volume)
    const volumeScale = isRecording ? 1 + (Math.sin(Date.now() / 100) * 0.1) : 1;
    const isClarifying = !!clarificationNeeded;

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            {/* Close Hit Area (Top) */}
            <div className="absolute inset-0" onClick={() => { cancelRecording(); onClose(); }} />

            {/* Bottom Sheet Visual */}
            <div className="w-full max-w-lg mx-4 mb-24 relative z-10 transition-all duration-300">
                <div className={`bg-white/95 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl border border-white/50 flex flex-col items-center justify-center text-center animate-in slide-in-from-bottom-10 duration-500 ${isClarifying ? 'border-amber-200 bg-amber-50/95' : ''}`}>

                    {/* Status Text / Question Header */}
                    <div className="mb-4">
                        {isClarifying ? (
                            <div className="flex items-center gap-2 justify-center text-amber-600 mb-2">
                                <HelpCircle size={24} />
                                <span className="font-bold uppercase tracking-wider text-sm">Validating Context</span>
                            </div>
                        ) : (
                            <h3 className="text-2xl font-black text-slate-800 mb-2">
                                {isProcessing ? 'Processing...' : (isRecording ? 'Listening...' : 'Ready')}
                            </h3>
                        )}
                    </div>

                    {/* Main Content Area */}
                    {isClarifying ? (
                        <div className="mb-8 w-full">
                            <h2 className="text-xl font-bold text-slate-800 mb-6 leading-snug">
                                "{clarificationNeeded?.text}"
                            </h2>

                            {/* Options Grid */}
                            {clarificationNeeded?.options && (
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    {clarificationNeeded.options.map((option, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                cancelRecording(); // Stop voice if they click
                                                // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- T-IGH-04 ratchet: intentional side-effect-only expression; revisit in V2.
                                                onAnswerClarification && onAnswerClarification(option);
                                            }}
                                            className="bg-white border border-amber-200 text-slate-700 font-semibold py-3 px-4 rounded-xl shadow-sm active:scale-95 transition-all hover:bg-amber-50 hover:border-amber-300"
                                        >
                                            {option}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="text-sm text-slate-400 font-medium">
                                Tap an option or say your answer...
                            </p>
                        </div>
                    ) : (
                        /* Normal Mic Visuals */
                        <div className="relative mb-8 mt-4">
                            {isRecording && (
                                <>
                                    <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl animate-pulse" />
                                    <div
                                        className="absolute inset-0 bg-emerald-500/30 rounded-full transition-transform duration-75"
                                        style={{ transform: `scale(${volumeScale})` }}
                                    />
                                </>
                            )}

                            <button
                                onClick={() => {
                                    if (isRecording) stopRecording();
                                    else startRecording();
                                }}
                                disabled={isProcessing}
                                className={`w-24 h-24 rounded-full flex items-center justify-center text-white shadow-lg relative z-10 active:scale-95 transition-all duration-300 ${isProcessing
                                    ? 'bg-slate-100 text-slate-400'
                                    : isRecording
                                        ? 'bg-gradient-to-br from-rose-500 to-red-600 scale-110 shadow-red-500/30'
                                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30'
                                    }`}
                            >
                                {isProcessing ? (
                                    <Loader2 className="animate-spin" size={40} />
                                ) : (
                                    <Mic size={40} strokeWidth={2.5} className={isRecording ? 'animate-bounce-subtle' : ''} />
                                )}
                            </button>
                        </div>
                    )}

                    {/* Transcript (Only in normal mode) */}
                    {!isClarifying && (
                        <div className="h-16 flex items-center justify-center">
                            <p className="text-lg text-slate-500 font-medium max-w-xs mx-auto leading-relaxed transition-all">
                                {error ? (
                                    <span className="text-red-500">{error}</span>
                                ) : (
                                    transcript || (isRecording ? "I'm listening..." : "Tap microphone to start")
                                )}
                            </p>
                        </div>
                    )}

                    {/* Close Button */}
                    <button
                        onClick={() => { cancelRecording(); onClose(); }}
                        className="mt-2 w-12 h-12 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VoiceListeningOverlay;
