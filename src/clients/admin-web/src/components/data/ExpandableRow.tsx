import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RowEdge } from './types';

/**
 * A data row and its detail row, as ONE unit.
 *
 * ── They move together ───────────────────────────────────────────────────
 * v3 sorts "row groups" — a row plus its optional detail — so an open detail
 * never ends up under somebody else's row (`app.js` `rowGroups` /
 * `applySort`). Here the pair is emitted from one component in one place, so
 * the property holds by construction rather than by a second implementation
 * agreeing with the first.
 *
 * ── Keyboard ─────────────────────────────────────────────────────────────
 * Enter AND Space, both with `preventDefault` — Space on a focused element
 * scrolls the page otherwise, so a keyboard user opening the third row would
 * be thrown to the bottom of the table. `aria-expanded` and `aria-controls`
 * are on the row, which is what a screen reader announces.
 *
 * A click or a keypress that lands on a link or a button INSIDE the row is
 * left alone: a row action must not also toggle the detail.
 *
 * ── The leading edge ─────────────────────────────────────────────────────
 * A 3px coloured edge, and only on the rows that need a person. On every row
 * it is decoration; v3 puts the threshold at "about a third of the table". It
 * continues onto the detail row so an open row reads as one block.
 */

const EDGE_TOKEN: Record<RowEdge, string> = {
  red: 'var(--color-red-vivid)',
  amber: 'var(--color-amber-vivid)',
  blue: 'var(--color-blue-vivid)',
  green: 'var(--color-green-vivid)',
  grey: 'var(--color-edge-grey)',
};

function edgeStyle(edge: RowEdge | null | undefined) {
  /* Drawn as an inset shadow rather than a border so it does not fight the
     row's own bottom hairline and does not shift the text. Same mechanism the
     console uses today (`InterventionQueueTable.tsx:99`), on the token layer
     instead of a raw hex fallback. */
  return edge ? { boxShadow: `inset 3px 0 0 0 ${EDGE_TOKEN[edge]}` } : undefined;
}

export interface ExpandableRowProps {
  /** DOM id of the detail row — the value of the row's `aria-controls`. */
  detailId: string;
  cells: ReactNode;
  /** Absent means this row does not expand: no role, no tabindex, no aria. */
  detail?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  edge?: RowEdge | null;
  /** Column count, for the detail row's single cell. */
  colSpan: number;
}

export function ExpandableRow({
  detailId,
  cells,
  detail,
  expanded,
  onToggle,
  edge,
  colSpan,
}: ExpandableRowProps) {
  const expandable = detail !== undefined && detail !== null;

  function fromRowAction(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('a, button');
  }

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    if (fromRowAction(e.target)) return;
    onToggle();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (fromRowAction(e.target)) return;
    e.preventDefault();
    onToggle();
  }

  return (
    <>
      <tr
        style={edgeStyle(edge)}
        className={cn(
          'border-b border-line last:border-0',
          expandable && 'cursor-pointer',
          expanded ? 'bg-wash' : 'hover:bg-wash',
        )}
        /* ONE DELIBERATE DEVIATION FROM v3, and it is an accessibility fix
           rather than a preference. v3 puts `role="button"` on the `<tr>`
           (`app.js` `initExpand`), which REPLACES the implicit `row` role —
           and a `cell` whose parent is no longer a `row` is an axe
           `aria-required-parent` violation, on a repo whose CI asserts
           accessibility >= 0.9 on a table-heavy screen
           (`.github/workflows/lighthouse.yml`). `aria-expanded` is valid on
           `role="row"`, so the row stays a row and still announces its
           state. */
        {...(expandable
          ? {
              tabIndex: 0,
              'aria-expanded': expanded,
              'aria-controls': detailId,
              onClick: handleClick,
              onKeyDown: handleKeyDown,
            }
          : {})}
      >
        {cells}
      </tr>
      {expandable && (
        <tr id={detailId} hidden={!expanded} style={edgeStyle(edge)} className="bg-wash">
          <td colSpan={colSpan} className="px-4 pb-5 pt-1">
            <div className="max-w-[var(--text-measure)] text-body text-text-2">{detail}</div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The chevron that turns when a row opens. Sits in the first cell, so the
 *  affordance is where the eye already is. */
export function ExpandChevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mr-2 inline-grid align-[-3px] text-text-3 transition-transform',
        open && 'rotate-90',
      )}
    >
      <ChevronRight size={16} />
    </span>
  );
}
