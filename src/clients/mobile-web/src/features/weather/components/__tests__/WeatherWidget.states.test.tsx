// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherWidget from '../WeatherWidget';

// The component selects its own strings by `language`; the mock only needs to
// supply that (English here) so assertions read the en copy.
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'en',
        setLanguage: vi.fn(),
    }),
}));

afterEach(cleanup);

const sampleData = {
    locationName: 'Your Location',
    current: {
        fetchedAt: '', lat: 20, lon: 73, provider: 'tomorrow.io',
        current: { tempC: 28, humidity: 50, windKph: 5, precipMm: 0, conditionText: 'Partly Cloudy', iconCode: '1000' },
        forecast: { rainProb: 0 },
    },
    forecast: [],
    history: [],
    advisory: { title: 'x', content: 'y' },
} as unknown as React.ComponentProps<typeof WeatherWidget>['data'];

describe('WeatherWidget states', () => {
    it('renders the add-location fallback and fires onAddLocation', () => {
        const onAddLocation = vi.fn();
        render(<WeatherWidget status="no-location" onAddLocation={onAddLocation} onRetry={vi.fn()} />);
        const node = screen.getByTestId('weather-fallback');
        expect(node).toHaveAttribute('data-variant', 'no-location');
        screen.getByRole('button', { name: 'Set farm location' }).click();
        expect(onAddLocation).toHaveBeenCalledTimes(1);
    });

    it('renders the error fallback and fires onRetry', () => {
        const onRetry = vi.fn();
        render(<WeatherWidget status="error" onRetry={onRetry} onAddLocation={vi.fn()} />);
        expect(screen.getByTestId('weather-fallback')).toHaveAttribute('data-variant', 'error');
        screen.getByRole('button', { name: 'Retry' }).click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the loading skeleton when status is loading and no data', () => {
        const { container } = render(<WeatherWidget status="loading" />);
        expect(container.querySelector('.animate-pulse')).not.toBeNull();
        expect(screen.queryByTestId('weather-fallback')).toBeNull();
    });

    it('shows the red caution when boundaryUnset and fires onOpenBoundary (not the modal)', () => {
        const onOpenBoundary = vi.fn();
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset onOpenBoundary={onOpenBoundary} />);
        const caution = screen.getByTestId('weather-boundary-caution');
        expect(caution).toBeInTheDocument();
        caution.click();
        expect(onOpenBoundary).toHaveBeenCalledTimes(1);
        // stopPropagation means the weather modal did NOT open
        expect(screen.queryByText('Previous 5 days')).toBeNull();
    });

    it('shows no caution but a verified tick when the boundary is set', () => {
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset={false} onOpenBoundary={vi.fn()} />);
        expect(screen.queryByTestId('weather-boundary-caution')).toBeNull();
        expect(screen.getByTestId('weather-verified')).toBeInTheDocument();
    });

    it('shows no verified tick when the boundary is not set', () => {
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset onOpenBoundary={vi.fn()} />);
        expect(screen.queryByTestId('weather-verified')).toBeNull();
    });
});

/**
 * WAVE 2.3 — THE SECOND TEMPERATURE NOBODY MEASURED.
 * spec: dfes-companion-2026-07-11 (wave-2.3)
 *
 * `/ 31.5°C` was an unconditional JSX literal, not a fallback: the real fallbacks
 * return entirely different components several returns earlier, so this rendered ONLY
 * when live weather had already succeeded. It sat beside the genuine reading in matched
 * typography, reading as a second measured figure — a high, or a feels-like, or a
 * forecast. Nothing anywhere computes 31.5. Doctrine P4: never fabricate.
 */
describe('WeatherWidget — no invented temperature (spec: dfes-companion-2026-07-11)', () => {
    it('renders only the live reading on the collapsed card', () => {
        const { container } = render(<WeatherWidget status="ready" data={sampleData} />);

        // Not vacuous: the REAL reading is on screen.
        expect(screen.getByText('28.0°C')).toBeInTheDocument();
        expect(container.textContent).not.toContain('31.5');
    });

    it('renders only the live reading inside the expanded modal', () => {
        const { container } = render(<WeatherWidget status="ready" data={sampleData} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));

        // Not vacuous: the modal really did open.
        expect(screen.getByText('Previous 5 days')).toBeInTheDocument();
        expect(container.textContent).not.toContain('31.5');
    });
});
