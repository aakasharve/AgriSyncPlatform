// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 (spec: dfes-companion-2026-07-11) — locks in the web no-op
 * guarantee (flag-off / non-native ⇒ zero side effects) and the native
 * schedule shape (hour 7:00, daily repeat, `/?nudge=open-today` extra).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const isNativePlatform = vi.fn();
const requestPermissions = vi.fn();
const cancel = vi.fn();
const schedule = vi.fn();
const addListener = vi.fn();

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));
vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: {
        requestPermissions: () => requestPermissions(),
        cancel: (o: unknown) => cancel(o),
        schedule: (o: unknown) => schedule(o),
        addListener: (event: string, fn: (a: unknown) => void) => addListener(event, fn),
    },
}));

import { NativeNotificationService } from '../NativeNotificationService';

describe('NativeNotificationService — web (no-op)', () => {
    beforeEach(() => {
        isNativePlatform.mockReturnValue(false);
        requestPermissions.mockReset();
        cancel.mockReset();
        schedule.mockReset();
        addListener.mockReset();
    });

    it('requestPermission resolves false and never calls the plugin', async () => {
        const svc = new NativeNotificationService();
        const granted = await svc.requestPermission();
        expect(granted).toBe(false);
        expect(requestPermissions).not.toHaveBeenCalled();
    });

    it('scheduleDailyMorning is a no-op', async () => {
        const svc = new NativeNotificationService();
        await svc.scheduleDailyMorning('आजची कामे पाहा');
        expect(cancel).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });

    it('cancelDailyMorning is a no-op', async () => {
        const svc = new NativeNotificationService();
        await svc.cancelDailyMorning();
        expect(cancel).not.toHaveBeenCalled();
    });

    it('registerTapHandler never registers a listener', () => {
        const svc = new NativeNotificationService();
        const navigate = vi.fn();
        svc.registerTapHandler(navigate);
        expect(addListener).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});

describe('NativeNotificationService — native', () => {
    beforeEach(() => {
        isNativePlatform.mockReturnValue(true);
        requestPermissions.mockReset().mockResolvedValue({ display: 'granted' });
        cancel.mockReset().mockResolvedValue(undefined);
        schedule.mockReset().mockResolvedValue({ notifications: [] });
        addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
    });

    it('requestPermission resolves true when the plugin grants', async () => {
        const svc = new NativeNotificationService();
        const granted = await svc.requestPermission();
        expect(granted).toBe(true);
        expect(requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('requestPermission resolves false when the plugin denies', async () => {
        requestPermissions.mockResolvedValue({ display: 'denied' });
        const svc = new NativeNotificationService();
        expect(await svc.requestPermission()).toBe(false);
    });

    it('requestPermission swallows a plugin rejection and resolves false', async () => {
        requestPermissions.mockRejectedValue(new Error('boom'));
        const svc = new NativeNotificationService();
        await expect(svc.requestPermission()).resolves.toBe(false);
    });

    it('scheduleDailyMorning cancels the fixed id then schedules a 7am daily repeat with the open-today extra', async () => {
        const svc = new NativeNotificationService();
        await svc.scheduleDailyMorning('आजची कामे पाहा');

        expect(cancel).toHaveBeenCalledWith(
            expect.objectContaining({ notifications: [expect.objectContaining({ id: expect.any(Number) })] }),
        );
        expect(schedule).toHaveBeenCalledWith(
            expect.objectContaining({
                notifications: [
                    expect.objectContaining({
                        title: 'आजची कामे पाहा',
                        schedule: expect.objectContaining({
                            on: { hour: 7, minute: 0 },
                            repeats: true,
                            allowWhileIdle: true,
                        }),
                        extra: { url: '/?nudge=open-today' },
                    }),
                ],
            }),
        );

        // The cancel + schedule ids must match — same fixed id, idempotent reschedule.
        const cancelId = cancel.mock.calls[0][0].notifications[0].id;
        const scheduleId = schedule.mock.calls[0][0].notifications[0].id;
        expect(scheduleId).toBe(cancelId);
    });

    it('scheduleDailyMorning swallows a schedule rejection without throwing', async () => {
        schedule.mockRejectedValue(new Error('boom'));
        const svc = new NativeNotificationService();
        await expect(svc.scheduleDailyMorning('आजची कामे पाहा')).resolves.toBeUndefined();
    });

    it('cancelDailyMorning cancels the fixed id', async () => {
        const svc = new NativeNotificationService();
        await svc.cancelDailyMorning();
        expect(cancel).toHaveBeenCalledWith(
            expect.objectContaining({ notifications: [expect.objectContaining({ id: expect.any(Number) })] }),
        );
    });

    it('registerTapHandler routes a tap to /?nudge=open-today via the caller-supplied navigate', () => {
        let tapListener: (() => void) | undefined;
        addListener.mockImplementation((_event: string, fn: () => void) => {
            tapListener = fn;
            return Promise.resolve({ remove: vi.fn() });
        });

        const svc = new NativeNotificationService();
        const navigate = vi.fn();
        svc.registerTapHandler(navigate);

        expect(addListener).toHaveBeenCalledWith('localNotificationActionPerformed', expect.any(Function));
        tapListener?.();
        expect(navigate).toHaveBeenCalledWith('/?nudge=open-today');
    });
});
