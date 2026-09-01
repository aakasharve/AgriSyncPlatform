import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Card — v3 `.as-panel`, on the token layer.
 *
 * The surface changed; the API did not.
 *
 * ── THE COUNT, RE-MEASURED IN TASK 27 ────────────────────────────────
 * This header said "ten screens compose `<Card>` today and none of them are
 * ported yet". Both halves are now stale, and a stale count is what makes a
 * later reader afraid to touch a file. Counted 2026-09-02 with all thirteen
 * screens ported, `@/components/ui/Card` has TWO importers:
 *   components/OrgSwitcher.tsx
 *   pages/settings/SettingsAdminsPage.tsx
 * The other eight moved to `DataList`, `ChartShell` or a plain panel during
 * Tasks 14-26.
 *
 * The `p-5` padding contract is still preserved, but the reason is now the
 * ordinary one — those two screens are laid out against it — rather than
 * "ten unported screens no test covers".
 *
 * What did change, and why:
 *  - `glass-panel` → a plain white panel. CONTRACT.md §8 bans
 *    glassmorphism, translucency and gradients outright. The old class
 *    also carried a 3px gradient bar across the top of every panel, which
 *    is decorative colour — banned by §7.7's "if you cannot say what a
 *    colour means, remove it."
 *  - border + shadow → shadow only. "Nothing carries a border AND a
 *    shadow. An edge is drawn once, by one means." A panel is
 *    shadow-drawn, at the lowest of the four depths.
 */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-panel bg-page p-5 text-text-1 shadow-surface',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

/** v3 `.as-panel-head` — a divider under the head is an internal rule, not
 *  an edge, so it does not violate the border-or-shadow rule above. */
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'mb-4 flex items-center justify-between gap-3 border-b border-line pb-4',
        className
      )}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

/** v3 `.as-panel-title` — 15/600. Never tinted (CONTRACT.md §7.7). */
export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('flex items-center gap-2 text-[15px] font-semibold text-text-1', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('', className)} {...props} />
);
CardContent.displayName = 'CardContent';
