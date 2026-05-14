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
    }
];

export const CURRENT_PROMPT_VERSION = 'v3.0';
