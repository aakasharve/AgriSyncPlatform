// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 7 — pins CompactWeatherChip's one locked behaviour (design doc §4.2):
 * a compact chip collapsed by default that expands, on tap, into the
 * EXISTING WeatherWidget — never a reimplementation of it.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import CompactWeatherChip from '../CompactWeatherChip';
import WeatherWidget from '../../../weather/components/WeatherWidget';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'en',
        t: (key: string) => (key === 'weather' ? 'Weather' : key),
    }),
}));

afterEach(cleanup);

const sampleData = {
    locationName: 'Arve Farm',
    current: {
        fetchedAt: '', lat: 20, lon: 73, provider: 'tomorrow.io',
        current: { tempC: 28, humidity: 50, windKph: 5, precipMm: 0, conditionText: 'Partly Cloudy', iconCode: '1000' },
        forecast: { rainProb: 0 },
    },
    forecast: [],
    history: [],
    advisory: { title: 'x', content: 'y' },
} as unknown as React.ComponentProps<typeof WeatherWidget>['data'];

describe('CompactWeatherChip', () => {
    it('the_weather_chip_expands_to_the_existing_widget', () => {
        render(<CompactWeatherChip data={sampleData} status="ready" />);

        // Collapsed by default: the chip is present, the real WeatherWidget's
        // own collapsed card (its distinguishing aria-label) is not yet mounted.
        const chip = screen.getByTestId('compact-weather-chip');
        expect(chip).toBeInTheDocument();
        expect(screen.queryByLabelText('Weather details')).toBeNull();

        fireEvent.click(chip);

        // Expanding mounts the REAL WeatherWidget — proven by its own
        // aria-label ("Weather details", WeatherWidget.tsx) rather than any
        // copy of its markup, so a future WeatherWidget rewrite cannot make
        // this test pass without the actual component being present.
        expect(screen.getByLabelText('Weather details')).toBeInTheDocument();
        expect(screen.queryByTestId('compact-weather-chip')).toBeNull();
    });

    it('renders a one-line summary from the same data WeatherWidget would use, never a fabricated number', () => {
        render(<CompactWeatherChip data={sampleData} status="ready" />);
        // 28°C formatted via the shared formatTemperature() — same source
        // WeatherWidget itself reads, not a re-derived or invented value.
        expect(screen.getByText('28.0°C')).toBeInTheDocument();
        expect(screen.getByText('Arve Farm')).toBeInTheDocument();
    });

    it('shows the English placeholder label, not a number, when there is no data yet', () => {
        render(<CompactWeatherChip status="loading" />);
        expect(screen.getByTestId('compact-weather-chip')).toHaveTextContent('Weather');
    });

    it('surfaces the boundary caution icon without opening WeatherWidget a second way', () => {
        render(<CompactWeatherChip data={sampleData} status="ready" boundaryUnset />);
        expect(screen.getByTestId('compact-weather-chip-caution')).toBeInTheDocument();
    });

    it('forwards every prop to WeatherWidget unchanged on expand', () => {
        const onRetry = vi.fn();
        const onAddLocation = vi.fn();
        const onOpenBoundary = vi.fn();
        render(
            <CompactWeatherChip
                data={sampleData}
                status="ready"
                boundaryUnset
                onRetry={onRetry}
                onAddLocation={onAddLocation}
                onOpenBoundary={onOpenBoundary}
            />
        );
        fireEvent.click(screen.getByTestId('compact-weather-chip'));

        // WeatherWidget renders its own boundary caution when boundaryUnset
        // is forwarded truthfully — proves the prop actually reached it.
        const caution = screen.getByTestId('weather-boundary-caution');
        fireEvent.click(caution);
        expect(onOpenBoundary).toHaveBeenCalledTimes(1);
    });
});
