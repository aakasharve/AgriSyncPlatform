import React from 'react';
import { Mic, Keyboard } from 'lucide-react';

interface InputMethodMicProps {
    mode: 'voice' | 'manual';
    onChange: (mode: 'voice' | 'manual') => void;
    disabled?: boolean;
    suggestInteraction?: boolean;
}

const InputMethodMic: React.FC<InputMethodMicProps> = ({ mode, onChange, disabled, suggestInteraction }) => {
    return (
        <div className="flex flex-col items-center justify-center w-full py-2">

            {/* MAIN ACTION: VOICE MENTAL MODEL */}
            <div className="relative mb-6">
                {/* Pulse Ring for Suggestion */}
                {suggestInteraction && mode !== 'voice' && (
                    <div className="absolute inset-0 rounded-full bg-emerald-400 opacity-20 animate-ping"></div>
                )}
                {suggestInteraction && mode !== 'voice' && (
                    <div className="absolute -inset-4 rounded-full bg-emerald-100 opacity-30 animate-pulse"></div>
                )}

                <button
                    onClick={() => onChange('voice')}
                    disabled={disabled}
                    className={`
                        relative z-10 flex items-center justify-center w-20 h-20 rounded-full shadow-xl transition-all duration-300
                        ${mode === 'voice'
                            ? 'bg-emerald-600 text-white shadow-emerald-200 scale-110 ring-4 ring-emerald-100'
                            : 'bg-white text-emerald-600 border-2 border-emerald-100 hover:scale-105 hover:shadow-emerald-100'
                        }
                    `}
                >
                    <Mic size={32} strokeWidth={2.5} className={mode === 'voice' ? 'animate-pulse' : ''} />
                </button>

                {/* Text Label Below Mic */}
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                    <span className={`text-sm font-bold ${mode === 'voice' ? 'text-emerald-700' : 'text-stone-400'}`}>
                        Tap to Speak
                    </span>
                </div>
            </div>

            {/* SECONDARY ACTION: LEDGER SWITCH */}
            <div className="mt-4">
                <button
                    onClick={() => onChange('manual')}
                    disabled={disabled}
                    className={`
                        flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-colors
                        ${mode === 'manual'
                            ? 'bg-stone-800 text-white shadow-lg'
                            : 'bg-stone-100 text-stone-400 hover:text-stone-600 hover:bg-stone-200'
                        }
                    `}
                >
                    <Keyboard size={14} />
                    <span>Use Ledger</span>
                </button>
            </div>

        </div>
    );
};

export default InputMethodMic;
