/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Weather Types - Feature Layer
 *
 * BACKWARD COMPATIBILITY: This file re-exports from domain/types/weather.types.ts
 * New code should import directly from src/domain/types/weather.types
 *
 * @deprecated Import from src/domain/types/ instead
 */

export type {
    WeatherStamp,
    WeatherEventType,
    WeatherEvent,
    FarmerReactionType,
    WeatherReaction,
    WeatherSnapshot,
    DailyForecast,
    DetailedWeather,
} from '../../domain/types/weather.types';
