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

  try {
    const questions = buildVerificationQuestions(structuredParse);
    const verificationPrompt = buildVerificationPrompt(originalInput, questions);

    // Re-query the model with verification questions
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      return { lowConfidence: false, verificationScore: 1.0 };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: verificationPrompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 512 },
        }),
      }
    );

    if (!response.ok) {
      return { lowConfidence: false, verificationScore: 1.0 };
    }

    const data = await response.json();
    const verificationText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const score = scoreVerification(verificationText, structuredParse, questions);

    if (score < 0.67) {
      return {
        lowConfidence: true,
        verificationScore: score,
        demotionReason: `CoVe v${COVE_PROMPT_VERSION}: ${(score * 100).toFixed(0)}% of verification questions consistent`,
      };
    }

    return { lowConfidence: false, verificationScore: score };
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
