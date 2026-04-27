import { WeatherPort } from '../../application/ports/WeatherPort';
import { PlotGeo } from '../../domain/types';
import { WeatherStamp, DailyForecast } from '../../features/weather/weather.types';
import { getAuthSession } from '../api/AuthTokenStore';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';

interface ViteImportMeta {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
    }
    return headers;
};

interface WeatherSnapshotDto {
    provider: string;
    observedAtUtc: string;
    tempC: number;
    humidity: number;
    windKph: number;
    windGustKph: number | null;
    precipMm: number;
    cloudCoverPct: number;
    conditionText: string;
    iconCode: string;
    rainProbNext6h: number;
    uvIndex: number | null;
    soilMoistureVolumetric0To10: number | null;
}

interface DailyForecastDto {
    date: string;
    tempMinC: number;
    tempMaxC: number;
    rainMm: number;
    windSpeedKph: number;
    humidity: number;
    condition: string;
}

const CURRENT_TTL_MS = 60 * 60 * 1000;
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;

const coerceForecastCondition = (raw: string): DailyForecast['condition'] => {
    const c = raw.toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('storm') || c.includes('thunder')) return 'Rain';
    if (c.includes('partly')) return 'Partly Cloudy';
    if (c.includes('cloud') || c.includes('fog')) return 'Cloudy';
    return 'Sunny';
};

const coerceProvider = (raw: string): WeatherStamp['provider'] => {
    if (raw === 'tomorrow.io' || raw === 'open_weather' || raw === 'mock') return raw;
    return 'tomorrow.io';
};

export class BackendWeatherClient implements WeatherPort {
    private currentCache = new Map<string, { stamp: WeatherStamp; expiresAt: number }>();
    private forecastCache = new Map<string, { forecast: DailyForecast[]; expiresAt: number }>();

    constructor(private readonly getActiveFarmId: () => string | null | undefined) {}

    async getCurrentWeather(_geo: PlotGeo): Promise<WeatherStamp> {
        const farmId = this.getActiveFarmId();
        if (!farmId) throw new Error('No active farm selected; cannot fetch weather.');

        const now = systemClock.nowEpoch();
        const cached = this.currentCache.get(farmId);
        if (cached && cached.expiresAt > now) return cached.stamp;

        const base = resolveBaseUrl();
        const response = await fetch(`${base}/shramsafal/farms/${farmId}/weather/current`, {
            method: 'GET',
            headers: authHeaders(),
        });
        if (!response.ok) {
            throw new Error(`Weather request failed with HTTP ${response.status}.`);
        }
        const dto = await response.json() as WeatherSnapshotDto;
        const stamp: WeatherStamp = {
            id: `wx_${idGenerator.generate()}`,
            plotId: 'farm',
            timestampLocal: systemClock.nowISO(),
            timestampProvider: dto.observedAtUtc,
            provider: coerceProvider(dto.provider),
            tempC: dto.tempC,
            humidity: dto.humidity,
            windKph: dto.windKph,
            precipMm: dto.precipMm,
            cloudCoverPct: dto.cloudCoverPct,
            conditionText: dto.conditionText,
            iconCode: dto.iconCode,
            rainProbNext6h: dto.rainProbNext6h,
            windGustKph: dto.windGustKph ?? undefined,
            uvIndex: dto.uvIndex ?? undefined,
            soilMoistureVolumetric0To10: dto.soilMoistureVolumetric0To10 ?? undefined,
        };
        this.currentCache.set(farmId, { stamp, expiresAt: now + CURRENT_TTL_MS });
        return stamp;
    }

    async getForecast(_geo: PlotGeo): Promise<DailyForecast[]> {
        const farmId = this.getActiveFarmId();
        if (!farmId) throw new Error('No active farm selected; cannot fetch forecast.');

        const now = systemClock.nowEpoch();
        const cached = this.forecastCache.get(farmId);
        if (cached && cached.expiresAt > now) return cached.forecast;

        const base = resolveBaseUrl();
        const response = await fetch(`${base}/shramsafal/farms/${farmId}/weather/forecast?days=7`, {
            method: 'GET',
            headers: authHeaders(),
        });
        if (!response.ok) {
            throw new Error(`Forecast request failed with HTTP ${response.status}.`);
        }
        const dtos = await response.json() as DailyForecastDto[];
        const forecast: DailyForecast[] = dtos.map(d => ({
            date: d.date,
            tempMin: d.tempMinC,
            tempMax: d.tempMaxC,
            rainMm: d.rainMm,
            windSpeed: d.windSpeedKph,
            humidity: d.humidity,
            condition: coerceForecastCondition(d.condition),
        }));
        this.forecastCache.set(farmId, { forecast, expiresAt: now + FORECAST_TTL_MS });
        return forecast;
    }

    detectWeatherChanges(current: WeatherStamp, previous?: WeatherStamp) {
        const THRESH = { RAIN_PROB_SPIKE: 30, WIND_GUST_HIGH: 45, TEMP_HEAT_SPIKE: 38, RAIN_MM_HEAVY: 15 };

        if (previous) {
            const diff = current.rainProbNext6h - previous.rainProbNext6h;
            if (diff >= THRESH.RAIN_PROB_SPIKE) {
                return this.event(current, 'RAIN_START', 'MEDIUM', `Rain probability spiked by ${diff}% (now ${current.rainProbNext6h}%)`);
            }
        }
        if (current.precipMm >= THRESH.RAIN_MM_HEAVY) {
            return this.event(current, 'HEAVY_RAIN', 'HIGH', `Heavy rain detected: ${current.precipMm}mm`);
        }
        if (current.windGustKph && current.windGustKph >= THRESH.WIND_GUST_HIGH) {
            return this.event(current, 'HIGH_WIND', 'HIGH', `High wind gusts: ${current.windGustKph} kph`);
        }
        if (current.tempC >= THRESH.TEMP_HEAT_SPIKE) {
            return this.event(current, 'HEAT_SPIKE', 'MEDIUM', `Temperature is very high: ${current.tempC.toFixed(1)}°C`);
        }
        if (previous) {
            const wasRainy = /rain|drizzle/i.test(previous.conditionText);
            const isRainy = /rain|drizzle/i.test(current.conditionText);
            if (!wasRainy && isRainy) {
                return this.event(current, 'RAIN_START', 'MEDIUM', `Rain started: ${current.conditionText}`);
            }
        }
        return null;
    }

    private event(stamp: WeatherStamp, type: string, severity: string, note: string) {
        return {
            id: `we_${idGenerator.generate()}`,
            plotId: stamp.plotId,
            tsStart: stamp.timestampLocal,
            tsEnd: stamp.timestampLocal,
            eventType: type as never,
            severity: severity as never,
            signals: {
                rainMm: stamp.precipMm,
                rainProb: stamp.rainProbNext6h,
                temp: stamp.tempC,
                wind: stamp.windGustKph || stamp.windKph,
                humidity: stamp.humidity,
            },
            source: `backend_trigger: ${note}`,
        };
    }
}
