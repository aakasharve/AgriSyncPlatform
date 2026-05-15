/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt version metadata. As of DATA_PRINCIPLE_SPINE Phase 01.2, the
 * real content hash is computed server-side (AiPromptLineage.ComputeFullContentHash)
 * and arrives on the parse response as Provenance.PromptContentHash —
 * not on this client-side registry. This registry now only carries the
 * human-readable version label + change-log metadata.
 */
export interface PromptVersionInfo {
    version: string;           // Semantic: 'v3.0' (manual bump for major changes)
    description: string;       // What changed in this version
    date: string;              // When this version was created
    evalSetVersion: string;    // Which eval set was used to validate this version
    evalPassRate: number;      // Pass rate on eval set (must be >= 0.80)
}

// Version registry (checked into repo, updated when prompts change).
// contentHash is no longer stored here — it lives on Provenance per row,
// authoritatively computed server-side.
export const PROMPT_VERSIONS: PromptVersionInfo[] = [
    {
        version: 'v2.0',
        description: 'Phase 22 prompt with bucket issues, use cases, vocab support',
        date: '2026-01-xx',
        evalSetVersion: 'n/a',
        evalPassRate: 0 // No eval set existed
    },
    {
        version: 'v3.0',
        description: 'DFES MVP: per-field confidence, actor attribution, fallback levels',
        date: '2026-02-09',
        evalSetVersion: 'v1.0',
        evalPassRate: 0 // To be measured
    },
    {
        version: 'v3.1',
        // DATA_PRINCIPLE_SPINE 02.6 — wire-contract change. The activity-
        // expense `category` free-text field becomes the canonical
        // `categoryId` enum (13-code lookup, locked by R0 verdict
        // 2026-05-15). The Marathi/Hindi label hints used by the AI
        // prompt to coerce farmer speech onto a code live server-side in
        // `AiPromptTemplateRegistry.cs` + `MarathiPromptData.cs` per
        // Phase 01.2 (the browser-side `aiPrompts.ts` was removed as
        // part of the prompt migration to the backend). This row
        // documents the wire bump from the client's perspective; the
        // server-side prompt template was updated in the bundled
        // backend implementor's commit.
        description: 'Wire-contract: activityExpenses.categoryId enum (13 codes) — see decisions-log 2026-05-15 / DATA_PRINCIPLE_SPINE 02.5 / 02.6',
        date: '2026-05-15',
        evalSetVersion: 'v1.0',
        evalPassRate: 0 // To be measured against golden-set after bundle ships
    }
];

export const CURRENT_PROMPT_VERSION = 'v3.1';
