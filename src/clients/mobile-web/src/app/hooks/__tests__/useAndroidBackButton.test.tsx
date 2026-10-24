// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves — Android hardware Back button.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
    native: true,
    cb: null as null | (() => void),
    remove: vi.fn(async () => {}),
    addListener: vi.fn(),
    exitApp: vi.fn(async () => {}),
    minimizeApp: vi.fn(async () => {}),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => h.native },
}));
vi.mock('@capacitor/app', () => ({
    App: {
        addListener: (...args: unknown[]) => h.addListener(...args),
        exitApp: () => h.exitApp(),
        minimizeApp: () => h.minimizeApp(),
    },
}));

import { useAndroidBackButton } from '../useAndroidBackButton';
import { useAppNavigation } from '../useAppNavigation';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { __resetBackStackForTests } from '../../../core/navigation/backStack';

let nav: ReturnType<typeof useAppNavigation>;
let busy = false;

const Harness: React.FC<{ sheetOpen?: boolean; onSheetClose?: () => void }> = ({ sheetOpen = false, onSheetClose = () => {} }) => {
    nav = useAppNavigation();
    useBackDismiss(sheetOpen, onSheetClose);
    useAndroidBackButton({ goBack: nav.goBack, isBusy: () => busy });
    return null;
};

const flush = () => act(async () => { await Promise.resolve(); });
const pressBack = async () => { await act(async () => { h.cb?.(); await Promise.resolve(); }); };

describe('useAndroidBackButton', () => {
    beforeEach(() => {
        __resetBackStackForTests();
        h.native = true;
        h.cb = null;
        busy = false;
        h.exitApp.mockClear();
        h.minimizeApp.mockClear();
        h.remove.mockClear();
        h.addListener.mockReset();
        h.addListener.mockImplementation(async (_evt: string, cb: () => void) => {
            h.cb = cb;
            return { remove: h.remove };
        });
    });

    it('Back from Settings -> Setup Hub -> Home, then exits at the root', async () => {
        render(<Harness />);
        await flush();
        expect(h.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));

        act(() => nav.setCurrentRoute('profile'));
        act(() => nav.setCurrentRoute('settings'));

        await pressBack();
        expect(nav.currentRoute).toBe('profile');
        await pressBack();
        expect(nav.currentRoute).toBe('main');
        expect(h.exitApp).not.toHaveBeenCalled();

        await pressBack();
        expect(h.exitApp).toHaveBeenCalledTimes(1);
    });

    it('Back from Voice Diary goes to the previous screen, not out of the app', async () => {
        render(<Harness />);
        await flush();
        act(() => nav.setCurrentRoute('voiceDiary'));
        await pressBack();
        expect(nav.currentRoute).toBe('main');
        expect(h.exitApp).not.toHaveBeenCalled();
    });

    it('closes an open overlay first and leaves the screen where it is', async () => {
        const close = vi.fn();
        render(<Harness sheetOpen onSheetClose={close} />);
        await flush();
        act(() => nav.setCurrentRoute('settings'));

        await pressBack();
        expect(close).toHaveBeenCalledTimes(1);
        expect(nav.currentRoute).toBe('settings');
        expect(h.exitApp).not.toHaveBeenCalled();
    });

    it('does not exit the app while a capture is in flight; it minimizes instead', async () => {
        render(<Harness />);
        await flush();
        busy = true;
        await pressBack();
        expect(h.exitApp).not.toHaveBeenCalled();
        expect(h.minimizeApp).toHaveBeenCalledTimes(1);
    });

    it('registers nothing on web (non-native) and never touches the App plugin', async () => {
        h.native = false;
        render(<Harness />);
        await flush();
        expect(h.addListener).not.toHaveBeenCalled();
    });

    it('removes the native listener on unmount', async () => {
        const { unmount } = render(<Harness />);
        await flush();
        unmount();
        await flush();
        expect(h.remove).toHaveBeenCalledTimes(1);
    });
});
