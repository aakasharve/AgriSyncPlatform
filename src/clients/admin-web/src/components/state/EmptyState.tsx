import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — promoted out of `features/farmer-health/components/EmptyAndErrorStates.tsx`
 * unchanged in behaviour (Preservation Register A32, A41).
 *
 * 🛑 READ THIS BEFORE REACHING FOR IT.
 *
 * This is the GENERIC empty, and a generic empty is exactly the thing this
 * task exists to stop being the default. It survives because ten call sites
 * use it today and they do not migrate until Tasks 22-23 — not because it is
 * the right answer on a new screen.
 *
 * On anything new, name the cause instead:
 *   MeasuredZero — we looked, over a named window, and it really is none
 *   NoMatch      — the filter excluded everything
 *   FeedDown     — the feed stopped, at a named time
 *   LoadFailed   — the request broke
 *
 * The only legitimate use left is a slot where the cause is genuinely already
 * stated by its surroundings — a chart panel inside a page that has already
 * rendered its own load/error state above it.
 *
 * `no celebratory greens (per C7)` — a success is never bright green here, and
 * an empty result is never a celebration at all.
 */
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
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className
      )}
    >
      {/* Composition only. The grey is the honesty grey and it stays grey —
          §9.4 — but "nothing here" now looks like an answer rather than a
          panel that failed to render. The hint moved from `text-text-3` to
          `text-text-2` because a hint is a SENTENCE ABOUT the absence, not
          the absence itself: 2.98:1 → 6.17:1, and the em dash, the word and
          the tile keep the grey that means something. */}
      <span className="grid size-12 place-items-center rounded-panel bg-tint-grey text-text-3">
        {icon ?? <Inbox size={22} strokeWidth={2} />}
      </span>
      <div className="text-h3 font-semibold text-text-1">{message}</div>
      {hint && <div className="max-w-[52ch] text-body text-text-2">{hint}</div>}
    </div>
  );
}
