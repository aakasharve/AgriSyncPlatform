import React, { useState, useEffect, useCallback } from 'react';
import { DetailedWeather, DailyForecast, WeatherEvent, WeatherEventType, WeatherStamp, WeatherReaction, ScheduleShiftEvent, CropProfile, FarmerProfile, PlotGeo } from '../../types';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { WeatherPort } from '../../application/ports/WeatherPort';
import type { FarmGeographyPort } from '../../application/ports/FarmGeographyPort';
import { getWeatherForLocation } from '../../application/usecases/AttachWeatherSnapshot';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';
import { makeFarmId } from '../../domain/farmGeography/types';
import { isFarmCentreMissing } from '../../infrastructure/weather/WeatherFetchError';

/**
 * Header weather-widget lifecycle:
 *  - loading:     resolving coords / fetch in flight
 *  - ready:       weatherData populated
 *  - no-location: no farm centre and no profile location (user-actionable)
 *  - error:       the backend fetch failed (service down / key unset — retryable)
 */
export type WeatherStatus = 'loading' | 'ready' | 'no-location' | 'error';

/** Where the shown weather is anchored. 'device'/'profile' => boundary not drawn. */
export type WeatherSource = 'farm-centre' | 'profile' | 'device' | null;

interface CoordFallback {
    lat: number;
    lon: number;
    label: string;
    source: 'profile' | 'device';
}

/** Build the legacy DetailedWeather UI shape from a stamp + forecast (shared by the farm and coord paths). */
const buildDisplayData = (
    stamp: WeatherStamp,
    forecast: DailyForecast[],
    lat: number,
    lon: number,
    sourceLabel: string,
): DetailedWeather => ({
    locationName: sourceLabel,
    current: {
        fetchedAt: stamp.timestampLocal,
        lat, lon,
        provider: stamp.provider,
        current: {
            tempC: stamp.tempC,
            humidity: stamp.humidity,
            windKph: stamp.windKph,
            precipMm: stamp.precipMm,
            conditionText: stamp.conditionText,
            iconCode: stamp.iconCode,
        },
        forecast: { rainProb: stamp.rainProbNext6h },
    },
    forecast: forecast.map(f => ({
        date: f.date,
        tempMin: f.tempMin,
        tempMax: f.tempMax,
        rainMm: f.rainMm,
        windSpeed: f.windSpeed,
        humidity: f.humidity,
        condition: f.condition,
    })),
    history: [],
    advisory: {
        title: 'Weather Advisory',
        content: stamp.rainProbNext6h > 60
            ? 'Rain expected. Plan indoor activities or drainage checks.'
            : 'Conditions tailored for groundwork.',
    },
});

interface UseWeatherMonitorProps {
    farmerProfile: FarmerProfile;
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
    hasActiveLogContext: boolean;
    activeCropId: string | null;
    activePlotId: string | null;
    activeFarmId?: string | null;
    setError: (msg: string | null) => void;
    provider: WeatherPort;
    farmGeography?: FarmGeographyPort;
    // Consent-gated device GPS. Returns null when consent is not granted or GPS
    // is unavailable — so weather uses the device location only with consent.
    getDeviceLocation?: () => Promise<{ lat: number; lon: number } | null>;
}

