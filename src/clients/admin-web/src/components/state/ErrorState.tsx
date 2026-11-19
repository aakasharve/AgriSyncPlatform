import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatError } from './honestState';

/**
 * ErrorState — promoted out of
 * `features/farmer-health/components/EmptyAndErrorStates.tsx` (Preservation
 * Register A41).
 *
 * Two things carried unchanged, and both are behaviour rather than styling:
 *
 *  1. A WORKING Retry. `FarmerHealthPage.tsx:66-68` wires it to `refetch()`.
 *     A retry button that does not retry is worse than no button, because it
 *     spends the reader's one recovery attempt.
 *  2. The `formatError` unwrapping ladder — falsy, then string, then
 *     `Error.message`, then an object carrying a string `message`, then a
 *     fallback. It now lives in `honestState.ts` so `LoadFailed` uses the same
 *     one. An axios error is the fourth rung and the reason the ladder exists.
 *
 * 🛑 THE HEADLINE IS FEATURE-SPECIFIC AND THE RETRY IS OPTIONAL. Both are
 * preserved because two farmer-health call sites depend on them and neither
 * migrates until Task 23. On a NEW screen use `LoadFailed`, which names what
 * failed and makes retry mandatory — a failure a reader cannot act on is a
 * failure they learn to scroll past.
 */
export interface ErrorStateProps {
  /** axios error or generic Error — handler reads `.message`. */
  error: unknown;
  /** Optional retry callback; rendered as a button when provided. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-panel border border-amber/40 bg-tint-amber px-4 py-3 text-caption text-text-1',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 text-amber" aria-hidden />
        <div className="flex-1">
          <div className="font-extrabold">Couldn&apos;t load farmer-health data.</div>
          <div className="mt-0.5 break-words text-caption text-text-2">{formatError(error)}</div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="glass-quiet rounded-chip border-control-edge px-3 py-1.5 text-caption font-bold text-text-1 hover:bg-wash"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
