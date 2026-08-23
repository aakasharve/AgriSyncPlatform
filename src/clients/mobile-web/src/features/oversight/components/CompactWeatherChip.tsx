/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * CompactWeatherChip — Task 7 (design doc §4.2: "Large weather card | 70px
 * chip; tap opens the same card underneath") + Task 11's `compact` variant
 * (founder header restructure).
 *
 * `variant="full"` (default) — Task 7, UNCHANGED. The log-view home screen
 * used to open on a full-height gradient weather card before a farmer could
 * reach the only question the screen exists for. This is the one-line chip,
 * collapsed by default, that returned that space; tapping it mounts the
 * EXISTING `WeatherWidget` INLINE in its place. Every test in
 * `__tests__/CompactWeatherChip.test.tsx` predating Task 11 exercises this
 * path without passing `variant` — nothing about it changes here.
 *
 * `variant="compact"` — Task 11. Row 1 of `AppHeader` has no width for even
 * the one-line chip (measured — see the task-11 report): the founder's
 * restructure moves weather into row 1's "dead space ... before the gear",
 * "icon + temperature only". Tapping it still "expands the existing
 * WeatherWidget" (task-11 brief) — `WeatherWidget` is NOT reimplemented,
 * NOT copied — but row 1 is a narrow flex cell, not a full-width column, so
 * mounting it INLINE there would blow the row open. Instead the compact
 * trigger opens a bottom-sheet PORTAL to `document.body` (the same pattern
 * `FarmContextSwitcher.tsx`'s `FarmSwitcherSheet` already uses, and the one
 * this task's OTHER fix applies to `AppHeader`'s waiting drawer) and mounts
 * the REAL `WeatherWidget` inside it, every prop forwarded verbatim — same
 * "reuse, never rewrite" rule as the full variant.
 *
 * BINDING CONSTRAINT (task-7 brief, still honoured by both variants): "Do
 * not rewrite the weather card — reuse the component." Neither branch below
 * reimplements weather rendering, loading states, the boundary caution or
 * the forecast modal — all of that still lives in `WeatherWidget`,
 * untouched.
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudRain, Sun, ChevronDown, AlertTriangle, X } from 'lucide-react';
import type { DetailedWeather } from '../../../types';
import { formatTemperature } from '../../../shared/utils/weatherFormatter';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { WeatherStatus } from '../../weather/useWeatherMonitor';
import WeatherWidget from '../../weather/components/WeatherWidget';

export interface CompactWeatherChipProps {
    data?: DetailedWeather;
    status?: WeatherStatus;
    onRetry?: () => void;
    onAddLocation?: () => void;
    // Weather is showing from device/profile location, not the farm centre —
    // forwarded to WeatherWidget unchanged (spec: "reuse the component").
    boundaryUnset?: boolean;
    onOpenBoundary?: () => void;
    /**
     * Task 11 — 'full' (default) is the original Task-7 home-screen chip,
     * byte-identical to before. 'compact' is row 1's icon+temperature-only
     * trigger (`AppHeader.tsx`).
     */
    variant?: 'full' | 'compact';
}

// Root CLAUDE.md font rules — English/brand/numbers get DM Sans; a
// Devanagari `t()` fallback (LanguageProvider defaults to 'en' until Dexie
// resolves, so this can render either) gets Noto Sans Devanagari. Same
// pattern as `CanonicalStrip.tsx`'s `fontStyleFor`.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text)
        ? { fontFamily: "'Noto Sans Devanagari', sans-serif" }
        : { fontFamily: "'DM Sans', sans-serif" };
}

/** Shared by both variants — same condition-text sniff, different icon size. */
function weatherIcon(data: DetailedWeather | undefined, size: number): React.ReactNode {
    const conditionText = data?.current.current.conditionText?.toLowerCase() ?? '';
    if (conditionText.includes('rain')) return <CloudRain size={size} className="text-blue-500" />;
    if (conditionText.includes('cloud')) return <Cloud size={size} className="text-stone-400" />;
    return <Sun size={size} className="text-amber-500" />;
}

