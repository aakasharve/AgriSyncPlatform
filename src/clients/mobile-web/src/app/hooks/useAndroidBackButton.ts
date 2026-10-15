// spec: 2026-08-25-prod-cutover-waves
//
// Android hardware Back. The WebView has no history of its own (the app is
// state-driven), so without a handler Back left the app from Settings. Order:
//   1. close the topmost open overlay (core/navigation/backStack)
//   2. walk the app's own history (useAppNavigation.goBack)
//   3. at the root: exit — unless a capture is recording/processing, in which
//      case move the app to the background so no in-flight work is destroyed.
// Native only. Nothing here touches queued/synced data.

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { dismissTopOverlay } from '../../core/navigation/backStack';

interface Options {
    /** Returns true if it moved somewhere inside the app, false at the root. */
    goBack: () => boolean;
    /** True while leaving would destroy work in progress (recording path). */
    isBusy: () => boolean;
}

export function useAndroidBackButton({ goBack, isBusy }: Options): void {
    const latest = useRef({ goBack, isBusy });
    latest.current = { goBack, isBusy };

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        let cancelled = false;
        let remove: (() => Promise<void>) | undefined;

        void App.addListener('backButton', () => {
            if (dismissTopOverlay()) return;
            if (latest.current.goBack()) return;
            if (latest.current.isBusy()) {
                void App.minimizeApp();
                return;
            }
            void App.exitApp();
        }).then(handle => {
            if (cancelled) void handle.remove();
            else remove = () => handle.remove();
        });

        return () => {
            cancelled = true;
            void remove?.();
        };
    }, []);
}
