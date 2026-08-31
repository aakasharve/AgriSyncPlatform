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
        'flex flex-col items-center justify-center gap-2 py-10 text-center',
        className
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-wash text-text-3">
        {icon ?? <Inbox size={18} strokeWidth={2.2} />}
      </span>
      <div className="text-sm font-semibold text-text-1">{message}</div>
      {hint && <div className="max-w-md text-[12px] text-text-3">{hint}</div>}
    </div>
  );
}
