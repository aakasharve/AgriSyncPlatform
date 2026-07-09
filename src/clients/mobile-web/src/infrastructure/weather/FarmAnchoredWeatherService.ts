import type { WeatherPort } from '../../application/ports/WeatherPort';
import type { FarmGeographyPort } from '../../application/ports/FarmGeographyPort';
import { makeFarmId } from '../../domain/farmGeography/types';
import type { PlotGeo } from '../../domain/types';
import type { DailyForecast, WeatherStamp } from '../../features/weather/weather.types';
import type { WeatherEvent } from '../../types';

export class FarmAnchoredWeatherService implements WeatherPort {
    constructor(
        private readonly inner: WeatherPort,
        private readonly farmGeography: FarmGeographyPort,
        private readonly getActiveFarmId: () => string | null | undefined,
    ) { }

    async getCurrentWeather(geo: PlotGeo): Promise<WeatherStamp> {
        return this.inner.getCurrentWeather(await this.resolveFarmGeo(geo));
    }

    async getForecast(geo: PlotGeo): Promise<DailyForecast[]> {
        return this.inner.getForecast(await this.resolveFarmGeo(geo));
    }

    // Coordinate-based weather is NOT farm-anchored — forward the raw coords
    // straight to the inner client (used for device-GPS weather when the farm
    // has no drawn centre). Without these, useWeatherMonitor's capability guard
    // is false in prod and device weather silently never fires.
    async getCurrentWeatherByCoords(lat: number, lon: number): Promise<WeatherStamp> {
        if (!this.inner.getCurrentWeatherByCoords) {
            throw new Error('Coordinate weather is not supported by the inner provider.');
        }
        return this.inner.getCurrentWeatherByCoords(lat, lon);
    }

    async getForecastByCoords(lat: number, lon: number, days: number): Promise<DailyForecast[]> {
        if (!this.inner.getForecastByCoords) {
            throw new Error('Coordinate forecast is not supported by the inner provider.');
        }
        return this.inner.getForecastByCoords(lat, lon, days);
    }

    detectWeatherChanges(current: WeatherStamp, previous?: WeatherStamp): WeatherEvent | null {
        return this.inner.detectWeatherChanges?.(current, previous) ?? null;
    }

    private async resolveFarmGeo(fallback: PlotGeo): Promise<PlotGeo> {
        const farmId = this.getActiveFarmId();
        if (!farmId) {
            return fallback;
        }

        try {
            const centre = await this.farmGeography.getFarmCentre(makeFarmId(farmId));
            if (!centre) {
                return fallback;
            }

            return {
                lat: centre.lat,
                lon: centre.lng,
                source: 'approx',
                accuracyMeters: centre.accuracyMeters,
                updatedAt: centre.capturedAt,
            };
        } catch {
            return fallback;
        }
    }
}
