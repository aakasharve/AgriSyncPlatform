/**
 * InputMethodToggle — Android Material segmented button
 * Voice / Manual toggle, clean and flat
 */

import React from 'react';
import { Mic, Keyboard } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';

interface InputMethodToggleProps {
    mode: 'voice' | 'manual';
    onChange: (mode: 'voice' | 'manual') => void;
    disabled?: boolean;
    suggestInteraction?: boolean;
}

const InputMethodToggle: React.FC<InputMethodToggleProps> = ({ mode, onChange, disabled, suggestInteraction }) => {
    const { t } = useLanguage();

    return (
        <div className="flex justify-center w-full px-1">
            <div className={`
                bg-surface-200 p-1.5 rounded-2xl flex w-full relative overflow-hidden transition-all duration-300
                ${suggestInteraction && mode === 'voice' ? 'ring-2 ring-emerald-400 shadow-glow-emerald' : 'shadow-inner'}
            `}>
                {/* Sliding Background Indicator - Conceptual (Implementation relies on layout shift matches) */}
                {/* For now staying with conditional classes as it's cleaner without Framer Motion */}

                <button
                    onClick={() => onChange('voice')}
                    disabled={disabled}
                    data-testid="input-method-voice"
                    className={`
                        flex-1 flex items-center justify-center py-3 rounded-xl text-sm font-bold transition-all duration-200 relative z-10
                        ${mode === 'voice'
                            ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-black/5'
                            : 'text-stone-500 hover:bg-stone-200/50 active:scale-95'}
                    `}
                >
                    <Mic size={18} className={`mr-2 transition-transform ${mode === 'voice' ? 'scale-110' : ''}`} strokeWidth={2.5} />
                    {t('logPage.voiceMode')}
                </button>

                <button
                    onClick={() => onChange('manual')}
                    disabled={disabled}
                    data-testid="input-method-manual"
                    className={`
                        flex-1 flex items-center justify-center py-3 rounded-xl text-sm font-bold transition-all duration-200 relative z-10
                        ${mode === 'manual'
                            ? 'bg-white text-stone-800 shadow-sm ring-1 ring-black/5'
                            : 'text-stone-500 hover:bg-stone-200/50 active:scale-95'}
                    `}
                >
                    <Keyboard size={18} className={`mr-2 transition-transform ${mode === 'manual' ? 'scale-110' : ''}`} strokeWidth={2.5} />
                    {t('logPage.manualMode')}
                </button>
            </div>
        </div>
    );
};

export default InputMethodToggle;
