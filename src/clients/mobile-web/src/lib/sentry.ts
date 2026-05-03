// sentry.ts — Sentry initialization for AgriSync mobile-web
// runbook: _COFOUNDER/runbooks/secrets-mgmt.md
// DSN stored in GitHub Actions secret VITE_SENTRY_DSN (never committed)

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Sentry from "@sentry/react";

// Import PromptVersion for tagging — adjust path if needed
let PROMPT_VERSION = "v1.0";
try {
  // Dynamic import to avoid breaking if file doesn't exist yet
  const pv = await import("../domain/ai/contracts/PromptVersion").catch(() => null);
  if (pv?.CURRENT_PROMPT_VERSION) PROMPT_VERSION = pv.CURRENT_PROMPT_VERSION;
} catch {
  // ignore
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.debug("[sentry] VITE_SENTRY_DSN not set — Sentry disabled.");
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE ?? "development",
    release: import.meta.env.VITE_APP_VERSION ?? "dev",
    initialScope: {
      tags: {
        "prompt.version": PROMPT_VERSION,
      },
    },
    beforeSend(event) {
      // Never send events in local dev unless explicitly enabled
      if (import.meta.env.DEV && !import.meta.env.VITE_SENTRY_DEV_ENABLED) {
        return null;
      }
      return event;
    },
  });
}

/**
 * Capture an AI surface error with feature context.
 * Safe to call even if Sentry is not initialized.
 */
export function captureAiError(
  feature: "parser" | "ocr" | "patti" | "vocab",
  error: Error,
  context: Record<string, unknown> = {}
): void {
  Sentry.withScope((scope) => {
    scope.setTag("feature", feature);
    scope.setTag("prompt.version", PROMPT_VERSION);
    scope.setContext("ai_context", context);
    Sentry.captureException(error);
  });
}
