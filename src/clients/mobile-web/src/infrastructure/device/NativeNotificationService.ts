import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Task 7 (spec: dfes-companion-2026-07-11) — daily 7am "आजची कामे पाहा"
 * (see today's tasks) native local notification.
 *
 * Mirrors `DeviceSpeechRecognizer`'s `if (!Capacitor.isNativePlatform())
 * return <no-op>` guard: every method is a genuine no-op on web (no
 * permission prompt, no schedule, no listener). Gated behind
 * `FEATURE_FLAGS.morningNotification` (default OFF) by the caller — this
 * class itself has no flag awareness, it just does nothing on web.
 *
 * Reuses the existing `/?nudge=open-today` deep-link convention already
 * used by the web Notification-API morning nudge in
 * `shared/services/NotificationService.ts` — tapping the notification does
 * not invent a new routing path, it lets `useNudgeRouteEffect`'s existing
 * 'open-today' handling do the routing once the app (re)opens at that URL.
 *
 * Static title only (no dynamic pending-task count): `pendingCount` isn't
 * persisted across app closes, so a stale number baked into a notification
 * scheduled hours/days in advance would be worse than no number at all.
 *
 * Every native call is wrapped so a plugin failure can never break the
 * app — mirrors `App.tsx`'s native-bars `.catch(() => undefined)` house
 * style.
 */

/**
 * Fixed id so re-scheduling (e.g. on every app boot) is idempotent:
 * cancel + reschedule the SAME notification, never a growing pile of
 * duplicates.
 */
const MORNING_NOTIFICATION_ID = 700001;

/** Reused nudge convention — see useNudgeRouteEffect.ts / NotificationService.ts. */
const OPEN_TODAY_URL = '/?nudge=open-today';

export class NativeNotificationService {
    /** Requests OS notification permission. No-op (`false`) on web. */
    async requestPermission(): Promise<boolean> {
        if (!Capacitor.isNativePlatform()) {
            return false;
        }
        try {
            const status = await LocalNotifications.requestPermissions();
            return status.display === 'granted';
        } catch {
            return false;
        }
    }

    /**
     * Cancels any prior morning notification (same fixed id) then schedules
     * the daily 7am repeat. No-op on web.
     */
    async scheduleDailyMorning(titleMr: string): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            return;
        }
        await LocalNotifications.cancel({
            notifications: [{ id: MORNING_NOTIFICATION_ID }],
        }).catch(() => undefined);

        await LocalNotifications.schedule({
            notifications: [
                {
                    id: MORNING_NOTIFICATION_ID,
                    title: titleMr,
                    body: '',
                    schedule: {
                        on: { hour: 7, minute: 0 },
                        repeats: true,
                        allowWhileIdle: true,
                    },
                    extra: { url: OPEN_TODAY_URL },
                },
            ],
        }).catch(() => undefined);
    }

    /** Cancels the scheduled morning notification, if any. No-op on web. */
    async cancelDailyMorning(): Promise<void> {
        if (!Capacitor.isNativePlatform()) {
            return;
        }
        await LocalNotifications.cancel({
            notifications: [{ id: MORNING_NOTIFICATION_ID }],
        }).catch(() => undefined);
    }

    /**
     * Registers the notification-tap listener. On tap, hands the
     * `/?nudge=open-today` URL to the caller's `navigate` (e.g.
     * `(url) => { window.location.href = url; }`) so the existing nudge
     * machinery routes it — no new routing path. No-op on web.
     *
     * Returns the `PluginListenerHandle` (or `null` on web / on a plugin
     * failure) so the caller can `handle?.remove()` on effect cleanup —
     * otherwise re-running the registering effect (language toggle,
     * logout/login, dev double-invoke) stacks a new listener on every run.
     */
    async registerTapHandler(navigate: (url: string) => void): Promise<PluginListenerHandle | null> {
        if (!Capacitor.isNativePlatform()) {
            return null;
        }
        return LocalNotifications.addListener('localNotificationActionPerformed', () => {
            navigate(OPEN_TODAY_URL);
        }).catch(() => null);
    }
}
