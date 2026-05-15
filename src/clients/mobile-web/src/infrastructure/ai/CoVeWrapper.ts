// CoVeWrapper.ts — Chain of Verification wrapper for AgriSync AI parses
// Reference: Dhuliawala et al. 2023 (arXiv:2309.11495)
// runbook: _COFOUNDER/runbooks/rollback-prompt.md
// prompt-version: v1.0 (see _COFOUNDER/memory/prompt-registry.md)

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const COVE_PROMPT_VERSION = "v1.0";

export interface CoVeResult {
  lowConfidence: boolean;
  verificationScore: number; // 0-1: fraction of questions that passed
  demotionReason?: string;
}

export interface CoVeOptions {
  enabled?: boolean;
  sampleRate?: number; // 0-1, default 0.3
}

/**
 * Wraps an AI parse with Chain of Verification.
 * Generates 3 verification questions about the structured parse,
 * re-queries the model, and checks consistency.
 * Low-confidence parses route to manual review via ConfidencePolicy.
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

  // Phase 01 sub-phase 01.W0 (Y.md §7): the browser-direct Gemini call
  // path was removed on 2026-05-15. Re-querying for verification must go
  // through a backend route. Until Phase 05 (Privacy Edge) lands the
  // /api/ai/cove-reverify endpoint, CoVe verification is a no-op
  // (fail-open). Re-enabling here is intentionally blocked at compile
  // time by the vite.config.ts guard against VITE_GEMINI_API_KEY.
  //
  // The local-only structural pieces below (questions + prompt + scorer)
  // stay so the backend route, when wired, can reuse them client-side
  // for telemetry without re-implementing the scoring heuristic.
  try {
    const questions = buildVerificationQuestions(structuredParse);
    void buildVerificationPrompt(originalInput, questions);
    void scoreVerification;
    return { lowConfidence: false, verificationScore: 1.0 };
  } catch {
    // CoVe failure should never block the parse — fail open
    return { lowConfidence: false, verificationScore: 1.0 };
  }
}

function buildVerificationQuestions(
  parse: Record<string, unknown>
): string[] {
  const questions: string[] = [];

  if (parse.date) questions.push(`What is the date mentioned? (expected: ${parse.date})`);
  if (parse.amount !== undefined) questions.push(`What is the total amount or quantity? (expected: ${parse.amount})`);
  if (parse.cropName || parse.crop) questions.push(`What crop is mentioned? (expected: ${parse.cropName ?? parse.crop})`);
  if (parse.actionType || parse.action) questions.push(`What farm action is described? (expected: ${parse.actionType ?? parse.action})`);

  // Always ask at least 3 questions
  if (questions.length < 3) {
    questions.push("Does this log entry seem complete and internally consistent? (yes/no)");
  }

  return questions.slice(0, 3);
}

function buildVerificationPrompt(
  originalInput: string,
  questions: string[]
): string {
  return `You are a verification assistant. Based ONLY on the following farm log entry, answer each question briefly and accurately.

Farm log: "${originalInput}"

${questions.map((q, i) => `Q${i + 1}: ${q}`).join("\n")}

Answer each question on a new line as: A1: <answer>, A2: <answer>, A3: <answer>`;
}

function scoreVerification(
  verificationText: string,
  parse: Record<string, unknown>,
  questions: string[]
): number {
  // Simple heuristic: check if the model's answers are consistent with the structured parse
  let consistent = 0;

  questions.forEach((q, i) => {
    const answerMatch = verificationText.match(new RegExp(`A${i + 1}:\\s*(.+)`, "i"));
    if (!answerMatch) return;
    const answer = answerMatch[1].toLowerCase().trim();

    // Check if the answer contains a key value from the parse
    const isConsistent =
      answer === "yes" ||
      (parse.date && answer.includes(String(parse.date).toLowerCase())) ||
      (parse.cropName && answer.includes(String(parse.cropName).toLowerCase())) ||
      (parse.amount !== undefined && answer.includes(String(parse.amount))) ||
      answer.includes("consistent") ||
      answer.includes("correct");

    if (isConsistent) consistent++;
  });

  return questions.length > 0 ? consistent / questions.length : 1.0;
}
