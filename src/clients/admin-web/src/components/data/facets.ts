import { fmt } from '@/lib/format';
import type { FacetConfig, FacetOption } from './types';

/**
 * FACETS — the summary-first filter rows, and the one real design conflict in
 * the whole port.
 *
 * ── The conflict, and the decision ────────────────────────────────────────
 * v3's summary-first pattern claims every filter option can state its EXACT
 * count and EXACT acreage. That is only computable over a FULLY LOADED set —
 * trivially true at sixteen sample rows in a static mockup, false at real
 * volume. Server pagination (Preservation Register A17) means the client
 * holds forty rows, not all of them.
 *
 * Three ways out, in order of preference:
 *
 *   1. ASK THE SERVER. Faceted counts alongside the page. Needs a backend
 *      change, so a separate plan — and it is the only version that stays
 *      true at scale. Recorded as the follow-up; NOT built here.
 *
 *   2. STATE THE SCOPE IN WORDS. "12 on this page", never a bare "12".
 *      **This is what is built.** A count whose scope is unstated is exactly
 *      the defect this redesign exists to remove.
 *
 *   3. LOAD EVERYTHING. REJECTED. Prod is a 2-vCPU box with a measured
 *      ceiling of about 32 simultaneous requests; a console that fetches
 *      every farm to draw a facet count is a self-inflicted outage.
 *
 * ── The one count that may stay bare ─────────────────────────────────────
 * `totalCount` comes from the server and is exact. So a paginated list says
 * "1,284 farms · 40 on this page": the TOTAL is server truth, and only the
 * per-facet BREAKDOWN is page-scoped. Collapsing those two into one qualified
 * number would under-claim as badly as an unqualified count over-claims.
 */

/** Which option is chosen in each facet. `null` means none. */
export type FacetSelection = Record<string, string | null>;

/**
 * Does this row survive the chosen facets?
 *
 * `except` skips one facet's own selection — that is how a CROSS-FILTERED
 * count is computed: the number on a crop button allows for the chosen
 * village and plan, but not for the crop currently chosen, because pressing
 * it would replace that choice. v3 `all-farms.html:270-277`.
 */
export function passesFacets<T>(
  row: T,
  facets: FacetConfig<T>[],
  selection: FacetSelection,
  except?: string,
): boolean {
  for (const facet of facets) {
    if (facet.key === except) continue;
    const chosen = selection[facet.key];
    if (!chosen) continue;
    const option = facet.options.find((o) => o.value === chosen);
    /* An unknown value in the URL filters nothing. A hand-edited `?crop=xyz`
       must not silently empty the list and read as a measured zero. */
    if (option && !option.test(row)) return false;
  }
  return true;
}

/** The rows the current selection yields. */
export function selectRows<T>(
  rows: T[],
  facets: FacetConfig<T>[],
  selection: FacetSelection,
): T[] {
  if (facets.length === 0) return rows;
  return rows.filter((row) => passesFacets(row, facets, selection));
}

/** The applied filter IN WORDS, in facet order — what the chip says. */
export function appliedFacetWords<T>(
  facets: FacetConfig<T>[],
  selection: FacetSelection,
): string[] {
  const words: string[] = [];
  for (const facet of facets) {
    const chosen = selection[facet.key];
    if (!chosen) continue;
    const option = facet.options.find((o) => o.value === chosen);
    if (option) words.push(option.label);
  }
  return words;
}

export function anyFacetApplied(selection: FacetSelection): boolean {
  return Object.values(selection).some(Boolean);
}

/** One option, resolved against the current rows and selection. */
export interface FacetOptionView<T> {
  option: FacetOption<T>;
  pressed: boolean;
  count: number;
  /** The second figure, or null when it genuinely has none. */
  side: string | null;
}

/**
 * The counts, per facet.
 *
 * CROSS-FILTERED IS OPT-IN. With it, an option's count is the number of rows
 * you get by pressing it. Without it, the count answers "how many are there"
 * and does not move when another facet is chosen — which is the reading Users,
 * Suffering and API Errors need, and the reason v3 does not cross-filter
 * there.
 *
 * A zero-yield option keeps its position and shows its 0. A reader learns more
 * from "Trial 0" than from an option that vanished.
 */
export function facetOptionViews<T>(
  rows: T[],
  facet: FacetConfig<T>,
  facets: FacetConfig<T>[],
  selection: FacetSelection,
): FacetOptionView<T>[] {
  return facet.options.map((option) => {
    const subset = rows.filter(
      (row) =>
        option.test(row) &&
        (facet.crossFiltered ? passesFacets(row, facets, selection, facet.key) : true),
    );
    return {
      option,
      pressed: selection[facet.key] === option.value,
      count: subset.length,
      /* An option holding nothing has no side figure either, and that is not
         the same as a figure we failed to measure. It says "0" and stops. */
      side: subset.length === 0 ? null : (facet.side?.(subset) ?? null),
    };
  });
}

/**
 * Build a facet's options from a field, ordered by how many rows each holds
 * and then alphabetically — ONCE, at build time. v3 `optionsFor`
 * (`all-farms.html:216-233`).
 *
 * The order is fixed and never moves again. Buttons that reshuffle as you
 * press them are unusable: the option under your finger is not the option you
 * meant by the time you press it.
 */
export function facetOptionsFrom<T>(
  rows: T[],
  value: (row: T) => string | null | undefined,
  label: (value: string) => string = (v) => v,
): FacetOption<T>[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = value(row);
    if (v === null || v === undefined || v === '') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([v]) => ({
      value: v,
      label: label(v),
      test: (row: T) => value(row) === v,
    }));
}

/* ─────────────────────────────────────────────────── saying it honestly */

/** A count this component computed over rows it is holding. It is never
 *  absent, so the `fmt` null branch here is unreachable rather than a
 *  fallback that hides a missing measurement. */
export function count(n: number): string {
  return fmt.num(n) ?? String(n);
}

export function nounFor(n: number, noun: { one: string; many: string }): string {
  return n === 1 ? noun.one : noun.many;
}

/**
 * "12 farms" — or "12 farms on this page" when the client is holding one page
 * of a larger set.
 *
 * This is resolution (2) above, and it is the ONLY way a facet count is ever
 * rendered. There is no code path that produces a bare number over a
 * paginated list.
 */
export function scopedCount(
  n: number,
  noun: { one: string; many: string },
  pageScoped: boolean,
): string {
  return `${count(n)} ${nounFor(n, noun)}${pageScoped ? ' on this page' : ''}`;
}
