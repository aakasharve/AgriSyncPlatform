// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H19/H20; PLR-D9 N3, N6) — the bottom bar and
// the header's सेट-अप केंद्र open a PLACE: it sits on the home tabs (its मागे returns to the tab he was
// on), and tapping the place he is already in takes it back to its first screen.
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppNavigation } from '../useAppNavigation';

describe('useAppNavigation — openPlace (bottom bar / सेट-अप केंद्र)', () => {
    it('tapping the place he is already in asks for its first screen (the reset key moves) and keeps him there', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('profile'));
        expect(result.current.currentRoute).toBe('profile');
        const before = result.current.placeResetKey;

        act(() => result.current.openPlace('profile'));
        expect(result.current.currentRoute).toBe('profile');
        expect(result.current.placeResetKey).toBe(before + 1);

        // and its मागे still goes home, not back into the same place
        act(() => result.current.goBackOr('main'));
        expect(result.current.currentRoute).toBe('main');
    });

    it('an in-page link to the same route is NOT a reset (only the bar and the header ask for one)', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('procurement'));
        const before = result.current.placeResetKey;
        act(() => result.current.setCurrentRoute('procurement'));
        expect(result.current.placeResetKey).toBe(before);
    });

    it('a place opened from the bar sits on the home tabs: मागे returns to the tab he was on, not the place before', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.setMainView('reflect'));
        act(() => result.current.openPlace('procurement'));
        act(() => result.current.openPlace('income'));
        act(() => result.current.goBackOr('main'));
        expect(result.current.currentRoute).toBe('main');
        expect(result.current.mainView).toBe('reflect');
    });

    it('सेट-अप केंद्र tapped from deep inside its pages opens the hub fresh, and its मागे then goes home', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('profile'));
        act(() => result.current.setCurrentRoute('finance-manager'));
        act(() => result.current.setCurrentRoute('finance-ledger'));
        act(() => result.current.openPlace('profile'));
        expect(result.current.currentRoute).toBe('profile');
        act(() => result.current.goBackOr('main'));
        expect(result.current.currentRoute).toBe('main');
    });

    it('pages opened from inside a place still go back to it (in-page links keep the history)', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('profile'));
        act(() => result.current.setCurrentRoute('labour'));
        act(() => result.current.goBackOr('profile'));
        expect(result.current.currentRoute).toBe('profile');
    });

    // H19 — "back returns exactly where you came from" across हजेरी's mic hop: hub → हजेरी → "बोलून हजेरी"
    // (the log page) → saved → back on हजेरी. Its मागे used to land on the log page (the hop cleared the
    // history); it now returns to the hub he opened हजेरी from, and the hub's मागे then goes home.
    it('हजेरी\'s मागे after the "बोलून हजेरी" round trip returns to the hub, not the log page', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('profile'));
        act(() => result.current.setCurrentRoute('labour'));
        act(() => result.current.setCurrentRoute('main')); // the mic hop (onGoToLog)
        act(() => result.current.setCurrentRoute('labour')); // the save's automatic return
        act(() => result.current.goBackOr('profile'));
        expect(result.current.currentRoute).toBe('profile');
        act(() => result.current.goBackOr('main'));
        expect(result.current.currentRoute).toBe('main');
    });

    it('the round trip is remembered for ONE hop only: leaving the log page elsewhere forgets it', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('profile'));
        act(() => result.current.setCurrentRoute('labour'));
        act(() => result.current.setCurrentRoute('main'));
        // from the log page he goes somewhere else instead, and later reaches हजेरी from there
        act(() => result.current.setCurrentRoute('schedule'));
        act(() => result.current.setCurrentRoute('labour'));
        act(() => result.current.goBackOr('profile'));
        expect(result.current.currentRoute).toBe('schedule');
    });

    it('re-tapping on the home tabs changes nothing', () => {
        const { result } = renderHook(() => useAppNavigation());
        const before = result.current.placeResetKey;
        act(() => result.current.openPlace('main'));
        expect(result.current.currentRoute).toBe('main');
        expect(result.current.placeResetKey).toBe(before);
    });

    it('the hardware Back from a bar place lands on the home tab, still inside the app', () => {
        const { result } = renderHook(() => useAppNavigation());
        act(() => result.current.openPlace('tests'));
        act(() => result.current.openPlace('schedule'));
        let handled = false;
        act(() => { handled = result.current.goBack(); });
        expect(handled).toBe(true);
        expect(result.current.currentRoute).toBe('main');
    });
});
