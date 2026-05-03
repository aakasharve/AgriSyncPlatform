import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

/**
 * Shared empty / loading / error state primitives for the Farmer Health
 * feature (DWC v2 §4.3 Step 6 — UI brief §3 + §4 Empty / Loading / Error).
 *
 * Visual language:
 *  - LoadingState: shimmer panel — must paint within 100 ms (per C9).
 *  - EmptyState: muted icon + message; no celebratory greens (per C7).
 *  - ErrorState: amber banner with retry; data-table fallback honored.
 *  - ScoringActiveBanner: MANDATORY copy per C5 — do not paraphrase.
 */

const DEPLOY_DATE_FALLBACK = 'first deploy';

export interface ScoringActiveBannerProps {
  deployDate?: string;
}

/**
 * Mandatory C5 banner — exact copy:
 *   "Scoring active from {DEPLOY_DATE}; data accumulating."
 */
export function ScoringActiveBanner({ deployDate }: ScoringActiveBannerProps) {
  const date = deployDate?.trim() || DEPLOY_DATE_FALLBACK;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-surface-border bg-surface-kpi px-4 py-3 text-[13px] font-semibold text-text-primary"
    >
      <span className="font-extrabold">Scoring active from {date};</span>{' '}
      <span className="text-text-secondary">data accumulating.</span>
    </div>
  );
}

export interface EmptyStateProps {
  message: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ message, hint, icon, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className ?? ''}`}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-sidebar text-text-muted">
        {icon ?? <Inbox size={18} strokeWidth={2.2} />}
      </span>
      <div className="text-sm font-semibold text-text-primary">{message}</div>
      {hint && <div className="max-w-md text-[12px] text-text-muted">{hint}</div>}
    </div>
  );
}

export interface LoadingStateProps {
  /** Optional label rendered for screen readers; visible UI is shimmer. */
  label?: string;
  /** Pixel height of the shimmer block (defaults to 240px). */
  height?: number;
  className?: string;
}

export function LoadingState({ label = 'Loading…', height = 240, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={`relative overflow-hidden rounded-lg bg-surface-sidebar ${className ?? ''}`}
      style={{ height }}
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      <span className="sr-only">{label}</span>
      <span className="absolute inset-0 grid place-items-center text-text-muted">
        <Loader2 size={18} className="animate-spin" aria-hidden />
      </span>
    </div>
  );
}

export interface ErrorStateProps {
  /** axios error or generic Error — handler reads `.message`. */
  error: unknown;
  /** Optional retry callback; rendered as a button when provided. */
  onRetry?: () => void;
  className?: string;
}

function formatError(error: unknown): string {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return 'Unexpected error — see console.';
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-[color:rgba(245,158,11,0.4)] bg-[color:rgba(245,158,11,0.08)] px-4 py-3 text-[13px] text-text-primary ${className ?? ''}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 text-[#b45309]" aria-hidden />
        <div className="flex-1">
          <div className="font-extrabold">Couldn&apos;t load farmer-health data.</div>
          <div className="mt-0.5 break-words text-[12px] text-text-secondary">
            {formatError(error)}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-surface-border bg-white/70 px-2.5 py-1 text-[12px] font-bold text-text-primary hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
