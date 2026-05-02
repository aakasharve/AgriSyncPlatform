/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppContent.tsx.
 *
 * Tracks Capacitor's keyboardDidShow/keyboardDidHide events. No-op on
 * non-native platforms (web in browser).
 */

import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

export function useCapacitorKeyboard(): boolean {
    const [isKeyboardOpen, setIsKeyboardOpen] = React.useState(false);

    React.useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        let showListener: { remove: () => Promise<void> } | undefined;
        let hideListener: { remove: () => Promise<void> } | undefined;

        const registerKeyboardListeners = async () => {
            showListener = await Keyboard.addListener('keyboardDidShow', () => setIsKeyboardOpen(true));
            hideListener = await Keyboard.addListener('keyboardDidHide', () => setIsKeyboardOpen(false));
        };

        void registerKeyboardListeners();

        return () => {
            setIsKeyboardOpen(false);
            void showListener?.remove();
            void hideListener?.remove();
        };
    }, []);

    return isKeyboardOpen;
}
