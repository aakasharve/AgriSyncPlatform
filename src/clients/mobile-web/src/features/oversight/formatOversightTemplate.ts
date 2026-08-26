/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Tiny `{token}` substitution for the `oversightTranslations.ts` templates
 * (`decisionLine`, `delegatedLine`, `failedSends`, `sinceLastLookedTail`).
 * Shared by `components/WaitingDrawer.tsx` and
 * `components/OversightBriefingCard.tsx` so the substitution rule cannot
 * drift between the two call sites. Pure string substitution only — never
 * invents or alters the words around the token, only fills in a
 * caller-supplied, already-derived value (spec §P-F).
 */
export function formatOversightTemplate(
    template: string,
    vars: Record<string, string | number>,
): string {
    return Object.entries(vars).reduce(
        (acc, [key, value]) => acc.split(`{${key}}`).join(String(value)),
        template,
    );
}
