import React, { useState, useEffect } from 'react';
import { DetailedWeather, WeatherEvent, WeatherReaction, ScheduleShiftEvent, CropProfile, FarmerProfile, LogScope, PlotGeo } from '../../types';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { WeatherPort } from '../../application/ports/WeatherPort';
import type { FarmGeographyPort } from '../../application/ports/FarmGeographyPort';
import { getWeatherForLocation } from '../../application/usecases/AttachWeatherSnapshot';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { makeFarmId } from '../../domain/farmGeography/types';

interface UseWeatherMonitorProps {
    farmerProfile: FarmerProfile;
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
    logScope: LogScope;
    hasActiveLogContext: boolean;
    activeCropId: string | null;
    activePlotId: string | null;
    activeFarmId?: string | null;
    setError: (msg: string | null) => void;
    provider: WeatherPort;
    farmGeography?: FarmGeographyPort;
}

export const useWeatherMonitor = ({
    farmerProfile, crops, setCrops, logScope: _logScope, hasActiveLogContext, activeCropId, activePlotId, activeFarmId, setError, provider, farmGeography
}: UseWeatherMonitorProps) => {

    const [weatherData, setWeatherData] = useState<DetailedWeather | undefined>(undefined);
    const [weatherReactions, setWeatherReactions] = useState<WeatherReaction[]>([]);
    const [pendingWeatherEvent, setPendingWeatherEvent] = useState<WeatherEvent | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const [lastWeatherStamps, setLastWeatherStamps] = useState<Record<string, any>>({});

    // Init Weather (Header Widget) - Pivot to Plot if selected
    useEffect(() => {
        const fetchW = async () => {
            // Weather is anchored to the canonical farm centre. Plot/device
            // coordinates are fallback context only, not weather truth.
            let targetLat: number | undefined;
            let targetLon: number | undefined;
            let sourceLabel = 'Farm Center';

            if (farmGeography && activeFarmId) {
                try {
                    const centre = await farmGeography.getFarmCentre(makeFarmId(activeFarmId));
                    if (centre) {
                        targetLat = centre.lat;
                        targetLon = centre.lng;
                    }
                } catch {
                    /* fallback below */
                }
            }

            if (targetLat === undefined || targetLon === undefined) {
                targetLat = farmerProfile.location?.lat;
                targetLon = farmerProfile.location?.lon;
                sourceLabel = 'Farm Location';
            }

            if (typeof targetLat === 'number' && typeof targetLon === 'number') {
                try {
                    const geo: PlotGeo = { lat: targetLat, lon: targetLon, source: 'approx' };

                    // Parallel: Fetch Forecast AND Current
                    const [forecast, stamp] = await Promise.all([
                        provider.getForecast(geo),
                        getWeatherForLocation(geo, provider)
                    ]);

                    // Adapt for UI Widget (Legacy Shape)
                    const displayData: DetailedWeather = {
                        locationName: sourceLabel,
                        current: {
                            fetchedAt: stamp.timestampLocal,
                            lat: targetLat, lon: targetLon,
                            provider: stamp.provider,
                            current: {
                                tempC: stamp.tempC,
                                humidity: stamp.humidity,
                                windKph: stamp.windKph,
                                precipMm: stamp.precipMm,
                                conditionText: stamp.conditionText,
                                iconCode: stamp.iconCode
                            },
                            forecast: { rainProb: stamp.rainProbNext6h }
                        },
                        forecast: forecast.map(f => ({
                            date: f.date,
                            tempMin: f.tempMin,
                            tempMax: f.tempMax,
                            rainMm: f.rainMm,
                            windSpeed: f.windSpeed,
                            humidity: f.humidity,
                            condition: f.condition
                        })),
                        history: [], // Not yet implemented
                        advisory: {
                            title: "Weather Advisory",
                            content: stamp.rainProbNext6h > 60
                                ? "Rain expected. Plan indoor activities or drainage checks."
                                : "Conditions tailored for groundwork."
                        }
                    };

                    setWeatherData(displayData);

                    // RUN CHANGE DETECTION
                    const weatherContextId = activePlotId || activeFarmId || 'farm_center';
                    if (weatherContextId) {
                        const prev = lastWeatherStamps[weatherContextId];
                        // Inject Context (Plot ID)
                        const contextualStamp = {
                            ...stamp,
                            plotId: weatherContextId
                        };

                        const event = provider.detectWeatherChanges?.(contextualStamp, prev);

                        // Update cache
                        setLastWeatherStamps(prev => ({ ...prev, [weatherContextId]: contextualStamp }));

                        if (event) {
                            // Only trigger if we haven't already reacted to this event ID (mock check)
                            // In real app, check DB for eventId
                            console.log("Weather Event Detected:", event);
                            setPendingWeatherEvent(event);
                        }
                    }

                } catch (err) {
                    console.error("Weather init failed", err);
                }
            }
        };
        fetchW();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    }, [farmerProfile.location, hasActiveLogContext, activePlotId, activeCropId, activeFarmId, crops, provider, farmGeography]); // Expanded deps for safety

    const handleWeatherReaction = (reaction: WeatherReaction) => {
        setWeatherReactions(prev => [reaction, ...prev]);
        setPendingWeatherEvent(null);

        // AUTO-ADAPT SCHEDULE
        if (reaction.reactionType === 'WORK_BLOCKED') {
            const shiftDays = 1; // Simplification: Full day block = 1 day shift
            const newShift: ScheduleShiftEvent = {
                id: `sh_${idGenerator.generate()}`,
                plotId: reaction.plotId,
                date: getDateKey(),
                shiftDays,
                reason: 'WEATHER',
                evidenceWeatherEventIds: [reaction.eventId],
                note: reaction.note
            };

            // Update Plot Logic
            setCrops(prevCrops => prevCrops.map(c => ({
                ...c,
                plots: c.plots.map(p => {
                    if (p.id === reaction.plotId) {
                        return {
                            ...p,
                            scheduleShifts: [...(p.scheduleShifts || []), newShift]
                        };
                    }
                    return p;
                })
            })));

            // Notify user
            console.log("Auto-shifted schedule by +1 day due to weather block.");
            setError("Schedule adapted: +1 Day delay added.");
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const handleDebugTrigger = (type: any) => {
        if (!activePlotId) {
            setError("Select a plot first to simulate events.");
            return;
        }
        const event: WeatherEvent = {
            id: `we_sim_${idGenerator.generate()}`,
            plotId: activePlotId,
            tsStart: systemClock.nowISO(),
            tsEnd: systemClock.nowISO(),
            eventType: type,
            severity: 'HIGH',
            signals: { rainMm: 50, temp: 28 },
            source: 'simulation_trigger'
        };
        setPendingWeatherEvent(event);
    };

    return {
        weatherData,
        pendingWeatherEvent,
        setPendingWeatherEvent,
        weatherReactions,
        handleWeatherReaction,
        handleDebugTrigger
    };
};
