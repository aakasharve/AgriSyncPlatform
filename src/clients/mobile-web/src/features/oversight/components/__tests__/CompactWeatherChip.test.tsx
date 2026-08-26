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

describe('CompactWeatherChip — variant="compact" (Task 11, founder header restructure)', () => {
    it('renders icon + temperature only — no location text, unlike the full variant', () => {
        render(<CompactWeatherChip variant="compact" data={sampleData} status="ready" />);

        const chip = screen.getByTestId('compact-weather-chip');
        // Real value (28), rounded — never a fabricated number (spec §P-F).
        expect(chip).toHaveTextContent('28°');
        expect(chip).not.toHaveTextContent('Arve Farm');
    });

    it('shows an honest "--°" placeholder when there is no data yet — never a fabricated reading', () => {
        render(<CompactWeatherChip variant="compact" status="loading" />);
        expect(screen.getByTestId('compact-weather-chip')).toHaveTextContent('--°');
    });

    it('surfaces the boundary caution icon in compact form too', () => {
        render(<CompactWeatherChip variant="compact" data={sampleData} status="ready" boundaryUnset />);
        expect(screen.getByTestId('compact-weather-chip-caution')).toBeInTheDocument();
    });

    it('tapping the compact trigger mounts the REAL WeatherWidget through a portal, every prop forwarded', () => {
        const onRetry = vi.fn();
        const onAddLocation = vi.fn();
        const onOpenBoundary = vi.fn();
        render(
            <CompactWeatherChip
                variant="compact"
                data={sampleData}
                status="ready"
                boundaryUnset
                onRetry={onRetry}
                onAddLocation={onAddLocation}
                onOpenBoundary={onOpenBoundary}
            />
        );

        expect(screen.queryByLabelText('Weather details')).toBeNull();
        fireEvent.click(screen.getByTestId('compact-weather-chip'));

        // Proven by WeatherWidget's own aria-label, exactly like the full
        // variant's test above — not a copy of its markup.
        expect(screen.getByLabelText('Weather details')).toBeInTheDocument();

        // WeatherWidget renders its own boundary caution when `boundaryUnset`
        // is forwarded truthfully — proves the prop actually reached it.
        const caution = screen.getByTestId('weather-boundary-caution');
        fireEvent.click(caution);
        expect(onOpenBoundary).toHaveBeenCalledTimes(1);
    });

    it('the sheet the compact trigger opens is NOT a DOM descendant of its own React parent (portal escapes it)', () => {
        // The exact structural property this task's other fix (AppHeader's
        // waiting drawer) relies on: a `createPortal` to `document.body`
        // renders OUTSIDE whatever DOM subtree contains the trigger,
        // regardless of the React tree. Proven directly here rather than
        // only at the AppHeader level, since this is where the portal is
        // actually implemented.
        const { container } = render(
            <div data-testid="not-body-parent">
                <CompactWeatherChip variant="compact" data={sampleData} status="ready" />
            </div>
        );

        fireEvent.click(screen.getByTestId('compact-weather-chip'));
        const sheet = screen.getByTestId('compact-weather-chip-sheet');
        const parent = container.querySelector('[data-testid="not-body-parent"]');

        expect(parent).not.toBeNull();
        expect(parent!.contains(sheet)).toBe(false);
        expect(document.body.contains(sheet)).toBe(true);
    });

    it('closing the compact sheet unmounts it and returns to the collapsed trigger', () => {
        render(<CompactWeatherChip variant="compact" data={sampleData} status="ready" />);

        fireEvent.click(screen.getByTestId('compact-weather-chip'));
        expect(screen.getByTestId('compact-weather-chip-sheet')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('compact-weather-chip-sheet-close'));
        expect(screen.queryByTestId('compact-weather-chip-sheet')).not.toBeInTheDocument();
    });

    it('the full variant is untouched — default (no variant prop) still expands WeatherWidget inline, not through a portal', () => {
        // Regression guard: proves 'full' stays the ORIGINAL Task-7 inline
        // behaviour byte-for-byte — no sheet, no portal, no compact icon.
        render(<CompactWeatherChip data={sampleData} status="ready" />);

        fireEvent.click(screen.getByTestId('compact-weather-chip'));
        expect(screen.getByLabelText('Weather details')).toBeInTheDocument();
        expect(screen.queryByTestId('compact-weather-chip-sheet')).not.toBeInTheDocument();
    });
});
