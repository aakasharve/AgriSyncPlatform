/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-2, register F71) — the entry a "बदला" correction is
 * about, sent with the parse so "X नाही, Y" is understood as "X becomes Y" in that entry.
 *
 * Live 2026-10-31: "इथरेल 350 नाही, 400 मिली" was parsed like a new day's words and came back as a note, the dose
 * unchanged. The parse knew nothing of the entry. Now, while a correction is being spoken, the app supplies that
 * entry's current parts (`setCorrectionParseContext`; the ONE mic's speak state decides) and `BackendAiClient` puts
 * them in the parse context it already sends, as `correctionOf` — additive and optional: a server or an older app
 * that does not know the field is unaffected, and every other parse is sent exactly as before.
 *
 * Like `offlineVoiceQueue`, this is a seam with no knowledge of screens: infrastructure never imports the app.
 */

/** The entry's parts, in the parse's own bucket shape ({ inputs: [...], irrigation: [...], ... }). */
export type CorrectionEntryParts = Record<string, unknown>;

let supply: () => CorrectionEntryParts | null = () => null;

/** The app says which entry words spoken now are a correction of (`null`: they are not). */
export function setCorrectionParseContext(supplier: () => CorrectionEntryParts | null): void {
    supply = supplier;
}

/** The entry being corrected right now, or `null`. A failing supplier never blocks a parse: it is a normal one then. */
export function correctionParseContext(): CorrectionEntryParts | null {
    try {
        const parts = supply();
        return parts && typeof parts === 'object' && Object.keys(parts).length > 0 ? parts : null;
    } catch {
        return null;
    }
}
