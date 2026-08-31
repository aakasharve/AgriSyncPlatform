import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { count, facetOptionViews, nounFor } from './facets';
import type { FacetSelection } from './facets';
import type { FacetConfig } from './types';

/**
 * SUMMARY FIRST.
 *
 * The totals and every way of narrowing them are on screen from the moment
 * the page opens. The rows are not: they arrive when the reader asks for
 * them. Three things stop that becoming a puzzle, and all three are here —
 * the counts are always visible, Show all is always there, and an applied
 * filter is stated in words with an obvious way off it (v3 `all-farms.html`,
 * the comment block above `.as-filters`).
 *
 * ── Every count states its scope ─────────────────────────────────────────
 * See `facets.ts` for the decision. Over a server-paginated list an option
 * reads "12 farms on this page", never "12". There is no code path here that
 * renders a bare facet count.
 */

export interface SummaryFacetsProps<T> {
  id: string;
  /** The rows the client is holding — the set every count below is over. */
  rows: T[];
  facets: FacetConfig<T>[];
  selection: FacetSelection;
  onToggle: (facetKey: string, value: string) => void;
  noun: { one: string; many: string };
  /** True when the client holds one page of a larger set. */
  pageScoped: boolean;
  /**
   * The count line, and the screen's own figures beside it.
   *
   * Both are absent on a list that is NOT summary-first: there the row count
   * already sits above the table, and repeating it here would be two figures
   * for one fact. The facet rows below still render — a screen may have
   * filters without hiding its rows behind them.
   */
  headline?: ReactNode;
  summary?: ReactNode;
  /** The Show all / Hide the list control. Absent on a list that is always
   *  open, because there is nothing for it to do. */
  showAll?: { label: string; onClick: () => void; listId: string; listOpen: boolean };
}

export function SummaryFacets<T>({
  id,
  rows,
  facets,
  selection,
  onToggle,
  noun,
  pageScoped,
  headline,
  summary,
  showAll,
}: SummaryFacetsProps<T>) {
  return (
    <div className="flex flex-col gap-4">
      {(headline || summary) && (
        <div className="flex flex-col gap-1">
          {headline && (
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[20px] font-semibold tracking-[-0.01em] text-text-1">
              {headline}
            </p>
          )}
          {summary && <div className="text-[15px] text-text-2">{summary}</div>}
        </div>
      )}

      {facets.length > 0 && (
        <div className="flex flex-col gap-3 border-y border-line py-4">
          {facets.map((facet) => (
            <div
              key={facet.key}
              role="group"
              aria-label={facet.label.replace(/^By /, 'Filter by ')}
              className="flex flex-wrap items-start gap-4"
            >
              <span className="w-24 flex-none pt-2 text-[13px] font-semibold text-text-2">
                {facet.label}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {facetOptionViews(rows, facet, facets, selection).map((view) => {
                  const empty = view.count === 0;
                  const scope = pageScoped ? ' on this page' : '';
                  return (
                    <button
                      key={view.option.value}
                      type="button"
                      aria-pressed={view.pressed}
                      /* The label is spelled out because the visible content
                         is three separate inline spans, and the accessible
                         name computed from them runs together —
                         "Grapes2farms". A count a screen-reader user cannot
                         parse is a count they do not have. */
                      aria-label={[
                        view.option.label,
                        `${count(view.count)} ${nounFor(view.count, noun)}${scope}`,
                        view.side,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      /* An option that would find nothing keeps its place and
                         shows its 0. A reader learns more from "Trial 0" than
                         from an option that vanished. */
                      data-empty={empty ? 'true' : undefined}
                      onClick={() => onToggle(facet.key, view.option.value)}
                      className={cn(
                        'inline-flex items-baseline gap-2 rounded-full border px-3 py-2 text-left text-[15px]',
                        view.pressed
                          ? 'border-tint-blue bg-tint-blue font-semibold text-blue'
                          : 'border-line bg-page hover:bg-wash',
                        empty && !view.pressed && 'text-text-3',
                      )}
                    >
                      <span>{view.option.label}</span>
                      <span className="font-semibold tabular-nums">{count(view.count)}</span>
                      <span
                        className={cn(
                          'text-[13px] tabular-nums',
                          view.pressed ? 'text-blue' : empty ? 'text-text-3' : 'text-text-2',
                        )}
                      >
                        {/* The count carries its noun AND its scope. Without
                            the noun the option reads "Grapes 9 · 20.6 ac" —
                            two figures with nothing saying what the first one
                            counts. Without the scope it claims to have
                            counted rows it has never seen. */}
                        {nounFor(view.count, noun)}
                        {scope}
                        {view.side ? ` · ${view.side}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAll && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-text-3">
            Pick a filter to open just those {noun.many}, or show every one of them.
          </span>
          <button
            type="button"
            id={`${id}-showall`}
            aria-controls={showAll.listId}
            aria-expanded={showAll.listOpen}
            onClick={showAll.onClick}
            className="ml-auto rounded-chip border border-line bg-page px-3 py-2 text-[13px] font-medium text-text-1 hover:bg-wash"
          >
            {showAll.label}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * THE APPLIED-FILTER CHIP.
 *
 * Two properties that are easy to get subtly wrong, and both are behaviour:
 *
 *  1. It states the filter IN WORDS — "Grapes · 12 farms on this page" — not
 *     as a serialised query. The chip is the only thing on screen that says
 *     what is currently excluded.
 *  2. Its close control RETURNS TO THE SUMMARY, not to a longer list. v3
 *     `all-farms.html`: "Clearing a filter goes back to where the screen
 *     started: the summary and the filters, with no rows. It does NOT swap
 *     one filtered list for the full sixteen — the reader asked to be rid of
 *     a list, not handed a bigger one."
 *
 * A search still in the box keeps the list up, because that is a second,
 * separate request for rows. `DataList` owns that rule; the chip only asks.
 */
export interface FilterChipProps {
  text: string;
  onClear: () => void;
}

export function FilterChip({ text, onClear }: FilterChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tint-blue py-1 pl-3 pr-1 text-[15px] font-semibold tabular-nums text-blue">
      <span className="py-1">{text}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear this filter and go back to the summary"
        className="grid h-6 w-6 flex-none place-items-center rounded-full text-blue hover:bg-blue/15"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
