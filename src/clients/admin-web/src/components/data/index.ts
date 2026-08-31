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
