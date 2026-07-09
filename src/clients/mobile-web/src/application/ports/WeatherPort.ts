import { PlotGeo } from '../../domain/types';
import { WeatherStamp, DailyForecast } from '../../features/weather/weather.types';
import { WeatherEvent } from '../../types';

export interface WeatherPort {
    getCurrentWeather(geo: PlotGeo): Promise<WeatherStamp>;
    getForecast(geo: PlotGeo): Promise<DailyForecast[]>;
    detectWeatherChanges?: (current: WeatherStamp, previous?: WeatherStamp) => WeatherEvent | null;
    // Coordinate-based weather (no farm anchor) — used for device-GPS weather
    // when the farm has no drawn centre. Optional so other impls/mocks needn't provide them.
    getCurrentWeatherByCoords?: (lat: number, lon: number) => Promise<WeatherStamp>;
    getForecastByCoords?: (lat: number, lon: number, days: number) => Promise<DailyForecast[]>;
}
