import React from 'react';
import { MapPin, CloudOff, RefreshCw } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';

interface WeatherFallbackCardProps {
    variant: 'no-location' | 'error';
    onAction: () => void;
}

// Strings live with the feature (like DwcReminderChip's Marathi copy) rather
// than in the shared translations.ts god-file, which is at its line-size cap.
const STRINGS = {
    en: {
        addLocationTitle: 'Add your farm location to see weather',
        addLocationCta: 'Set farm location',
        unavailableTitle: 'Weather unavailable right now',
        unavailableBody: 'We could not load the latest weather.',
        retryCta: 'Retry',
    },
    mr: {
        addLocationTitle: 'हवामान पाहण्यासाठी तुमच्या शेताचे स्थान जोडा',
        addLocationCta: 'शेताचे स्थान निवडा',
        unavailableTitle: 'हवामान सध्या उपलब्ध नाही',
        unavailableBody: 'ताजे हवामान लोड करता आले नाही.',
        retryCta: 'पुन्हा प्रयत्न करा',
    },
} as const;

/**
 * Shown in place of the weather widget when it cannot display data:
 *  - no-location: farm has no centre → prompt the user to set their farm location
 *  - error:       the fetch failed (service down / key unset) → offer a retry
 * Replaces the old indefinite gray skeleton so a failure is visible, not "missing".
 */
const WeatherFallbackCard: React.FC<WeatherFallbackCardProps> = ({ variant, onAction }) => {
    const { language } = useLanguage();
    const s = STRINGS[language] ?? STRINGS.en;
    // Font rules: Marathi body text → Noto Sans Devanagari; English → DM Sans.
    // Set explicitly (like DwcReminderChip) rather than relying on inheritance.
    const fontFamily = language === 'mr' ? "'Noto Sans Devanagari', sans-serif" : "'DM Sans', sans-serif";
    const isNoLocation = variant === 'no-location';

    const title = isNoLocation ? s.addLocationTitle : s.unavailableTitle;
    const cta = isNoLocation ? s.addLocationCta : s.retryCta;
    const Icon = isNoLocation ? MapPin : CloudOff;

    return (
        <div
            data-testid="weather-fallback"
            data-variant={variant}
            style={{ fontFamily }}
            className="w-full rounded-3xl mb-6 p-5 bg-stone-50 border border-stone-200 flex items-center justify-between gap-3"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-stone-500">
                    <Icon size={22} />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-stone-700 leading-snug">{title}</p>
                    {!isNoLocation && (
                        <p className="text-xs text-stone-400 mt-0.5">{s.unavailableBody}</p>
                    )}
                </div>
            </div>
            <button
                onClick={onAction}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white px-3.5 py-2 text-xs font-bold active:scale-95 transition"
            >
                {!isNoLocation && <RefreshCw size={14} />}
                {cta}
            </button>
        </div>
    );
};

export default WeatherFallbackCard;
