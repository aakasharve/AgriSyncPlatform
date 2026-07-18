// spec: 2026-07-13-labour-attendance-approval-design (Task 3.4)
//
// `logIntent` carries a one-shot "why am I on the log page" hint from the
// labour feature into the log page. Covers the three behaviours that matter:
//   1. default is null (today's only behaviour, unchanged for direct visits)
//   2. setLogIntent('labour') exposes it
//   3. it is cleared the moment the route changes away from 'main', so it
//      never leaks into an unrelated later visit to the log page.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppNavigation } from '../useAppNavigation';

describe('useAppNavigation — logIntent', () => {
    it('defaults to null', () => {
        const { result } = renderHook(() => useAppNavigation());
        expect(result.current.logIntent).toBeNull();
    });

    it('exposes the intent once set', () => {
        const { result } = renderHook(() => useAppNavigation());

        act(() => result.current.setLogIntent('labour'));

        expect(result.current.logIntent).toBe('labour');
    });

    it('stays set across a setCurrentRoute("main") call (the labour -> log hop)', () => {
        const { result } = renderHook(() => useAppNavigation());

        act(() => {
            result.current.setLogIntent('labour');
            result.current.setCurrentRoute('main');
        });

        expect(result.current.currentRoute).toBe('main');
        expect(result.current.logIntent).toBe('labour');
    });

    it('clears the moment the route changes away from main', () => {
        const { result } = renderHook(() => useAppNavigation());

        act(() => {
            result.current.setLogIntent('labour');
            result.current.setCurrentRoute('main');
        });
        expect(result.current.logIntent).toBe('labour');

        act(() => result.current.setCurrentRoute('profile'));

        expect(result.current.logIntent).toBeNull();
    });

    it('does not resurrect on a later, unrelated return to main', () => {
        const { result } = renderHook(() => useAppNavigation());

        act(() => {
            result.current.setLogIntent('labour');
            result.current.setCurrentRoute('main');
        });
        act(() => result.current.setCurrentRoute('profile'));
        act(() => result.current.setCurrentRoute('main'));

        expect(result.current.logIntent).toBeNull();
    });

    it('clears on explicit dismiss without needing a route change', () => {
        const { result } = renderHook(() => useAppNavigation());

        act(() => result.current.setLogIntent('labour'));
        act(() => result.current.setLogIntent(null));

        expect(result.current.logIntent).toBeNull();
    });
});
