/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { Cloud, CloudRain, Sun, Wind, Droplets, X, MapPin, AlertTriangle } from 'lucide-react';
import { DetailedWeather, DailyForecast } from '../../../types';
import { formatTemperature, formatPrecipitation, formatHumidity, formatWindSpeed } from '../../../shared/utils/weatherFormatter';
import { useLanguage } from '../../../i18n/LanguageContext';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import WeatherFallbackCard from './WeatherFallbackCard';
import type { WeatherStatus } from '../useWeatherMonitor';

// Feature-local strings (like WeatherFallbackCard) — not the translations.ts cap.
const CAUTION_STRINGS = {
    en: { text: 'Boundary not set — set it for accurate weather', cta: 'Set' },
    mr: { text: 'सीमा आखलेली नाही — अचूक हवामानासाठी आखा', cta: 'आखा' },
} as const;

// Lane HONESTY-2 (H6) — what a drawn farm centre really means, said in words (the green "Boundary verified" tick said more).
const PLACE_SET_STRINGS = {
    en: 'Farm location is set', // PROPOSED (English)
    mr: 'शेताचं ठिकाण ठरलं आहे', // PROPOSED (Marathi)
} as const;

// Lane HONESTY-2 (H6) — the forecast list's heading, counted from the list (Devanagari digits in Marathi).
const FORECAST_STRINGS = {
    en: { heading: (n: number) => `Next ${n} day${n === 1 ? '' : 's'}` }, // the old tab's words, with the real count
    mr: { heading: (n: number) => `पुढचे ${toDevanagariDigits(n)} दिवस` }, // PROPOSED (Marathi)
} as const;

interface WeatherWidgetProps {
    data?: DetailedWeather;
    status?: WeatherStatus;
    onRetry?: () => void;
    onAddLocation?: () => void;
    // Weather is showing from device/profile location, not the farm centre —
    // render a red caution that taps through to draw the boundary.
    boundaryUnset?: boolean;
    onOpenBoundary?: () => void;
}

