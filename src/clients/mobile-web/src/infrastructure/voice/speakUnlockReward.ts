/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * speakUnlockReward — Task 8 (spec: dfes-companion-2026-07-11). Sathi speaks
 * ONE short warm Marathi line, once ever per farm, when the farmer reaches
 * the 25-rich-days unlock. Web `window.speechSynthesis` ONLY — no
 * `@capacitor-community/text-to-speech` native dependency (that route is a
 * deferred founder-gated option). Pure side-effect function, no React.
 *
 * Guarded so this is a clean no-op on any unsupported device: no throw,
 * no block. `mr-IN` voice availability is device-dependent on cheap
 * Android — when no Marathi voice is installed the OS either substitutes
 * a nearby voice or stays silent; both are an acceptable graceful degrade
 * for a reward line (never a required-to-understand instruction).
 * Deliberately does NOT wait on `getVoices()` (it's async and empty on
 * first call on some engines) — setting `lang` and letting the engine
 * pick keeps this simple and avoids blocking the caller.
 */
export function speakUnlockReward(marathiLine: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
    }
    try {
        const utterance = new SpeechSynthesisUtterance(marathiLine);
        utterance.lang = 'mr-IN';
        utterance.rate = 0.95; // gentle, warm pace
        window.speechSynthesis.speak(utterance);
    } catch {
        // Swallow — never throw, never block the caller on any engine quirk.
    }
}
