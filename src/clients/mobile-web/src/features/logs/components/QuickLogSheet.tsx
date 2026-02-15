import React, { useState } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { QuickLogChip } from '../../../shared/components/ui/QuickLogChip';

// --- ICONS (Inline) ---
const Icons = {
    Mic: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    ),
    Close: () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
};

interface QuickLogSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onVoiceStart: () => void;
    onTypeSelect: (type: string) => void;
}

export const QuickLogSheet: React.FC<QuickLogSheetProps> = ({
    isOpen,
    onClose,
    onVoiceStart,
    onTypeSelect
}) => {
    const { t, language } = useLanguage();
    const [isClosing, setIsClosing] = useState(false);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 200); // Animation duration
    };

    if (!isOpen) return null;

    return (
        <div className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center`}>
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
                onClick={handleClose}
            />

            {/* Sheet Content */}
            <div
                className={`
          relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl p-6 shadow-xl 
          transform transition-transform duration-200 ease-out
          ${isClosing ? 'translate-y-full sm:scale-95 sm:opacity-0' : 'translate-y-0 sm:scale-100 sm:opacity-100'}
        `}
            >
                {/* Handle bar for mobile feel */}
                <div className="mx-auto w-12 h-1.5 bg-gray-200 rounded-full mb-6 sm:hidden" />

                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-gray-900">{t('dfes.whatWorkToday')}</h2>
                    <button
                        onClick={handleClose}
                        className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                    >
                        <Icons.Close />
                    </button>
                </div>

                {/* Voice Input - Primary Action */}
                <button
                    onClick={() => {
                        onVoiceStart();
                        handleClose();
                    }}
                    className="w-full flex items-center justify-center gap-3 p-4 bg-primary text-white rounded-2xl mb-8 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all group"
                >
                    <div className="p-2 bg-white/20 rounded-full">
                        <Icons.Mic />
                    </div>
                    <span className={`font-semibold ${language === 'mr' ? 'text-base' : 'text-lg'}`}>{t('logPage.startRecording')}</span>
                </button>

                {/* Quick Chips Grid */}
                <div className="space-y-4">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide px-1">
                        {t('logPage.manualMode')}
                    </h3>

                    <div className="flex flex-wrap gap-3">
                        <QuickLogChip
                            label={t('workSummary.irrigation')}
                            category="irrigation"
                            onClick={() => onTypeSelect('irrigation')}
                        />
                        <QuickLogChip
                            label={t('workSummary.labour')}
                            category="labour"
                            onClick={() => onTypeSelect('labour')}
                        />
                        <QuickLogChip
                            label={t('workSummary.inputs')}
                            category="input"
                            onClick={() => onTypeSelect('inputs')}
                        />
                        <QuickLogChip
                            label="Harvest"
                            category="activity"
                            onClick={() => onTypeSelect('harvest')}
                        />
                        <QuickLogChip
                            label="Scouting"
                            category="activity"
                            onClick={() => onTypeSelect('scouting')}
                        />
                    </div>
                </div>

                {/* No Work Today Option */}
                <div className="mt-6 pt-4 border-t border-gray-100">
                    <button
                        className="w-full py-3 px-4 rounded-xl border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 hover:border-gray-300 transition-all flex items-center justify-center gap-2"
                        onClick={() => onTypeSelect('no_work')}
                    >
                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                        {t('dfes.noWorkToday')}
                    </button>
                </div>
            </div>
        </div>
    );
};
