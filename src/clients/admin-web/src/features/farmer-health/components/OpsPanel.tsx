import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * C8, WITH ONE HOME (Preservation Register A37).
 *
 * The slate inset edge is not styling. It is how an admin tells PRIVILEGED
 * OPS DATA from the core farmer profile at a glance: everything above Band 5
 * is about the farmer and is visible to anyone who can open the screen;
 * everything inside this frame is about the device and the pipeline, and is
 * visible only to a caller the server granted it to.
 *
 * It had three homes — `SyncStateBlock.tsx:120`, `AiHealthBlock.tsx:241` and
 * the denial panel in `FarmerHealthDrilldown.tsx:153` — each writing the same
 * inline box-shadow. A rule kept in three places is a rule that gets changed
 * in one. `--color-ops-inset` still lives in `globals.css` with its reason
 * attached; this component is the only thing that reads it.
 *
 * The inset is written ALONGSIDE `--shadow-surface` rather than instead of
 * it, because an inline `boxShadow` replaces the class's shadow outright and
 * the panel would otherwise lose its depth level and become the only flat
 * panel on the screen.
 */

const OPS_EDGE = 'inset 4px 0 0 0 var(--color-ops-inset), var(--shadow-surface)';

export interface OpsPanelProps {
  title: string;
  /** The module key the SERVER gates this block on — shown, because "ops"
   *  is not a grant and an operator asking for access has to name one. */
  grant: string;
  /**
   * TRUE when this panel stands IN PLACE OF a block rather than carrying one.
   *
   * It changes the DOM hook, not the styling, and that matters: both panels
   * name the same grants, so a single `data-ops-panel` attribute would make
   * "the sync block is shown" and "the sync block is withheld" indexable by
   * the same selector — and a test asserting the block is absent would pass
   * on the denial standing where it used to be.
   */
  denied?: boolean;
  children: ReactNode;
  className?: string;
}

export function OpsPanel({ title, grant, denied, children, className }: OpsPanelProps) {
  return (
    <section
      data-ops-panel={denied ? undefined : grant}
      data-ops-denied={denied ? grant : undefined}
      className={cn('rounded-panel bg-page p-5', className)}
      style={{ boxShadow: OPS_EDGE }}
      aria-label={`${title} (${grant})`}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-semibold text-text-1">{title}</h3>
        <span className="text-caption text-text-3">requires {grant}</span>
      </div>
      {children}
    </section>
  );
}
