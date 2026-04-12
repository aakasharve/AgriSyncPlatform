/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Weather Formatting Utilities
 * Centralized logic for formatting weather data to ensure UI consistency and hygiene.
 */

/**
 * Formats temperature to a standard precision (1 decimal place).
 * @param tempC The temperature in Celsius.
 * @returns Formatted temperature string followed by °C.
 */
export const formatTemperature = (tempC: number | undefined): string => {
    if (tempC === undefined || isNaN(tempC)) return '--°C';
    // Round to 1 decimal place and append unit
    return `${tempC.toFixed(1)}°C`;
};

/**
 * Formats precipitation to a standard precision (1 decimal place).
 * @param mm The precipitation in millimeters.
 * @returns Formatted precipitation string followed by mm.
 */
export const formatPrecipitation = (mm: number | undefined): string => {
    if (mm === undefined || isNaN(mm)) return '0.0 mm';
    return `${mm.toFixed(1)} mm`;
};

/**
 * Formats humidity as a percentage.
 * @param humidity The humidity percentage.
 * @returns Formatted humidity string.
 */
export const formatHumidity = (humidity: number | undefined): string => {
    if (humidity === undefined || isNaN(humidity)) return '--%';
    return `${Math.round(humidity)}%`;
};

/**
 * Formats wind speed.
 * @param kph The wind speed in km/h.
 * @returns Formatted wind speed string.
 */
export const formatWindSpeed = (kph: number | undefined): string => {
    if (kph === undefined || isNaN(kph)) return '0 Km/h';
    return `${Math.round(kph)} Km/h`;
};
