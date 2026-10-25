// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves — the app's own navigation history,
// which the Android hardware Back button walks backwards.
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppNavigation } from '../useAppNavigation';

describe('useAppNavigation — goBack history', () => {
    it('Home -> Setup Hub -> Settings, Back twice returns Settings -> Setup Hub -> Home', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setCurrentRoute('profile'));
        act(() => result.current.setCurrentRoute('settings'));
        expect(result.current.currentRoute).toBe('settings');

        let handled = false;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(true);
        expect(result.current.currentRoute).toBe('profile');

        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(true);
        expect(result.current.currentRoute).toBe('main');
    });

    it('returns false at the root so the caller can exit', () => {
        const { result } = renderHook(() => useAppNavigation());
        let handled = true;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(false);
        expect(result.current.currentRoute).toBe('main');
    });

    it('a page with no recorded predecessor goes Home, not out of the app', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setCurrentRoute('voiceDiary'));
        let handled = false;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(true);
        expect(result.current.currentRoute).toBe('main');
    });

    it('tapping Home clears history so Back from Home does not bounce into old pages', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setCurrentRoute('profile'));
        act(() => result.current.setCurrentRoute('settings'));
        act(() => result.current.setCurrentRoute('main'));
        let handled = true;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(false);
    });

    it('navigating explicitly to the page you came from does not grow a ping-pong history', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setCurrentRoute('profile'));
        act(() => result.current.setCurrentRoute('settings'));
        act(() => result.current.setCurrentRoute('profile')); // in-page "back to hub" button
        act(() => { result.current.goBack(); });
        expect(result.current.currentRoute).toBe('main');
    });

    // spec: plr-d10-redesign-real-integration-2026-10-25 (WP-6) — a screen's OWN back button.
    it('goBackOr returns to where he came from, not to the screen\'s fixed parent', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setCurrentRoute('attention'));
        act(() => result.current.setCurrentRoute('finance-ledger'));
        act(() => result.current.goBackOr('finance-manager'));
        expect(result.current.currentRoute).toBe('attention');
    });

    it('goBackOr goes to the given parent when there is nowhere he came from', () => {
        // A deep link opens the screen with no history behind it.
        window.history.replaceState({}, '', '/?route=finance-ledger');
        try {
            const { result } = renderHook(() => useAppNavigation());
            expect(result.current.currentRoute).toBe('finance-ledger');
            act(() => result.current.goBackOr('finance-manager'));
            expect(result.current.currentRoute).toBe('finance-manager');
        } finally {
            window.history.replaceState({}, '', '/');
        }
    });

    it('from the Reflect tab Back returns to the log tab first, still inside the app', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setMainView('reflect'));
        let handled = false;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(true);
        expect(result.current.mainView).toBe('log');
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(false);
    });
});
