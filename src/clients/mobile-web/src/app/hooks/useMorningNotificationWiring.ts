/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 (spec: dfes-companion-2026-07-11) — boot wiring for the daily 7am
 * "आजची कामे पाहा" native local notification. Extracted out of App.tsx's
 * `AppFrame` (mirrors the existing `useCapacitorKeyboard` extraction
 * convention) so the flag-off / not-authenticated no-op paths are unit
 * testable in isolation.
 *
 * `FEATURE_FLAGS.morningNotification` gates EVERYTHING below: when it is
 * OFF (the default), the effect returns before any
 * `NativeNotificationService` call runs — no permission prompt, no
 * schedule, no listener. `NativeNotificationService` itself additionally
 * no-ops on non-native platforms, so a web build is unaffected even with
 * the flag on.
 */
import React from 'react';
import { FEATURE_FLAGS } from '../featureFlags';
import { NativeNotificationService } from '../../infrastructure/device/NativeNotificationService';

const defaultNativeNotificationService = new NativeNotificationService();

export function useMorningNotificationWiring(
    isAuthenticated: boolean,
    titleMr: string,
    service: NativeNotificationService = defaultNativeNotificationService,
): void {
    React.useEffect(() => {
        if (!FEATURE_FLAGS.morningNotification || !isAuthenticated) {
            return;
        }

        void (async () => {
            const granted = await service.requestPermission();
            if (!granted) {
                return;
            }
            await service.scheduleDailyMorning(titleMr);
        })();

        // Reuses the existing `/?nudge=open-today` convention — a full
        // location change so the SPA re-mounts and useNudgeRouteEffect's
        // existing 'open-today' handling routes it. No new routing path.
        service.registerTapHandler((url) => {
            window.location.href = url;
        });
    }, [isAuthenticated, titleMr, service]);
}
