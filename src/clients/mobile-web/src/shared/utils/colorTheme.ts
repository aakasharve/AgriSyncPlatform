
/**
 * Maps raw color strings (e.g. 'bg-indigo-500') to a full theme object.
 * This prevents Tailwind class purging by using full static strings.
 */
export const getCropTheme = (colorString?: string) => {
    // Extract base color name from 'bg-{color}-500' string if present
    const baseColor = colorString?.split('-')[1] || 'indigo';

    const themes: Record<string, any> = {
        indigo: {
            border: 'border-indigo-500',
            bg: 'bg-indigo-50/50',
            text: 'text-indigo-900',
            shadow: 'shadow-indigo-100',
            iconBg: 'bg-indigo-100',
            iconText: 'text-indigo-600',
            indicator: 'bg-indigo-500',
            slideBorder: 'border-indigo-100', // For SlidingCropSelector
            slideShadow: 'shadow-indigo-900/10',
            slideText: 'text-indigo-500',
            slideBgSelected: 'bg-indigo-50',
        },
        rose: {
            border: 'border-rose-500',
            bg: 'bg-rose-50/50',
            text: 'text-rose-900',
            shadow: 'shadow-rose-100',
            iconBg: 'bg-rose-100',
            iconText: 'text-rose-600',
            indicator: 'bg-rose-500',
            slideBorder: 'border-rose-100',
            slideShadow: 'shadow-rose-900/10',
            slideText: 'text-rose-500',
            slideBgSelected: 'bg-rose-50',
        },
        green: {
            border: 'border-green-600',
            bg: 'bg-green-50/50',
            text: 'text-green-900',
            shadow: 'shadow-green-100',
            iconBg: 'bg-green-100',
            iconText: 'text-green-600',
            indicator: 'bg-green-600',
            slideBorder: 'border-green-100',
            slideShadow: 'shadow-green-900/10',
            slideText: 'text-green-500',
            slideBgSelected: 'bg-green-50',
        },
        emerald: { // Fallback / Existing
            border: 'border-emerald-500',
            bg: 'bg-emerald-50/50',
            text: 'text-emerald-900',
            shadow: 'shadow-emerald-100',
            iconBg: 'bg-emerald-100',
            iconText: 'text-emerald-600',
            indicator: 'bg-emerald-500',
            slideBorder: 'border-emerald-100',
            slideShadow: 'shadow-emerald-900/10',
            slideText: 'text-emerald-500',
            slideBgSelected: 'bg-emerald-50',
        },
        purple: {
            border: 'border-purple-500',
            bg: 'bg-purple-50/50',
            text: 'text-purple-900',
            shadow: 'shadow-purple-100',
            iconBg: 'bg-purple-100',
            iconText: 'text-purple-600',
            indicator: 'bg-purple-500',
            slideBorder: 'border-purple-100',
            slideShadow: 'shadow-purple-900/10',
            slideText: 'text-purple-500',
            slideBgSelected: 'bg-purple-50',
        },
        red: {
            border: 'border-red-500',
            bg: 'bg-red-50/50',
            text: 'text-red-900',
            shadow: 'shadow-red-100',
            iconBg: 'bg-red-100',
            iconText: 'text-red-600',
            indicator: 'bg-red-500',
            slideBorder: 'border-red-100',
            slideShadow: 'shadow-red-900/10',
            slideText: 'text-red-500',
            slideBgSelected: 'bg-red-50',
        }
    };

    return themes[baseColor] || themes['indigo'];
};
