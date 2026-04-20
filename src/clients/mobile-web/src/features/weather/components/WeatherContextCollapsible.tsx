/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Cloud, ChevronDown, ChevronUp } from 'lucide-react';
import { WeatherSnapshot } from '../../../types';
import { formatTemperature, formatHumidity, formatWindSpeed, formatPrecipitation } from '../../../shared/utils/weatherFormatter';


interface WeatherContextCollapsibleProps {
    weather?: WeatherSnapshot;
}

/**
 * Weather Context Collapsible
 * 
 * DEMOTED BY DESIGN:
 * - Collapsed by default
 * - Visually secondary
 * - Never interrupts cost/work flow
 * 
 * Reason: Weather is context, not evidence.
 */
const WeatherContextCollapsible: React.FC<WeatherContextCollapsibleProps> = ({ weather }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!weather) {
        return null;
    }

    return (
        <div className="weather-context">
            <button
                className="weather-header"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
            >
                <div className="weather-header-left">
                    <Cloud size={18} className="weather-icon" />
                    <span className="weather-title">Weather Context</span>
                    <span className="weather-summary">{weather.current.conditionText}</span>
                </div>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {isExpanded && (
                <div className="weather-details">
                    <div className="weather-row">
                         <span className="weather-label">Temperature</span>
                        <span className="weather-value">{formatTemperature(weather.current.tempC)}</span>
                    </div>

                    <div className="weather-row">
                         <span className="weather-label">Humidity</span>
                        <span className="weather-value">{formatHumidity(weather.current.humidity)}</span>
                    </div>

                    <div className="weather-row">
                         <span className="weather-label">Wind</span>
                        <span className="weather-value">{formatWindSpeed(weather.current.windKph)}</span>
                    </div>

                    {weather.current.precipMm > 0 && (
                         <div className="weather-row">
                            <span className="weather-label">Rainfall</span>
                            <span className="weather-value">{formatPrecipitation(weather.current.precipMm)}</span>
                        </div>
                    )}

                    <div className="weather-note">
                        <small>Weather data for context only, not cost factor</small>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WeatherContextCollapsible;
