// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - founder change note of 2026-11-19: `?view=reflect` opens the whole-farm overview.
 */
import { describe, expect, it } from 'vitest';
import { initialViewFromSearch } from '../initialViewFromSearch';
import { readNavigationInputFromLocation } from '../navigationMachine';

describe('initialViewFromSearch', () => {
    it('opens the whole-farm overview for ?view=reflect and the compare tab for ?view=compare', () => {
        expect(initialViewFromSearch('?view=reflect')).toBe('reflect');
        expect(initialViewFromSearch('?view=compare')).toBe('compare');
        expect(initialViewFromSearch('?route=main&view=reflect')).toBe('reflect');
    });

    it('is the log page with no view, an empty query, or a view it does not know', () => {
        expect(initialViewFromSearch('')).toBe('log');
        expect(initialViewFromSearch('?view=log')).toBe('log');
        expect(initialViewFromSearch('?view=schedule')).toBe('log');
        expect(initialViewFromSearch('?view=')).toBe('log');
        expect(initialViewFromSearch('?view=REFLECT')).toBe('log');
        expect(initialViewFromSearch('?route=schedule')).toBe('log');
    });

    it('the navigation machine reads it from the address too', () => {
        const original = window.location.href;
        window.history.pushState({}, '', '/?view=reflect');
        try {
            expect(readNavigationInputFromLocation().initialView).toBe('reflect');
        } finally {
            window.history.pushState({}, '', original);
        }
    });
});
