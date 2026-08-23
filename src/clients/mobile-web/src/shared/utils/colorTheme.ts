
/**
 * Maps raw color strings (e.g. 'bg-indigo-500') to a full theme object.
 * This prevents Tailwind class purging by using full static strings.
 *
 * spec: owner-oversight-loop (Task 16, Problem 2) — `strongFill` added
 * alongside the existing `slideBgSelected`. Founder: "plot selection is not
 * vivid enough... a stronger fill or tint on the selected card, not only a
 * ring." `slideBgSelected` (the `-50` tint) stays untouched — every existing
 * consumer (`CropSelector.tsx`'s inner plot tray, `SlidingCropSelector.tsx`)
 * keeps its current look. `strongFill` (the `-100` tint, one step bolder) is
 * a pure addition, used only where a caller opts into the stronger selected
 * treatment — nothing already shipping is restyled by adding this field.
 */
interface CropColorTheme {
    border: string;
    bg: string;
    text: string;
    shadow: string;
    iconBg: string;
    iconText: string;
    indicator: string;
    slideBorder: string; // For SlidingCropSelector
    slideShadow: string;
    slideText: string;
    slideBgSelected: string;
    strongFill: string;
}

export const getCropTheme = (colorString?: string): CropColorTheme => {
    // Extract base color name from 'bg-{color}-500' string if present
    const baseColor = colorString?.split('-')[1] || 'indigo';

    const themes: Record<string, CropColorTheme> = {
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
            strongFill: 'bg-indigo-100',
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
            strongFill: 'bg-rose-100',
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
            strongFill: 'bg-green-100',
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
            strongFill: 'bg-emerald-100',
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
            strongFill: 'bg-purple-100',
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
            strongFill: 'bg-red-100',
        }
    };

    return themes[baseColor] || themes['indigo'];
};
