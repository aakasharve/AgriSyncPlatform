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
