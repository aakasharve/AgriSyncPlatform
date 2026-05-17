// CoVeWrapper.ts — Chain of Verification wrapper for AgriSync AI parses
// Reference: Dhuliawala et al. 2023 (arXiv:2309.11495)
// runbook: _COFOUNDER/runbooks/rollback-prompt.md
// prompt-version: v1.0 (see _COFOUNDER/memory/prompt-registry.md)
// spec: data-principle-spine-2026-05-05/05.1
//
// Phase 05 sub-phase 05.1.2 rewired this wrapper to call the backend
// /shramsafal/ai/cove-reverify endpoint instead of hitting Gemini from
// the browser. The browser-side question/prompt/scorer helpers were
// load-bearing only when the client owned the round-trip; with the
// scoring now server-side they are no longer used here, so the file
// shrinks to a thin RPC wrapper that preserves the original
// CoVeResult contract for downstream ConfidencePolicy consumers.

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { agriSyncClient } from '../api/AgriSyncClient';

export const COVE_PROMPT_VERSION = "v1.0";

export interface CoVeResult {
  lowConfidence: boolean;
  verificationScore: number; // 0-1: fraction of questions that passed
  demotionReason?: string;
}

export interface CoVeOptions {
  enabled?: boolean;
  sampleRate?: number; // 0-1, default 0.3
  farmId?: string;
  sourceAiJobId?: string;
}

/**
 * Wraps an AI parse with Chain of Verification.
 * The backend builds the verification prompt, calls Gemini server-side,
 * and returns the verificationScore. Low-confidence parses route to
 * manual review via ConfidencePolicy.
 */
export async function runCoVe(
  originalInput: string,
  structuredParse: Record<string, unknown>,
  options: CoVeOptions = {}
): Promise<CoVeResult> {
  const enabled = options.enabled ?? import.meta.env.VITE_COVE_ENABLED === "true";
  const sampleRate = options.sampleRate ?? 0.3;

  // Feature-flag gate: only run on enabled + sample
  if (!enabled || Math.random() > sampleRate) {
    return { lowConfidence: false, verificationScore: 1.0 };
  }

  // Without a farmId the backend can't run the entitlement gate, so we
  // fail open (no-op) rather than 400 the user. The caller is expected
  // to thread farmId through once CoVe is wired into the voice-parse
  // flow; until then this preserves the legacy fail-open posture.
  if (!options.farmId) {
    return { lowConfidence: false, verificationScore: 1.0 };
  }

  try {
    const response = await agriSyncClient.coveReverify({
      farmId: options.farmId,
      transcript: originalInput,
      parsed: structuredParse,
      sourceAiJobId: options.sourceAiJobId,
    });

    return {
      lowConfidence: response.lowConfidence,
      verificationScore: response.verificationScore,
      demotionReason: response.demotionReason ?? undefined,
    };
  } catch {
    // CoVe failure should never block the parse — fail open. The
    // original parse already passed structural validation; CoVe is a
    // belt-and-braces second opinion.
    return { lowConfidence: false, verificationScore: 1.0 };
  }
}
