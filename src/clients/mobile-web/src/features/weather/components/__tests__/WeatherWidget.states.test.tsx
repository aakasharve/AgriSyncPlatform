// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherWidget from '../WeatherWidget';

// The component selects its own strings by `language`; the mock only needs to
// supply that (English unless a test says otherwise) so assertions read the en copy.
const lang = vi.hoisted(() => ({ value: 'en' as 'en' | 'mr' }));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: lang.value,
        setLanguage: vi.fn(),
    }),
}));

afterEach(() => { cleanup(); lang.value = 'en'; });

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
        expect(screen.queryByText('Humidity')).toBeNull();
    });

    // lane HONESTY-2 (H6): the green "Boundary verified" tick is gone — a farm centre existing proves nothing about the
    // boundary. It says in words only what is true. (Was: 'shows no caution but a verified tick when the boundary is set'.)
    it('shows no caution but says only that the farm location is set when the boundary is set', () => {
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset={false} onOpenBoundary={vi.fn()} />);
        expect(screen.queryByTestId('weather-boundary-caution')).toBeNull();
        expect(screen.getByTestId('weather-place-set')).toHaveTextContent('Farm location is set');
    });

    it('says nothing about the place when the boundary is not set', () => {
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset onOpenBoundary={vi.fn()} />);
        expect(screen.queryByTestId('weather-place-set')).toBeNull();
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

        // Not vacuous: the modal really did open (its quick-stats row is on screen).
        expect(screen.getByText('Humidity')).toBeInTheDocument();
        expect(container.textContent).not.toContain('31.5');
    });
});

/**
 * lane HONESTY-2 (H6) — the weather card stops saying things it cannot back:
 *  - no "<phone's date> | <phone's time>" line (it was `new Date()` beside a reading cached for up to an hour);
 *  - no green "Boundary verified" tick (it only meant a farm centre exists) — words say only that;
 *  - no always-empty "Previous 5 days" tab, and the forecast heading counts the days the list really holds.
 */
const day = (n: number) => ({
    date: `2026-11-${String(20 + n).padStart(2, '0')}`, tempMin: 15, tempMax: 30, rainMm: 0, windSpeed: 5, humidity: 50, condition: 'Sunny' as const,
});
const dataWith = (days: number) => ({ ...(sampleData as object), forecast: Array.from({ length: days }, (_, i) => day(i)) }) as unknown as React.ComponentProps<typeof WeatherWidget>['data'];

describe('WeatherWidget — H6: no phone clock beside the reading', () => {
    const nowDate = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

    it('the collapsed card prints neither the phone\'s date nor its time', () => {
        const { container } = render(<WeatherWidget status="ready" data={sampleData} boundaryUnset={false} />);
        expect(screen.getByText('28.0°C')).toBeInTheDocument(); // the real reading stays
        expect(container.textContent).not.toContain(nowDate());
        expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
        expect(container.textContent).not.toContain('|');
    });

    it('nor does the opened card', () => {
        const { container } = render(<WeatherWidget status="ready" data={dataWith(3)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.getByText('Humidity')).toBeInTheDocument();
        expect(container.textContent).not.toContain(nowDate());
        expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}/);
        expect(container.textContent).not.toContain('|');
    });
});

describe('WeatherWidget — H6: the tick says only what is true', () => {
    it('no "Boundary verified" anywhere, in either state', () => {
        for (const boundaryUnset of [false, true, undefined]) {
            const { container, unmount } = render(<WeatherWidget status="ready" data={sampleData} boundaryUnset={boundaryUnset} />);
            expect(container.querySelector('[aria-label="Boundary verified"]')).toBeNull();
            expect(container.querySelector('[data-testid="weather-verified"]')).toBeNull();
            expect(container.textContent).not.toMatch(/verified/i);
            unmount();
        }
    });

    it('in Marathi it says "शेताचं ठिकाण ठरलं आहे"', () => {
        lang.value = 'mr';
        render(<WeatherWidget status="ready" data={sampleData} boundaryUnset={false} />);
        expect(screen.getByTestId('weather-place-set')).toHaveTextContent('शेताचं ठिकाण ठरलं आहे');
    });

    it('boundary state not known yet: nothing is said about the place', () => {
        render(<WeatherWidget status="ready" data={sampleData} />);
        expect(screen.queryByTestId('weather-place-set')).toBeNull();
    });
});

describe('WeatherWidget — H6: no empty "Previous 5 days" tab', () => {
    it('the opened card has no previous-days tab and no tab buttons, only the close button', () => {
        render(<WeatherWidget status="ready" data={dataWith(5)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.queryByText(/Previous/i)).toBeNull();
        // The only <button> inside the opened card is the close X — no tab to press.
        expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-label') !== 'Weather details')).toHaveLength(1);
    });

    it('the heading counts the days the list really holds (never "5" over seven cards)', () => {
        render(<WeatherWidget status="ready" data={dataWith(7)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.getByTestId('weather-forecast-heading')).toHaveTextContent('Next 7 days');
    });

    it('one day is "Next 1 day"; in Marathi the count is in Devanagari digits', () => {
        const { unmount } = render(<WeatherWidget status="ready" data={dataWith(1)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.getByTestId('weather-forecast-heading')).toHaveTextContent('Next 1 day');
        unmount();

        lang.value = 'mr';
        render(<WeatherWidget status="ready" data={dataWith(5)} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.getByTestId('weather-forecast-heading')).toHaveTextContent('पुढचे ५ दिवस');
    });

    it('no forecast at all: no heading is drawn over an empty list', () => {
        render(<WeatherWidget status="ready" data={sampleData} />);
        fireEvent.click(screen.getByRole('button', { name: 'Weather details' }));
        expect(screen.queryByTestId('weather-forecast-heading')).toBeNull();
    });
});
