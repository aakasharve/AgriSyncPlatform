import { WeatherPort } from '../ports/WeatherPort';
import { PlotGeo } from '../../domain/types';
import { WeatherStamp } from '../../features/weather/weather.types';

export const getWeatherForLocation = async (
    geo: PlotGeo,
    weatherPort: WeatherPort
): Promise<WeatherStamp> => {
    // Determine effective location
    // If geo source is 'approx' or invalid, we might want to fallback or warn?
    // For now, pass through to port.
    return weatherPort.getCurrentWeather(geo);
};
