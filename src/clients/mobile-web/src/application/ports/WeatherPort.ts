import { PlotGeo } from '../../domain/types';
import { WeatherStamp, DailyForecast } from '../../features/weather/weather.types';
import { WeatherEvent } from '../../types';

export interface WeatherPort {
    getCurrentWeather(geo: PlotGeo): Promise<WeatherStamp>;
    getForecast(geo: PlotGeo): Promise<DailyForecast[]>;
    detectWeatherChanges?: (current: WeatherStamp, previous?: WeatherStamp) => WeatherEvent | null;
}
