/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H16) — read a लक्ष द्या card's rank and
 * suggested action the way the server REALLY sends them.
 *
 * `AttentionCardDto.cs` types `Rank` and `SuggestedAction` as C# enums, and the API registers no
 * `JsonStringEnumConverter` (the same gap `domain/ai/contracts/FieldConfidence.ts` documents for
 * `ConfidenceScore`), so `/sync/pull` writes them as their ORDINAL NUMBERS: `{"rank":1,"suggestedAction":0}`.
 * `attentionBoardReconciler.ts` copies them into Dexie unchanged, so every stored card carries numbers too.
 * Matching only the names meant no card ever drew a button and every card read "नजर ठेवा".
 *
 * Both forms are accepted (P11: rows already on the phone keep working, and a later server that sends names
 * keeps working): the ordinal, the ordinal as text, or the name (any letter case). Anything else is `null` —
 * never guessed into a rank or an action.
 */

/** `AttentionRank` (`AttentionCardDto.cs`), in ordinal order: Critical = 0 … Healthy = 3. */
export const ATTENTION_RANKS = ['Critical', 'NeedsAttention', 'Watch', 'Healthy'] as const;
export type AttentionRankName = (typeof ATTENTION_RANKS)[number];

/** `SuggestedActionKind` (`SuggestedActionKind.cs`), in ordinal order: OpenPlot = 0 … RetryFailedSync = 5. */
export const SUGGESTED_ACTIONS = ['OpenPlot', 'OpenStageCompare', 'AssignTest', 'ResolveDispute', 'ReviewOverdueTasks', 'RetryFailedSync'] as const;
export type SuggestedActionName = (typeof SUGGESTED_ACTIONS)[number];

function fromWire<T extends string>(names: readonly T[], value: unknown): T | null {
    if (typeof value === 'number') return Number.isInteger(value) ? names[value] ?? null : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (/^\d+$/.test(text)) return names[Number(text)] ?? null;
    const lower = text.toLowerCase();
    return names.find(n => n.toLowerCase() === lower) ?? null;
}

/** The card's rank name, or `null` when the value is not one the server defines. */
export function attentionRankOf(value: unknown): AttentionRankName | null {
    return fromWire(ATTENTION_RANKS, value);
}

/** The card's suggested action name, or `null` when the value is not one the server defines. */
export function suggestedActionOf(value: unknown): SuggestedActionName | null {
    return fromWire(SUGGESTED_ACTIONS, value);
}

/** Sort key, most serious first; a rank we cannot read goes last. */
export function attentionRankOrder(value: unknown): number {
    const rank = attentionRankOf(value);
    return rank ? ATTENTION_RANKS.indexOf(rank) : ATTENTION_RANKS.length;
}