const MiniCard: React.FC<{ day: DailyForecast }> = ({ day }) => {
    const d = new Date(day.date);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }); // e.g. Mon
    const dateNum = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); // e.g. 12 Jan

    const icon = day.condition === 'Rain' ? <CloudRain size={24} className="text-blue-500" />
        : day.condition === 'Cloudy' ? <Cloud size={24} className="text-stone-400" />
            : <Sun size={24} className="text-yellow-500" />;

    return (
        <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 min-w-[100px] flex flex-col items-center gap-2 shadow-sm">
            <div className="text-center">
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{dayName}</p>
                <p className="text-xs font-bold text-stone-700">{dateNum}</p>
            </div>
            <div className="my-1">{icon}</div>
            <div className="text-center w-full">
                <p className="text-xs font-bold text-stone-800">{formatTemperature(day.tempMax)}</p>
                <div className="h-px bg-stone-200 w-full my-1"></div>
                <p className="text-[10px] text-stone-500">{formatTemperature(day.tempMin)}</p>
            </div>
            {day.rainMm > 0 && (
                <div className="flex items-center gap-1 text-[9px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded-full">
                    <Droplets size={8} /> {day.rainMm.toFixed(1)}mm
                </div>
            )}
        </div>
    );
};

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ data, status, onRetry, onAddLocation, boundaryUnset, onOpenBoundary }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { language } = useLanguage();
    const caution = CAUTION_STRINGS[language] ?? CAUTION_STRINGS.en;
    const forecastStrings = FORECAST_STRINGS[language] ?? FORECAST_STRINGS.en;
    const cautionFont = language === 'mr' ? "'Noto Sans Devanagari', sans-serif" : "'DM Sans', sans-serif";

    // Cause-aware states first: a missing farm centre is user-actionable, a
    // failed fetch is retryable. Both replace the old silent gray skeleton.
    if (status === 'no-location') {
        return <WeatherFallbackCard variant="no-location" onAction={() => onAddLocation?.()} />;
    }
    if (status === 'error') {
        return <WeatherFallbackCard variant="error" onAction={() => onRetry?.()} />;
    }
    if (!data) {
        return (
            <div className="w-full h-24 bg-stone-200 animate-pulse rounded-3xl mb-6"></div>
        );
    }

    const { current, locationName, forecast } = data;
    // Lane HONESTY-2 (H6): the "<phone's date> | <phone's time>" line that sat above the temperature is gone. It was
    // `new Date()` — the moment the card was DRAWN — printed beside a reading cached for up to an hour (and measured
    // earlier still by the provider), so it presented "now" as the time of a measurement. The data this card receives
    // carries no observation time it can vouch for (`timestampProvider` is the server's observed time on one path and
    // the phone's own clock on another), so nothing is printed: no time is better than a made-up one (P4).
    // The "Previous 5 days" tab is gone too: `history` is always `[]` (useWeatherMonitor), so it opened an empty list.
    const forecastHeading = forecast.length > 0 ? forecastStrings.heading(forecast.length) : null;
    const placeSet = PLACE_SET_STRINGS[language] ?? PLACE_SET_STRINGS.en;

    const getIcon = (condition: string, size: number) => {
        const c = condition.toLowerCase();
        if (c.includes('rain')) return <CloudRain size={size} className="text-blue-100 drop-shadow-md" />;
        if (c.includes('cloud')) return <Cloud size={size} className="text-white drop-shadow-md opacity-90" />;
        return <Sun size={size} className="text-yellow-300 drop-shadow-md" />;
    };

    return (
        <>
            {/* COLLAPSED WIDGET (Main View). role=button div (not <button>) so the
                caution's own interactive control isn't nested inside a <button>. */}
            <div
                role="button"
                tabIndex={0}
                aria-label="Weather details"
                onClick={() => setIsOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsOpen(true); } }}
                className="w-full text-left bg-gradient-to-br from-blue-500 to-blue-400 rounded-3xl p-5 text-white shadow-[0_14px_30px_-8px_rgba(59,130,246,0.5)] mb-6 relative overflow-hidden group transition-all active:scale-[0.99] cursor-pointer"
            >
                {/* Decorative Circle */}
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/15 rounded-full blur-2xl"></div>

                <div className="relative z-10 flex justify-between items-center">
                    <div className="text-left space-y-1">
                        {/* WAVE 2.3 (spec: dfes-companion-2026-07-11) — one temperature,
                            and it is measured. A `/ 31.5°C` literal used to sit here in
                            matched typography, reading as a second real figure. It was not
                            a fallback: the fallbacks return other components entirely, so
                            it rendered only once live weather had SUCCEEDED. Nothing
                            computes 31.5. */}
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold tracking-tight">{formatTemperature(current.current.tempC)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-blue-50 font-medium text-sm pt-1">
                            <MapPin size={14} />
                            {locationName}
                            {/* H6: a farm centre exists, so this weather is the farm's own place. That is all the green
                                "Boundary verified" tick knew — it proved nothing about the boundary — so it says only that,
                                in words. */}
                            {boundaryUnset === false && (
                                <span
                                    data-testid="weather-place-set"
                                    className="ml-1.5 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold leading-snug text-white"
                                    style={{ fontFamily: cautionFont }}
                                >
                                    {placeSet}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center">
                        {getIcon(current.current.conditionText, 56)}
                        <p className="text-xs font-medium mt-1">{current.current.conditionText}</p>
                    </div>
                </div>

                {/* Red caution — weather is from device/profile, not the farm centre.
                    Own role=button (sibling control inside the card div); stop + prevent
                    default so activating it opens the drawer, not the weather modal. */}
                {boundaryUnset && (
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label={caution.text}
                        data-testid="weather-boundary-caution"
                        style={{ fontFamily: cautionFont }}
                        onClick={(e) => { e.stopPropagation(); onOpenBoundary?.(); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenBoundary?.(); } }}
                        className="relative z-10 mt-3 flex items-center gap-2 rounded-2xl bg-red-500/95 px-3 py-2 text-left cursor-pointer"
                    >
                        <AlertTriangle size={16} className="shrink-0 text-white" />
                        <span className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-white">{caution.text}</span>
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-red-600">{caution.cta} ›</span>
                    </div>
                )}
            </div>

            {/* EXPANDED MODAL (Overlay) */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-md max-h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-300">

                        {/* Header (Blue Gradient) */}
                        <div className="bg-gradient-to-br from-blue-500 to-blue-400 p-6 text-white relative shrink-0">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                                className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
                            >
                                <X size={20} />
                            </button>

                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    {/* WAVE 2.3 — the same invented figure, second copy. */}
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-4xl font-bold">{formatTemperature(current.current.tempC)}</span>
                                    </div>
                                    <p className="text-sm font-medium mt-1 flex items-center gap-1">
                                        <MapPin size={14} /> {locationName}
                                    </p>
                                    <div className="mt-2 text-[10px] font-bold uppercase tracking-wider opacity-60 bg-blue-600/30 w-fit px-2 py-0.5 rounded-full">
                                        Source: {current.provider}
                                    </div>
                                </div>
                                <div className="mt-2">
                                    {getIcon(current.current.conditionText, 64)}
                                </div>
                            </div>

                            {/* Quick Stats Row */}
                            <div className="flex justify-between bg-white/10 rounded-2xl p-4 backdrop-blur-md">
                                <div className="flex flex-col items-center gap-1">
                                    <CloudRain size={20} className="text-blue-100" />
                                    <span className="text-xs opacity-80">Rain</span>
                                    <span className="text-sm font-bold">{formatPrecipitation(current.current.precipMm)}</span>
                                </div>
                                <div className="w-px bg-white/20 h-full"></div>
                                <div className="flex flex-col items-center gap-1">
                                    <Droplets size={20} className="text-blue-100" />
                                    <span className="text-xs opacity-80">Humidity</span>
                                    <span className="text-sm font-bold">{formatHumidity(current.current.humidity)}</span>
                                </div>
                                <div className="w-px bg-white/20 h-full"></div>
                                <div className="flex flex-col items-center gap-1">
                                    <Wind size={20} className="text-blue-100" />
                                    <span className="text-xs opacity-80">Wind</span>
                                    <span className="text-sm font-bold">{formatWindSpeed(current.current.windKph)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Content Body */}
                        <div className="p-5 overflow-y-auto flex-1">

                            {/* H6: one heading, not two tabs — the other tab ("Previous 5 days") was always empty. The
                                count is the number of days the list really holds, so the heading never says 5 over 7 cards. */}
                            {forecastHeading && (
                                <p data-testid="weather-forecast-heading" className="mb-4 text-sm font-bold text-stone-700" style={{ fontFamily: cautionFont }}>
                                    {forecastHeading}
                                </p>
                            )}

                            {/* Horizontal List */}
                            <div className="flex overflow-x-auto gap-3 pb-4 scrollbar-hide -mx-2 px-2">
                                {forecast.map((day, idx) => (
                                    <MiniCard key={idx} day={day} />
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            )}
        </>
    );
};

export default WeatherWidget;
