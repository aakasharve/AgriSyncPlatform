import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * LoadingState — promoted out of
 * `features/farmer-health/components/EmptyAndErrorStates.tsx` with its
 * accessibility contract intact (Preservation Register A32).
 *
 * 🛑 FOUR THINGS HERE ARE NOT DECORATION, AND ALL FOUR ARE ASSERTED IN
 *    `__tests__/honestStates.test.tsx`:
 *
 *   role="status"    the block is announced as a live region
 *   aria-busy="true" it is announced as BUSY, not as content
 *   aria-label       a NAMED label, so the announcement says WHICH block is
 *                    loading — "Loading intervention queue", not "loading"
 *   sr-only span     the same words as readable text, because a screen reader
 *                    that ignores aria-label on a generic div still finds them
 *
 * A page with five panels loading at once and no names produces five
 * identical "loading" announcements, which is the same as none. The Lighthouse
 * gate already enforces accessibility >= 0.9 on `/farmer-health`
 * (`.github/workflows/lighthouse.yml`); this is part of that budget, not a
 * nicety somebody can trim.
 *
 * The default label is deliberately a fallback, not a house style. Pass one.
 */
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
      className={cn('relative overflow-hidden rounded-panel bg-wash', className)}
      style={{ height }}
    >
      {/* `via-page/30` is the token form of the original `via-white/30` —
          `--color-page` IS #ffffff, so the shimmer is unchanged and the raw
          colour word is gone. */}
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-page/30 to-transparent" />
      <span className="sr-only">{label}</span>
      <span className="absolute inset-0 grid place-items-center text-text-3">
        <Loader2 size={18} className="animate-spin" aria-hidden />
      </span>
    </div>
  );
}
