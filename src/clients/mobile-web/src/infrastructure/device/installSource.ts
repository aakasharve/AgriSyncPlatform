/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 fix pass (founder D-53) — which app installed this installed app, from the app-local
 * native plugin `InstallSource` (android/app/src/main/java/com/agrisync/shramsafal/InstallSourcePlugin.java).
 *
 * `com.android.vending` = Google Play. Anything else, or null (no installer recorded: adb, some file
 * managers), = a downloaded APK. Throws when the plugin is missing (an app built before it existed,
 * or a browser) or fails; the caller logs that and treats it as a downloaded APK.
 */
import { registerPlugin } from '@capacitor/core';

export const PLAY_STORE_INSTALLER = 'com.android.vending';

export interface InstallSourcePlugin {
    getInstaller(): Promise<{ installer?: string | null }>;
}

const InstallSource = registerPlugin<InstallSourcePlugin>('InstallSource');

/** The installing app's package name, or null when Android recorded none. */
export async function readInstaller(plugin: InstallSourcePlugin = InstallSource): Promise<string | null> {
    const { installer } = await plugin.getInstaller();
    return typeof installer === 'string' && installer.length > 0 ? installer : null;
}
