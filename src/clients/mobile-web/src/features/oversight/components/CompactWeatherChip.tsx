/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * CompactWeatherChip — Task 7 (design doc §4.2: "Large weather card | 70px
 * chip; tap opens the same card underneath").
 *
 * The log-view home screen used to open on a full-height gradient weather
 * card, a Daily Closure card and a Running Cost card before a farmer could
 * reach the only question the screen exists for — "which plot did I work
 * on today?" This component returns the weather card's space: a compact
 * one-line chip, collapsed by default.
 *
 * BINDING CONSTRAINT (task-7 brief): "Do not rewrite the weather card —
 * reuse the component." This file does NOT reimplement weather rendering,
 * loading states, the boundary caution or the forecast modal — all of that
 * still lives in `WeatherWidget`, untouched. Tapping the chip simply mounts
 * that existing component in place of the chip; every prop is forwarded
 * verbatim.
 */
import React, { useState } from 'react';
import { Cloud, CloudRain, Sun, ChevronDown, AlertTriangle } from 'lucide-react';
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

const CompactWeatherChip: React.FC<CompactWeatherChipProps> = ({
    data,
    status,
    onRetry,
    onAddLocation,
    boundaryUnset,
    onOpenBoundary,
}) => {
    const [expanded, setExpanded] = useState(false);
    const { t } = useLanguage();

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

    const conditionText = data?.current.current.conditionText?.toLowerCase() ?? '';
    const icon = conditionText.includes('rain')
        ? <CloudRain size={16} className="text-blue-500" />
        : conditionText.includes('cloud')
            ? <Cloud size={16} className="text-stone-400" />
            : <Sun size={16} className="text-amber-500" />;

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
                <span className="shrink-0">{icon}</span>
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
