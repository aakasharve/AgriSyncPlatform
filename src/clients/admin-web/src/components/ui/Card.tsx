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
      data-print="panel"
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
 *  an edge, so it does not violate the border-or-shadow rule above.
 *
 *  THE HEAD IS NOW A BAND (2026-09-02). `--color-panel-head` is a brand-tinted
 *  surface, and running it full-bleed to the panel's edges gives a card a
 *  legible top and bottom rather than one continuous field of white. It is
 *  chrome: nothing in a panel head is a reading. Negative margins undo the
 *  `p-5` the Card contract still owes its two remaining callers, so the band
 *  reaches the corners without changing what `p-5` means to anyone. */
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        '-mx-5 -mt-5 mb-5 flex items-center justify-between gap-3 border-b border-line bg-panel-head px-5 py-4',
        className
      )}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

/** v3 `.as-panel-title` — now 17/600 from the shared scale, where it was a
 *  hand-written 15 and therefore the same size as the body text underneath
 *  it. Never tinted (CONTRACT.md §7.7): a panel title is not a verdict. */
export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('flex items-center gap-2 text-h3 font-semibold text-text-1', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('', className)} {...props} />
);
CardContent.displayName = 'CardContent';
