/**
 * THE list vocabulary — one barrel, one import line.
 *
 * A screen imports `DataList` and the helpers it needs to describe its own
 * columns and facets. It does NOT import `SortHeader`, `Pager`,
 * `ExpandableRow` or `SummaryFacets` directly: those are parts of the list,
 * and a screen reaching past `DataList` to one of them is the first step back
 * towards sixteen hand-rolled tables.
 */

export { DataList } from './DataList';

/* THE chart shell. Every chart from here on is drawn inside it, and its
   accessible data table is a REQUIRED prop — five charts carry one today and
   one of those five is screen-reader-only, so a rewrite that dropped it would
   be invisible in review (A32). */
export { ChartShell } from './ChartShell';
export type {
  ChartDataTable,
  ChartShellProps,
  ChartShellStates,
  ChartTableColumn,
} from './ChartShell';

/* The fixed axis, and the line between a measured zero and a gap (A33).
   `fillAxis` REPLACES the `?? 0` zero-fill in the three live charts: an
   absent slot comes back as a gap marker, never as a substituted number. */
export { fillAxis, gapCount, isGap, measuredSlots, ramp } from './fillAxis';
export { PILLAR_ORDER, SCORE_BINS, TIER_ORDER } from './fillAxis';
export type { AxisPoint, AxisSlot, FillAxisOptions } from './fillAxis';

/* How an absence is drawn: a full-height hatched stub, never a zero-height
   bar. `GapBar` is exported on its own because Tasks 21-23 need it inside
   chart types this shell does not draw. */
export { GapBar } from './GapBar';
export type { GapBarProps } from './GapBar';
export { Sparkline } from './Sparkline';
export type { SparklineProps, SparkTone } from './Sparkline';

/* Describing a column's order. `byMostRecent` is the tiebreak that lives in
   `InterventionQueueTable` today, lifted so it stops living in one file. */
export { byMostRecent, isSortable, sortRows } from './sortRows';

/* Describing facets. `facetOptionsFrom` fixes option order once, by count. */
export { facetOptionsFrom, scopedCount } from './facets';
export type { FacetSelection } from './facets';

/* The search index, for a screen that needs to measure or pre-warm it.
   Ordinary screens never touch these — `DataList` owns the memo. */
export { searchHaystack } from './searchIndex';

export type {
  DataListColumn,
  DataListConfig,
  DataListStates,
  FacetConfig,
  FacetOption,
  PaginationConfig,
  RowEdge,
  SearchConfig,
  ServerPagination,
  SortType,
  SortableValue,
} from './types';
