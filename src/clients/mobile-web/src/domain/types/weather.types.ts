/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Weather Types
 *
 * Pure domain types for weather data. No imports from features/ or UI.
 * This is the canonical location for weather types.
 */

// =============================================================================
// WEATHER SPINE (Primary Truth)
// =============================================================================

/**
 * WeatherStamp - The immutable weather record at a point in time.
 * This is the "spine" that all weather-related decisions hang from.
 */
export interface WeatherStamp {
    id: string;
    plotId: string;
    timestampLocal: string;
    timestampProvider: string;
    provider: 'tomorrow.io' | 'open_weather' | 'mock';

    // Core Observed
    tempC: number;
    humidity: number;
    windKph: number;
    precipMm: number;
    cloudCoverPct: number;
    conditionText: string;
    iconCode: string;

    // Forecast Context (Decision Grade)
    rainProbNext6h: number; // Max probability in next 6h
    windGustKph?: number;

    // Advanced / Derived
    soilMoistureVolumetric0To10?: number; // 0-100%
    uvIndex?: number;

    alerts?: string[]; // e.g., ["Storm Warning", "Heat Wave"]
}

// =============================================================================
// WEATHER EVENTS (Significant Weather Occurrences)
// =============================================================================

export type WeatherEventType =
    | 'RAIN_START'
    | 'HEAVY_RAIN'
    | 'DRY_SPELL'
    | 'HEAT_SPIKE'
    | 'HIGH_WIND'
    | 'FOG'
    | 'LIGHTNING_RISK';

export interface WeatherEvent {
    id: string;
    plotId: string;
    tsStart: string;
    tsEnd: string;
    eventType: WeatherEventType;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';

    // Snapshot of implementation data
    signals: {
        rainMm?: number;
        rainProb?: number;
        temp?: number;
        wind?: number;
        humidity?: number;
    };

    source: string; // "tomorrow.io_trigger"
    linkedLogId?: string; // If farmer logged during this
}

// =============================================================================
// FARMER REACTIONS (How farmer responded to weather)
// =============================================================================

export type FarmerReactionType =
    | 'NO_CHANGE'
    | 'DELAYED'
    | 'WORK_BLOCKED'
    | 'SWITCHED_TASK'
    | 'ADVANCED'
    | 'DAMAGE_NOTICED';

export interface WeatherReaction {
    id: string;
    eventId: string; // Link to WeatherEvent
    plotId: string;
    reactionType: FarmerReactionType;
    impactScope: 'NONE' | 'PARTIAL' | 'FULL_DAY';
    affectedPlanItems?: string[]; // e.g., ["Spraying", "Harvest"]
    note?: string;
    createdAt: string;
}

// =============================================================================
// WEATHER SNAPSHOT (Legacy - for backward compatibility)
// =============================================================================

/**
 * @deprecated Use WeatherStamp instead. Kept for backward compatibility.
 */
export interface WeatherSnapshot {
    fetchedAt: string;
    lat: number;
    lon: number;
    provider: string;
    current: {
        tempC: number;
        humidity: number;
        windKph: number;
        precipMm: number;
        conditionText: string;
        iconCode: string;
    };
    forecast?: {
        rainProb: number;
    };
}

// =============================================================================
// FORECAST TYPES
// =============================================================================

export interface DailyForecast {
    date: string;
    tempMin: number;
    tempMax: number;
    rainMm: number;
    windSpeed: number;
    humidity: number;
    condition: 'Sunny' | 'Cloudy' | 'Rain' | 'Partly Cloudy';
}

export interface DetailedWeather {
    current: WeatherSnapshot; // @deprecated
    locationName: string;
    forecast: DailyForecast[];
    history: DailyForecast[];
    advisory: { title: string; content: string; source?: string };
}