const CompactWeatherChip: React.FC<CompactWeatherChipProps> = ({
    data,
    status,
    onRetry,
    onAddLocation,
    boundaryUnset,
    onOpenBoundary,
    variant = 'full',
}) => {
    const [expanded, setExpanded] = useState(false);
    const { t } = useLanguage();

    if (variant === 'compact') {
        // Real value, rounded for a 2-3 character display — never a
        // fabricated number, just fewer decimals than `formatTemperature`'s
        // one-line-chip precision (spec §P-F: derived, never typed in).
        const compactTemp = data ? `${Math.round(data.current.current.tempC)}°` : '--°';

        return (
            <>
                {/* Task 12 (`G:\VALIDATION\farm-selector-contextual.html`'s
                    `.wx` rule): "Weather becomes a proper button" — tinted
                    sky-50/sky-100 instead of a plain white/stone-200 chip,
                    icon+temperature+chevron in sky-700. Same tap-to-expand
                    behaviour as before; `WeatherWidget` itself (mounted
                    below, unchanged) is not touched.
                    Task 14, change 6 — sized for when this row also fought
                    Task 13's centre toggle for space; that toggle has since
                    moved to its own row below (Task 13), so this chip gets
                    a little more room back too: 38px -> 42px tall, and a
                    touch more internal breathing room. */}
                <button
                    type="button"
                    data-testid="compact-weather-chip"
                    onClick={() => setExpanded(true)}
                    aria-label={t('weather')}
                    className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 pl-2.5 pr-2"
                >
                    {/* MEASURED (task-11 report): the caution used to be a
                        full sibling `AlertTriangle` + its own gap, adding
                        ~14px to row 1's worst-case width and pushing the
                        centre `PageToggle` into visual collision at 390px.
                        A small corner badge on the weather icon carries the
                        same information (boundary not set — still one tap
                        target, still the same button) for ~2px instead. */}
                    <span className="relative shrink-0">
                        {weatherIcon(data, 16)}
                        {boundaryUnset && (
                            <span
                                data-testid="compact-weather-chip-caution"
                                aria-hidden="true"
                                className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-red-500"
                            />
                        )}
                    </span>
                    <span className="text-[14px] font-extrabold text-sky-700" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                        {compactTemp}
                    </span>
                    <ChevronDown size={13} className="shrink-0 text-sky-700/70" />
                </button>

                {/* Bottom-sheet PORTAL (Task 11) — row 1 has no width for
                    WeatherWidget's own full-width collapsed card, so the
                    compact trigger opens it in a sheet instead of inline.
                    `document.body` target: the exact fix this task's other
                    change applies to AppHeader's waiting drawer, applied
                    here too so this NEW overlay never inherits the same
                    sticky-header-traps-position:fixed defect. */}
                {expanded && typeof document !== 'undefined' && createPortal(
                    <div
                        data-testid="compact-weather-chip-sheet"
                        className="fixed inset-0 z-[150] flex items-end justify-center bg-stone-900/50 backdrop-blur-sm sm:items-center"
                        onClick={() => setExpanded(false)}
                    >
                        <div
                            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-transparent p-4 sm:rounded-3xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => setExpanded(false)}
                                data-testid="compact-weather-chip-sheet-close"
                                aria-label="Close"
                                className="mb-2 ml-auto flex rounded-full bg-white p-2 text-stone-600 shadow"
                            >
                                <X size={16} />
                            </button>
                            <WeatherWidget
                                data={data}
                                status={status}
                                onRetry={onRetry}
                                onAddLocation={onAddLocation}
                                boundaryUnset={boundaryUnset}
                                onOpenBoundary={onOpenBoundary}
                            />
                        </div>
                    </div>,
                    document.body,
                )}
            </>
        );
    }

    // ── ORIGINAL Task-7 'full' variant — unchanged. ──

    // Expanded: the EXISTING WeatherWidget, unchanged, every prop forwarded
    // verbatim. It owns its own loading/error/no-location states and its
    // own further tap-to-modal — this component adds no second copy of any
    // of that.
    if (expanded) {
        return (
            <WeatherWidget
                data={data}
                status={status}
                onRetry={onRetry}
                onAddLocation={onAddLocation}
                boundaryUnset={boundaryUnset}
                onOpenBoundary={onOpenBoundary}
            />
        );
    }

    const label = t('weather');

    return (
        <button
            type="button"
            data-testid="compact-weather-chip"
            onClick={() => setExpanded(true)}
            aria-label={label}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white px-3.5 py-2.5 text-left shadow-sm active:scale-[0.99] transition-transform"
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">{weatherIcon(data, 16)}</span>
                <span
                    className="truncate text-sm font-bold text-stone-700"
                    style={fontStyleFor(label)}
                >
                    {data ? formatTemperature(data.current.current.tempC) : label}
                </span>
                {data?.locationName && (
                    <span className="truncate text-xs font-medium text-stone-400">
                        {data.locationName}
                    </span>
                )}
                {boundaryUnset && (
                    <AlertTriangle
                        size={14}
                        className="shrink-0 text-red-500"
                        data-testid="compact-weather-chip-caution"
                    />
                )}
            </span>
            <ChevronDown size={14} className="shrink-0 text-stone-400" />
        </button>
    );
};

export default CompactWeatherChip;
