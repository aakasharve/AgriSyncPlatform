
import { WeatherPort } from '../../application/ports/WeatherPort';
import { PlotGeo } from '../../domain/types';
import { WeatherStamp, DailyForecast } from '../../features/weather/weather.types';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import { systemClock } from '../../core/domain/services/Clock';

const MOCK_DELAY_MS = 600;

class TomorrowIoWeatherService implements WeatherPort {

    // Simple in-memory cache: "lat,lon,hour" -> Promise<WeatherStamp>
    // Storing Promise to deduplicate simultaneous flights
    private cache = new Map<string, { stamp: WeatherStamp, expiresAt: number }>();
    private forecastCache = new Map<string, { forecast: DailyForecast[], expiresAt: number }>();

    private getCacheKey(geo: PlotGeo): string {
        // Cache bucketed by roughly 1km (3 decimal places) and current hour
        const lat = geo.lat.toFixed(3);
        const lon = geo.lon.toFixed(3);
        return `${lat},${lon}`;
    }

    async getCurrentWeather(geo: PlotGeo): Promise<WeatherStamp> {
        const key = this.getCacheKey(geo);
        const cached = this.cache.get(key);
        const now = systemClock.nowEpoch();

        if (cached && cached.expiresAt > now) {
            return cached.stamp;
        }

        const stamp = await this.getMockWeather(geo);

        // Cache for 1 hour
        this.cache.set(key, { stamp, expiresAt: now + 3600 * 1000 });
        return stamp;
    }

    async getForecast(geo: PlotGeo): Promise<DailyForecast[]> {
        const key = this.getCacheKey(geo);
        const cached = this.forecastCache.get(key);
        const now = systemClock.nowEpoch();

        if (cached && cached.expiresAt > now) {
            return cached.forecast;
        }

        const forecast = await this.getMockForecast(geo);

        // Cache for 3 hours
        this.forecastCache.set(key, { forecast, expiresAt: now + 3 * 3600 * 1000 });
        return forecast;
    }

    // --- MOCKS ---

    private async getMockWeather(_geo: PlotGeo): Promise<WeatherStamp> {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const isRainy = Math.random() > 0.85;
        return {
            id: `wx_mock_${idGenerator.generate()}`,
            plotId: 'unknown',
            timestampLocal: systemClock.nowISO(),
            timestampProvider: systemClock.nowISO(),
            provider: 'mock',
            tempC: Number((28 + Math.random() * 5).toFixed(1)),
            humidity: isRainy ? 85 : 45,
            windKph: 12,
            precipMm: isRainy ? 5.5 : 0,
            cloudCoverPct: isRainy ? 90 : 20,
            conditionText: isRainy ? "Rain" : "Sunny",
            iconCode: isRainy ? "rain" : "clear_day",
            rainProbNext6h: isRainy ? 80 : 10,
            windGustKph: 25,
            soilMoistureVolumetric0To10: isRainy ? 35 : 15
        };
    }

    private async getMockForecast(_geo: PlotGeo): Promise<DailyForecast[]> {
        await new Promise(r => setTimeout(r, MOCK_DELAY_MS));
        const forecasts: DailyForecast[] = [];
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() + i);
            forecasts.push({
                date: getDateKey(d),
                tempMin: 20,
                tempMax: 32,
                rainMm: 0,
                windSpeed: 15,
                humidity: 60,
                condition: 'Sunny'
            });
        }
        return forecasts;
    }

    private getCodeLabel(code: number): { text: string, icon: string } {
        const map: Record<number, { text: string, icon: string }> = {
            1000: { text: "Sunny", icon: "sunny" },
            1100: { text: "Mostly Clear", icon: "partly_cloudy" },
            1101: { text: "Partly Cloudy", icon: "partly_cloudy" },
            1102: { text: "Mostly Cloudy", icon: "cloudy" },
            1001: { text: "Cloudy", icon: "cloudy" },
            4000: { text: "Drizzle", icon: "rain" },
            4001: { text: "Rain", icon: "rain" },
            4200: { text: "Light Rain", icon: "rain" },
            4201: { text: "Heavy Rain", icon: "storm" },
            8000: { text: "Thunderstorm", icon: "storm" },
            5000: { text: "Snow", icon: "snow" }
        };
        return map[code] || { text: "Unknown", icon: "cloudy" };
    }

    // --- DOMAIN LOGIC: CHANGE DETECTION ---

    detectWeatherChanges(current: WeatherStamp, previous?: WeatherStamp): any {
        const THRESHOLDS = {
            RAIN_PROB_SPIKE: 30, // % increase
            WIND_GUST_HIGH: 45, // kph
            TEMP_HEAT_SPIKE: 38, // Celsius
            RAIN_MM_HEAVY: 15 // mm in snapshot
        };

        // 1. RAIN ONSET / SPIKE
        if (previous) {
            const probDiff = current.rainProbNext6h - previous.rainProbNext6h;
            if (probDiff >= THRESHOLDS.RAIN_PROB_SPIKE) {
                return this.createEvent(current, 'RAIN_START', 'MEDIUM',
                    `Rain probability spiked by ${probDiff}% (Now ${current.rainProbNext6h}%)`);
            }
        }

        // 2. HEAVY RAIN (Absolute)
        if (current.precipMm >= THRESHOLDS.RAIN_MM_HEAVY) {
            return this.createEvent(current, 'HEAVY_RAIN', 'HIGH',
                `Heavy rain detected: ${current.precipMm}mm`);
        }

        // 3. HIGH WIND (Absolute)
        if (current.windGustKph && current.windGustKph >= THRESHOLDS.WIND_GUST_HIGH) {
            return this.createEvent(current, 'HIGH_WIND', 'HIGH',
                `High wind gusts detected: ${current.windGustKph} kph`);
        }

        // 4. HEAT SPIKE (Absolute)
        if (current.tempC >= THRESHOLDS.TEMP_HEAT_SPIKE) {
            return this.createEvent(current, 'HEAT_SPIKE', 'MEDIUM',
                `Temperature is very high: ${current.tempC.toFixed(1)}°C`);
        }

        // 5. CONDITION CHANGE
        if (previous) {
            const wasRainy = previous.conditionText.toLowerCase().includes('rain') || previous.conditionText.toLowerCase().includes('drizzle');
            const isRainy = current.conditionText.toLowerCase().includes('rain') || current.conditionText.toLowerCase().includes('drizzle');
            if (!wasRainy && isRainy) {
                return this.createEvent(current, 'RAIN_START', 'MEDIUM', `Rain started: ${current.conditionText}`);
            }
        }

        return null;
    }

    private createEvent(stamp: WeatherStamp, type: any, severity: string, note: string): any {
        return {
            id: `we_${idGenerator.generate()}`,
            plotId: stamp.plotId,
            tsStart: stamp.timestampLocal,
            tsEnd: stamp.timestampLocal,
            eventType: type,
            severity,
            signals: {
                rainMm: stamp.precipMm,
                rainProb: stamp.rainProbNext6h,
                temp: stamp.tempC,
                wind: stamp.windGustKph || stamp.windKph,
                humidity: stamp.humidity
            },
            source: `logic_trigger: ${note}`
        };
    }
}

const weatherService = new TomorrowIoWeatherService();
export { weatherService, TomorrowIoWeatherService };
