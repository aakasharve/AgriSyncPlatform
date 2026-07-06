// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeatherFallbackCard from '../WeatherFallbackCard';

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

describe('WeatherFallbackCard', () => {
    it('no-location: shows title + CTA and fires onAction', () => {
        const onAction = vi.fn();
        render(<WeatherFallbackCard variant="no-location" onAction={onAction} />);
        expect(screen.getByText('Add your farm location to see weather')).toBeInTheDocument();
        screen.getByRole('button', { name: 'Set farm location' }).click();
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('error: shows title + Retry and fires onAction', () => {
        const onAction = vi.fn();
        render(<WeatherFallbackCard variant="error" onAction={onAction} />);
        expect(screen.getByText('Weather unavailable right now')).toBeInTheDocument();
        screen.getByRole('button', { name: 'Retry' }).click();
        expect(onAction).toHaveBeenCalledTimes(1);
    });
});
