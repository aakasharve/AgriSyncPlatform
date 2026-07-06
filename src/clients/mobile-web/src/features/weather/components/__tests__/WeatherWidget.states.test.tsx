// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherWidget from '../WeatherWidget';

const STRINGS: Record<string, string> = {
    'weatherWidget.addLocationTitle': 'Add your farm location to see weather',
    'weatherWidget.addLocationCta': 'Set farm location',
    'weatherWidget.unavailableTitle': 'Weather unavailable right now',
    'weatherWidget.unavailableBody': 'We could not load the latest weather.',
    'weatherWidget.retryCta': 'Retry',
};

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'en',
        setLanguage: vi.fn(),
        t: (k: string): string => STRINGS[k] ?? k,
    }),
}));

afterEach(cleanup);

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
});
