import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { count } from './facets';

/**
 * SERVER-SIDE PAGINATION (Preservation Register A17, B4).
 *
 * Three properties, all of them behaviour rather than styling:
 *
 *  1. HIDDEN ENTIRELY on a single page — not disabled, HIDDEN. That is what
 *     the console does today on all three paginated screens
 *     (`FarmsListPage.tsx:103`, `UsersPage.tsx`, `OpsErrorsPage.tsx`, each
 *     guarded by `totalPages > 1 &&`). A greyed-out pager under a
 *     twelve-row table is a control that tells the reader nothing except
 *     that somebody thought about pagination.
 *  2. BOUNDS-DISABLED — Prev off on page 1, Next off on the last page.
 *  3. The page count is derived from the SERVER's `totalCount`, never from
 *     the rows in hand. The client holds one page; it cannot know how many
 *     there are.
 *
 * ── Why there is no `useReactTable` here ─────────────────────────────────
 * The plan's Step 7 suggested backing this with TanStack Table's
 * `manualPagination` + server-driven `pageCount` (register row A50, which
 * records that the library is used on exactly one page today,
 * `OpsErrorsPage.tsx:73-79`).
 *
 * What that API would contribute over a paginated list is `getCanNextPage()`
 * — one division. What it costs is measured, not theoretical: `npm run lint`
 * reports `react-hooks/incompatible-library` at `OpsErrorsPage.tsx:73` —
 * "TanStack Table's useReactTable() API returns functions that cannot be
 * memoized safely", so React Compiler SKIPS COMPILING the whole component
 * that calls it. Paying that on the one component every list in the console
 * renders through, to avoid `Math.ceil`, is the wrong trade.
 *
 * The BEHAVIOUR A50 registers — manual pagination, server-driven page count,
 * the client never slicing rows — is preserved exactly. Whether the LIBRARY
 * stays on the API Errors screen is Task 18's call and the founder's; it is
 * flagged, not decided here.
 */
export interface PagerProps {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  /** Names the region — "All farms pagination". */
  label: string;
}

export function Pager({ page, totalPages, onPage, label }: PagerProps) {
  /* One page is not a pager. */
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={label}
      className="flex items-center justify-between gap-3 px-1 py-3"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} aria-hidden="true" /> Prev
      </Button>
      <span className="text-[13px] font-semibold text-text-2">
        Page {count(page)} of {count(totalPages)}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next <ChevronRight size={14} aria-hidden="true" />
      </Button>
    </nav>
  );
}
