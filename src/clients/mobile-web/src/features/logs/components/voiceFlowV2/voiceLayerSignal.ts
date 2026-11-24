/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F2) - "that process must occupy the entire screen". While the voice flow's full-screen layer
 * (`VoiceLayer`) is open the app's own chrome (farm header, the three tabs, the approval chips, the bottom bar) steps away:
 * `AppContent` reads this and draws none of it. A plain counter (two layers may overlap for one frame while one replaces the other).
 */
import { useSyncExternalStore } from 'react';

let open = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(l => l());

/** A layer opened; returns the function that tells it closed. */
export const enterVoiceLayer = (): (() => void) => {
    open += 1;
    emit();
    let done = false;
    return () => {
        if (done) return;
        done = true;
        open = Math.max(0, open - 1);
        emit();
    };
};

const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const read = (): boolean => open > 0;

/** True while a voice full-screen layer is on screen. */
export const useVoiceLayerOpen = (): boolean => useSyncExternalStore(subscribe, read, () => false);
