/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { Cloud, CloudRain, Sun, Wind, Zap } from 'lucide-react';
import { WeatherSnapshot } from '../../../types';

interface WeatherBadgeProps {
    weather?: WeatherSnapshot;
    variant?: 'minimal' | 'full';
}

const WeatherBadge: React.FC<WeatherBadgeProps> = ({ weather, variant = 'minimal' }) => {
    if (!weather) return null;

    const { current } = weather;
    const isRain = current.iconCode === 'rain' || current.iconCode === 'storm';
    const isSunny = current.iconCode === 'sunny';

    const getIcon = () => {
        switch (current.iconCode) {
            case 'rain': return <CloudRain size={variant === 'full' ? 24 : 14} />;
            case 'storm': return <Zap size={variant === 'full' ? 24 : 14} />;
            case 'cloudy': return <Cloud size={variant === 'full' ? 24 : 14} />;
            case 'partly-cloudy': return <Cloud size={variant === 'full' ? 24 : 14} />;
            case 'windy': return <Wind size={variant === 'full' ? 24 : 14} />;
            default: return <Sun size={variant === 'full' ? 24 : 14} />;
        }
    };

    const colorClass = isRain
        ? 'bg-blue-100 text-blue-800 border-blue-200'
        : isSunny
            ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
            : 'bg-stone-100 text-stone-700 border-stone-200';

    if (variant === 'minimal') {
        return (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-bold ${colorClass}`}>
                {getIcon()}
                <span>{current.tempC}°C</span>
            </div>
        );
    }

    return (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${colorClass}`}>
            <div className="p-1 bg-white/40 rounded-full">{getIcon()}</div>
            <div className="flex flex-col leading-none">
                <span className="font-bold text-sm">{current.tempC}°C • {current.conditionText}</span>
                <span className="text-[10px] opacity-80 mt-0.5">
                    Hum: {current.humidity}% {current.precipMm > 0 ? `• Rain: ${current.precipMm}mm` : ''}
                </span>
            </div>
        </div>
    );
};

export default WeatherBadge;
