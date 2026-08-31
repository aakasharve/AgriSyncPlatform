import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortDir } from '@/lib/useListUrlState';

/**
 * One column header.
 *
 * ── aria-sort is live, and only where a sort exists ───────────────────────
 * The attribute is set on EVERY sortable header — `ascending` or `descending`
 * on the active one, `none` on the others — and is absent entirely from a
 * header that cannot be sorted. Both halves matter: a screen-reader user who
 * hears "sortable, none" on a column that does nothing learns to distrust the
 * announcement on the columns that do.
 *
 * That is today's behaviour (`InterventionQueueTable.tsx:141-157` sets
 * `aria-sort` on its four sortable headers and leaves the fifth, an action
 * column, without one) and v3's (`app.js` `initTable` returns early on any
 * `th` with no `data-sort`).
 *
 * ── The label is a button, the header is not ─────────────────────────────
 * `<th>` carries the semantics, the `<button>` carries the click. Making the
 * whole cell clickable would take the header out of the table's own
 * navigation for a keyboard user.
 */
export interface SortHeaderProps {
  label: ReactNode;
  align?: 'left' | 'right';
  width?: string;
  /** False for an action column or a column with no comparable value. */
  sortable: boolean;
  /** True when this is the column the list is currently ordered by. */
  active: boolean;
  /** The direction currently in force — read only when `active`. */
  dir: SortDir;
  onSort: () => void;
  /** Render the label for screen readers only. */
  headerHidden?: boolean;
}

export function SortHeader({
  label,
  align = 'left',
  width,
  sortable,
  active,
  dir,
  onSort,
  headerHidden,
}: SortHeaderProps) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      {...(sortable
        ? { 'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }
        : {})}
      className={cn(
        'whitespace-nowrap border-b border-line bg-page px-4 py-3 align-bottom text-[13px] font-semibold text-text-2',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {headerHidden ? (
        <span className="sr-only">{label}</span>
      ) : sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex items-center gap-1 rounded-chip text-[13px] font-semibold text-text-2 hover:text-text-1',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          <span>{label}</span>
          <Icon size={14} className="text-text-3" aria-hidden="true" />
        </button>
      ) : (
        <span>{label}</span>
      )}
    </th>
  );
}
