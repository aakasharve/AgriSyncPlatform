/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt version is derived from the content hash of the system instruction.
 * This ensures that any prompt change creates a new version automatically.
 */
export interface PromptVersionInfo {
    version: string;           // Semantic: 'v3.0' (manual bump for major changes)
    contentHash: string;       // SHA-256 of prompt text (auto-computed)
    description: string;       // What changed in this version
    date: string;              // When this version was created
    evalSetVersion: string;    // Which eval set was used to validate this version
    evalPassRate: number;      // Pass rate on eval set (must be >= 0.80)
}

// Version registry (checked into repo, updated when prompts change)
export const PROMPT_VERSIONS: PromptVersionInfo[] = [
    {
        version: 'v2.0',
        contentHash: '<hash of current prompt>',
        description: 'Phase 22 prompt with bucket issues, use cases, vocab support',
        date: '2026-01-xx',
        evalSetVersion: 'n/a',
        evalPassRate: 0 // No eval set existed
    },
    {
        version: 'v3.0',
        contentHash: '<to be computed>',
        description: 'DFES MVP: per-field confidence, actor attribution, fallback levels',
        date: '2026-02-09',
        evalSetVersion: 'v1.0',
        evalPassRate: 0 // To be measured
    }
];

export const CURRENT_PROMPT_VERSION = 'v3.0';