export const useWeatherMonitor = ({
    farmerProfile, crops, setCrops, hasActiveLogContext, activeCropId, activePlotId, activeFarmId, setError, provider, farmGeography, getDeviceLocation
}: UseWeatherMonitorProps) => {

    const [weatherData, setWeatherData] = useState<DetailedWeather | undefined>(undefined);
    const [weatherReactions, setWeatherReactions] = useState<WeatherReaction[]>([]);
    const [pendingWeatherEvent, setPendingWeatherEvent] = useState<WeatherEvent | null>(null);
    const [lastWeatherStamps, setLastWeatherStamps] = useState<Record<string, WeatherStamp>>({});
    const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('loading');
    const [boundaryUnset, setBoundaryUnset] = useState(false);
    const [refetchNonce, setRefetchNonce] = useState(0);

    // Init Weather (Header Widget). Resolution order: farm centre (weather
    // truth) → saved profile location → consent-gated device GPS → no-location.
    useEffect(() => {
        // Stale-response guard: if the effect re-runs (farm switch / retry)
        // before this fetch resolves, the cleanup flips `cancelled` so the
        // losing request cannot overwrite the newer one's state.
        let cancelled = false;

        // Populate weatherData + status from a fetched stamp/forecast. Isolated
        // change-detection so a throw there can't demote the already-'ready' status.
        const renderFetched = (
            stamp: WeatherStamp,
            forecast: DailyForecast[],
            lat: number,
            lon: number,
            sourceLabel: string,
            source: WeatherSource,
            boundaryMissing: boolean,
        ) => {
            if (cancelled) return;
            setWeatherData(buildDisplayData(stamp, forecast, lat, lon, sourceLabel));
            setBoundaryUnset(boundaryMissing);
            setWeatherStatus('ready');
            // Change-detection is meaningful only for the farm's own weather
            // (farm centre). A transient device/profile-location stamp must NOT be
            // diffed against the farm-id-keyed cache — that produces spurious
            // cross-location weather-change events.
            if (source !== 'farm-centre') return;
            try {
                const weatherContextId = activePlotId || activeFarmId || 'farm_center';
                const prev = lastWeatherStamps[weatherContextId];
                const contextualStamp = { ...stamp, plotId: weatherContextId };
                const event = provider.detectWeatherChanges?.(contextualStamp, prev);
                setLastWeatherStamps(prevStamps => ({ ...prevStamps, [weatherContextId]: contextualStamp }));
                if (event) {
                    console.log('Weather Event Detected:', event);
                    setPendingWeatherEvent(event);
                }
            } catch (detectErr) {
                console.error('Weather change-detection failed', detectErr);
            }
        };

        // No farm centre: try the saved profile location, then (consent-gated) device GPS.
        const resolveCoordFallback = async (): Promise<CoordFallback | null> => {
            const pLat = farmerProfile.location?.lat;
            const pLon = farmerProfile.location?.lon;
            if (typeof pLat === 'number' && typeof pLon === 'number' && !(pLat === 0 && pLon === 0)) {
                return { lat: pLat, lon: pLon, label: 'Farm Location', source: 'profile' };
            }
            if (getDeviceLocation) {
                const dev = await getDeviceLocation();
                // Reject the null-island sentinel (0,0), same as the profile path.
                if (dev && !(dev.lat === 0 && dev.lon === 0)) {
                    return { lat: dev.lat, lon: dev.lon, label: 'Your Location', source: 'device' };
                }
            }
            return null;
        };

        const fetchW = async () => {
            // 1. Farm-anchored weather (canonical centre) — weather truth.
            let farmLat: number | undefined;
            let farmLon: number | undefined;
            if (farmGeography && activeFarmId) {
                try {
                    const centre = await farmGeography.getFarmCentre(makeFarmId(activeFarmId));
                    if (centre) {
                        farmLat = centre.lat;
                        farmLon = centre.lng;
                    }
                } catch {
                    /* fall through to coord fallback */
                }
            }
            if (cancelled) return;

            // Treat a (0,0) centre as unset (defaulted-but-not-null) so it falls
            // through to the coord fallback instead of showing Gulf-of-Guinea weather.
            if (typeof farmLat === 'number' && typeof farmLon === 'number' && !(farmLat === 0 && farmLon === 0)) {
                setWeatherStatus('loading');
                try {
                    const geo: PlotGeo = { lat: farmLat, lon: farmLon, source: 'approx' };
                    const [forecast, stamp] = await Promise.all([
                        provider.getForecast(geo),
                        getWeatherForLocation(geo, provider),
                    ]);
                    if (cancelled) return;
                    renderFetched(stamp, forecast, farmLat, farmLon, 'Farm Center', 'farm-centre', false);
                } catch (err) {
                    if (cancelled) return;
                    console.error('Weather init failed', err);
                    // Missing farm centre is a distinct backend signal (400) — but
                    // rather than dead-ending, fall through to the coord fallback.
                    if (isFarmCentreMissing(err)) {
                        await fetchCoordFallback();
                    } else {
                        setWeatherStatus('error');
                    }
                }
                return;
            }

            // 2. No farm centre → boundary not drawn.
            await fetchCoordFallback();
        };

        const fetchCoordFallback = async () => {
            const fallback = await resolveCoordFallback();
            if (cancelled) return;

            if (fallback && provider.getCurrentWeatherByCoords && provider.getForecastByCoords) {
                setWeatherStatus('loading');
                try {
                    const [forecast, stamp] = await Promise.all([
                        provider.getForecastByCoords(fallback.lat, fallback.lon, 7),
                        provider.getCurrentWeatherByCoords(fallback.lat, fallback.lon),
                    ]);
                    if (cancelled) return;
                    renderFetched(stamp, forecast, fallback.lat, fallback.lon, fallback.label, fallback.source, true);
                } catch (err) {
                    if (cancelled) return;
                    console.error('Device weather fetch failed', err);
                    setBoundaryUnset(true);
                    setWeatherStatus('error');
                }
                return;
            }

            setBoundaryUnset(true);
            setWeatherStatus('no-location');
        };

        fetchW();
        return () => { cancelled = true; };
        // getDeviceLocation IS a dep (its identity tracks gps_consent, so granting
        // consent re-runs the fetch → device weather appears). lastWeatherStamps is
        // read for change-detection but deliberately excluded: the effect updates it
        // via setLastWeatherStamps, so including it would re-fire the fetch in a loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [farmerProfile.location, hasActiveLogContext, activePlotId, activeCropId, activeFarmId, crops, provider, farmGeography, refetchNonce, getDeviceLocation]);

    // Re-trigger the fetch effect (used by the widget's "retry" action).
    const refetchWeather = useCallback(() => setRefetchNonce(n => n + 1), []);

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

    const handleDebugTrigger = (type: WeatherEventType) => {
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
        weatherStatus,
        boundaryUnset,
        refetchWeather,
        pendingWeatherEvent,
        setPendingWeatherEvent,
        weatherReactions,
        handleWeatherReaction,
        handleDebugTrigger
    };
};
