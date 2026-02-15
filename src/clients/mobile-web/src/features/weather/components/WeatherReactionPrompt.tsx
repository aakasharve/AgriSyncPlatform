import React, { useState } from 'react';
import { CloudRain, Wind, ThermometerSun, AlertTriangle, CheckCircle, Clock, Ban, ArrowRight } from 'lucide-react';
import { WeatherEvent, WeatherReaction, FarmerReactionType } from '../../../types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';

interface Props {
    event: WeatherEvent;
    onReact: (reaction: WeatherReaction) => void;
    onDismiss: () => void;
}

const WeatherReactionPrompt: React.FC<Props> = ({ event, onReact, onDismiss }) => {
    const [note, setNote] = useState('');

    const handleSelect = (type: FarmerReactionType, scope: 'NONE' | 'PARTIAL' | 'FULL_DAY') => {
        const reaction: WeatherReaction = {
            id: `wr_${idGenerator.generate()}`,
            eventId: event.id,
            plotId: event.plotId,
            reactionType: type,
            impactScope: scope,
            note: note || undefined,
            createdAt: systemClock.nowISO()
        };
        onReact(reaction);
    };

    const getIcon = () => {
        switch (event.eventType) {
            case 'HEAVY_RAIN':
            case 'RAIN_START': return <CloudRain className="text-blue-500" size={32} />;
            case 'HIGH_WIND': return <Wind className="text-slate-500" size={32} />;
            case 'HEAT_SPIKE': return <ThermometerSun className="text-orange-500" size={32} />;
            default: return <AlertTriangle className="text-yellow-500" size={32} />;
        }
    };

    const getTitle = () => {
        switch (event.eventType) {
            case 'HEAVY_RAIN': return "Heavy Rain Detected";
            case 'RAIN_START': return "It started raining";
            case 'HIGH_WIND': return "High Wind Alert";
            case 'HEAT_SPIKE': return "Heat Stress Alert";
            default: return "Weather Changed";
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="bg-slate-50 p-4 border-b flex items-center gap-3">
                    {getIcon()}
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg">{getTitle()}</h3>
                        <p className="text-sm text-slate-500">{new Date(event.tsStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Severity: {event.severity}</p>
                    </div>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-slate-700 font-medium text-center">Did this affect today's plan?</p>

                    <div className="grid grid-cols-1 gap-3">
                        <button
                            onClick={() => handleSelect('WORK_BLOCKED', 'FULL_DAY')}
                            className="flex items-center gap-3 p-4 rounded-xl border-2 border-red-100 bg-red-50 hover:bg-red-100 transition-colors text-left group"
                        >
                            <div className="bg-red-200 p-2 rounded-lg text-red-700 group-hover:scale-110 transition-transform">
                                <Ban size={24} />
                            </div>
                            <div>
                                <div className="font-bold text-red-900">Work Blocked</div>
                                <div className="text-xs text-red-700">Couldn't do anything today</div>
                            </div>
                        </button>

                        <button
                            onClick={() => handleSelect('DELAYED', 'PARTIAL')}
                            className="flex items-center gap-3 p-4 rounded-xl border-2 border-orange-100 bg-orange-50 hover:bg-orange-100 transition-colors text-left group"
                        >
                            <div className="bg-orange-200 p-2 rounded-lg text-orange-700 group-hover:scale-110 transition-transform">
                                <Clock size={24} />
                            </div>
                            <div>
                                <div className="font-bold text-orange-900">Delayed / Partial</div>
                                <div className="text-xs text-orange-700">Started late or stopped early</div>
                            </div>
                        </button>

                        <button
                            onClick={() => handleSelect('SWITCHED_TASK', 'PARTIAL')}
                            className="flex items-center gap-3 p-4 rounded-xl border-2 border-blue-100 bg-blue-50 hover:bg-blue-100 transition-colors text-left group"
                        >
                            <div className="bg-blue-200 p-2 rounded-lg text-blue-700 group-hover:scale-110 transition-transform">
                                <ArrowRight size={24} />
                            </div>
                            <div>
                                <div className="font-bold text-blue-900">Switched Task</div>
                                <div className="text-xs text-blue-700">Did something else instead</div>
                            </div>
                        </button>

                        <button
                            onClick={() => handleSelect('NO_CHANGE', 'NONE')}
                            className="flex items-center gap-3 p-4 rounded-xl border-2 border-emerald-100 bg-emerald-50 hover:bg-emerald-100 transition-colors text-left group"
                        >
                            <div className="bg-emerald-200 p-2 rounded-lg text-emerald-700 group-hover:scale-110 transition-transform">
                                <CheckCircle size={24} />
                            </div>
                            <div>
                                <div className="font-bold text-emerald-900">No Change</div>
                                <div className="text-xs text-emerald-700">Work continued as planned</div>
                            </div>
                        </button>
                    </div>

                    <div className="pt-2">
                        <input
                            type="text"
                            placeholder="Optional: Add a voice note or text..."
                            className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-slate-400 outline-none"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>
                </div>

                <div className="bg-slate-50 p-3 flex justify-center border-t">
                    <button onClick={onDismiss} className="text-slate-400 text-sm hover:text-slate-600">
                        Dismiss (Ignore Event)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WeatherReactionPrompt;
