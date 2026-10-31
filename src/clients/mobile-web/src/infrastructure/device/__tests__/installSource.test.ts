/**
 * Lane UPD-1 fix pass — reading the native `InstallSource` plugin's answer (plugin mocked).
 */
import { describe, expect, it } from 'vitest';
import { PLAY_STORE_INSTALLER, readInstaller, type InstallSourcePlugin } from '../installSource';

const plugin = (answer: () => Promise<{ installer?: string | null }>): InstallSourcePlugin => ({ getInstaller: answer });

describe('readInstaller (UPD-1)', () => {
    it('passes the installing package through', async () => {
        expect(PLAY_STORE_INSTALLER).toBe('com.android.vending');
        await expect(readInstaller(plugin(() => Promise.resolve({ installer: 'com.android.vending' })))).resolves.toBe('com.android.vending');
        await expect(readInstaller(plugin(() => Promise.resolve({ installer: 'com.android.chrome' })))).resolves.toBe('com.android.chrome');
    });

    it('nothing recorded (null, empty, absent) is null', async () => {
        await expect(readInstaller(plugin(() => Promise.resolve({ installer: null })))).resolves.toBeNull();
        await expect(readInstaller(plugin(() => Promise.resolve({ installer: '' })))).resolves.toBeNull();
        await expect(readInstaller(plugin(() => Promise.resolve({})))).resolves.toBeNull();
    });

    it('a plugin failure reaches the caller (which logs it and opens the APK page)', async () => {
        await expect(readInstaller(plugin(() => Promise.reject(new Error('Could not read which app installed ShramSafal')))))
            .rejects.toThrow('Could not read');
    });

    it('outside a native shell the real plugin is not implemented, and says so', async () => {
        await expect(readInstaller()).rejects.toBeTruthy();
    });
});
