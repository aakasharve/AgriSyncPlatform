// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H08) — the आजची कामे tab tap: back to the
 * work home from the entry flow AND from the saved card (I12-V1-m2), never over an unsaved review or a
 * parse; and the header handler really raises the navigation's request (I12-V1-m4).
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
    handleWorkTabViewChange, opensWorkHomeOnTabTap, useWorkTabViewChange, workTabTapAction, type WorkTabState,
} from '../workHomeRequest';
import { useAppNavigation } from '../../../../../app/hooks/useAppNavigation';
import type { InputMode, PageView } from '../../../../../domain/types/farm.types';

describe('workTabTapAction', () => {
    it('home on the entry flow (home, crop, plots + mic)', () => {
        expect(workTabTapAction({ mode: 'voice', hasActiveLogContext: false, status: 'idle' })).toBe('home');
        expect(workTabTapAction({ mode: 'voice', hasActiveLogContext: true, status: 'idle' })).toBe('home');
        expect(workTabTapAction({ mode: 'manual', hasActiveLogContext: false, status: 'idle' })).toBe('home');
    });

    it('the saved card closes and the home opens — the entry is already saved, nothing is lost', () => {
        expect(workTabTapAction({ mode: 'manual', hasActiveLogContext: true, status: 'success' })).toBe('close-saved-then-home');
        expect(opensWorkHomeOnTabTap({ mode: 'manual', hasActiveLogContext: true, status: 'success' })).toBe(true);
    });

    it('stays over the review form of a parsed entry and over a parse in progress', () => {
        expect(workTabTapAction({ mode: 'manual', hasActiveLogContext: true, status: 'idle' })).toBe('stay');
        expect(workTabTapAction({ mode: 'voice', hasActiveLogContext: true, status: 'processing' })).toBe('stay');
        expect(workTabTapAction({ mode: 'voice', hasActiveLogContext: true, status: 'recording' })).toBe('stay');
        expect(opensWorkHomeOnTabTap({ mode: 'manual', hasActiveLogContext: true, status: 'idle' })).toBe(false);
    });
});

const deps = () => ({ setMainView: vi.fn(), requestLogHome: vi.fn(), resetSaved: vi.fn(), setMode: vi.fn() });

describe('handleWorkTabViewChange — the header page switcher', () => {
    it('another page card just switches the page', () => {
        const d = deps();
        handleWorkTabViewChange('reflect', { mode: 'voice', hasActiveLogContext: false, status: 'idle' }, d);
        expect(d.setMainView).toHaveBeenCalledWith('reflect');
        expect(d.requestLogHome).not.toHaveBeenCalled();
    });

    it('the आजची कामे card from the saved card: the same reset as "आणखी नोंद करा", then the home', () => {
        const d = deps();
        handleWorkTabViewChange('log', { mode: 'manual', hasActiveLogContext: true, status: 'success' }, d);
        expect(d.resetSaved).toHaveBeenCalledTimes(1);
        expect(d.setMode).toHaveBeenCalledWith('voice');
        expect(d.requestLogHome).toHaveBeenCalledTimes(1);
        expect(d.setMainView).toHaveBeenCalledWith('log');
    });

    it('the आजची कामे card over the review: nothing is reset, no home request', () => {
        const d = deps();
        handleWorkTabViewChange('log', { mode: 'manual', hasActiveLogContext: true, status: 'idle' }, d);
        expect(d.resetSaved).not.toHaveBeenCalled();
        expect(d.requestLogHome).not.toHaveBeenCalled();
        expect(d.setMainView).toHaveBeenCalledWith('log');
    });
});

describe('the wiring: the header handler raises the REAL navigation\'s work-home request', () => {
    const useWired = (state: WorkTabState) => {
        const navigation = useAppNavigation();
        const resetSaved = vi.fn();
        const setMode = vi.fn() as unknown as (mode: InputMode) => void;
        const onViewChange = useWorkTabViewChange(state, {
            setMainView: navigation.setMainView, requestLogHome: navigation.requestLogHome, resetSaved, setMode,
        });
        return { navigation, onViewChange };
    };

    it('from another tab, a tap on आजची कामे opens the log page AND asks for its home', () => {
        const { result } = renderHook(() => useWired({ mode: 'voice', hasActiveLogContext: true, status: 'idle' }));
        act(() => result.current.navigation.setMainView('reflect' as PageView));
        expect(result.current.navigation.logHomePending).toBe(false);
        act(() => result.current.onViewChange('log'));
        expect(result.current.navigation.mainView).toBe('log');
        expect(result.current.navigation.logHomePending).toBe(true);
        act(() => result.current.navigation.consumeLogHome());
        expect(result.current.navigation.logHomePending).toBe(false);
    });

    it('over the review the page stays and no request is raised', () => {
        const { result } = renderHook(() => useWired({ mode: 'manual', hasActiveLogContext: true, status: 'idle' }));
        act(() => result.current.onViewChange('log'));
        expect(result.current.navigation.logHomePending).toBe(false);
    });
});
