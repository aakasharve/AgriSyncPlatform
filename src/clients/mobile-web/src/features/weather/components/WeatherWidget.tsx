/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { Cloud, CloudRain, Sun, Wind, Droplets, X, MapPin } from 'lucide-react';
import { DetailedWeather, DailyForecast } from '../../../types';
import { formatTemperature, formatPrecipitation, formatHumidity, formatWindSpeed } from '../../../shared/utils/weatherFormatter';


interface WeatherWidgetProps {
    data?: DetailedWeather;
    isLoading?: boolean;
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

const WeatherWidget: React.FC<WeatherWidgetProps> = ({ data, isLoading }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'prev' | 'next'>('next');

    if (isLoading || !data) {
        return (
            <div className="w-full h-24 bg-stone-200 animate-pulse rounded-3xl mb-6"></div>
        );
    }

    const { current, locationName, history, forecast } = data;
    const displayList = activeTab === 'next' ? forecast : history;

    // Format Date for Header
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = today.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const getIcon = (condition: string, size: number) => {
        const c = condition.toLowerCase();
        if (c.includes('rain')) return <CloudRain size={size} className="text-blue-100 drop-shadow-md" />;
        if (c.includes('cloud')) return <Cloud size={size} className="text-white drop-shadow-md opacity-90" />;
        return <Sun size={size} className="text-yellow-300 drop-shadow-md" />;
    };

    return (
        <>
            {/* COLLAPSED WIDGET (Main View) */}
            <button
                onClick={() => setIsOpen(true)}
                className="w-full bg-gradient-to-br from-blue-500 to-blue-400 rounded-3xl p-5 text-white shadow-lg shadow-blue-200 mb-6 relative overflow-hidden group transition-all active:scale-[0.99]"
            >
                {/* Decorative Circle */}
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>

                <div className="relative z-10 flex justify-between items-center">
                    <div className="text-left space-y-1">
                        <p className="text-xs font-medium text-blue-50 opacity-90">{dateStr} | {timeStr}</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold tracking-tight">{formatTemperature(current.current.tempC)}</span>
                            <span className="text-lg opacity-70 font-medium">/ 31.5°C</span>
                        </div>
                        <div className="flex items-center gap-1 text-blue-50 font-medium text-sm pt-1">
                            <MapPin size={14} />
                            {locationName}
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center">
                        {getIcon(current.current.conditionText, 56)}
                        <p className="text-xs font-medium mt-1">{current.current.conditionText}</p>
                    </div>
                </div>
            </button>

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
                                    <p className="text-xs font-medium text-blue-50 opacity-80">{dateStr} | {timeStr}</p>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <span className="text-4xl font-bold">{formatTemperature(current.current.tempC)}</span>
                                        <span className="text-lg opacity-80">/ 31.5°C</span>
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

                            {/* Tabs */}
                            <div className="flex gap-3 mb-5">
                                <button
                                    onClick={() => setActiveTab('prev')}
                                    className={`flex-1 py-3 rounded-xl text-sm font-bold border transition-all ${activeTab === 'prev'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                        : 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50'
                                        }`}
                                >
                                    Previous 5 days
                                </button>
                                <button
                                    onClick={() => setActiveTab('next')}
                                    className={`flex-1 py-3 rounded-xl text-sm font-bold border transition-all ${activeTab === 'next'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                        : 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50'
                                        }`}
                                >
                                    Next 5 days
                                </button>
                            </div>

                            {/* Horizontal List */}
                            <div className="flex overflow-x-auto gap-3 pb-4 scrollbar-hide -mx-2 px-2">
                                {displayList.map((day, idx) => (
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
