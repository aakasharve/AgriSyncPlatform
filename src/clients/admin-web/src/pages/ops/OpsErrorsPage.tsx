import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useOpsErrors, type OpsErrorEvent } from '@/hooks/useOpsErrors';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { Button } from '@/components/ui/Button';

const col = createColumnHelper<OpsErrorEvent>();

const COLUMNS = [
  col.accessor('occurredAtUtc', {
    header: 'Time',
    cell: (i) => (
      <span className="font-mono text-[12px] font-semibold text-text-muted">
        {format(new Date(i.getValue()), 'yyyy-MM-dd HH:mm:ss')}
      </span>
    ),
  }),
  col.accessor('eventType', {
    header: 'Type',
    cell: (i) => (
      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold
        ${i.getValue() === 'api.error'
          ? 'bg-danger/15 text-danger'
          : 'bg-warning/15 text-text-primary'}`}>
        {i.getValue()}
      </span>
    ),
  }),
  col.accessor('endpoint', {
    header: 'Endpoint',
    cell: (i) => <span className="font-mono text-[12px] font-semibold text-text-primary">{i.getValue()}</span>,
  }),
  col.accessor('statusCode', {
    header: 'Status',
    cell: (i) => (
      <span className={`font-mono text-[13px] font-bold ${(i.getValue() ?? 0) >= 500 ? 'text-danger' : 'text-warning'}`}>
        {i.getValue() ?? '—'}
      </span>
    ),
  }),
  col.accessor('latencyMs', {
    header: 'Latency',
    cell: (i) => <span className="font-mono text-[12px] text-text-muted">{i.getValue() ? `${i.getValue()}ms` : '—'}</span>,
  }),
  col.accessor('farmId', {
    header: 'Farm',
    cell: (i) => <span className="font-mono text-[11px] text-text-muted">{i.getValue() ? (i.getValue()!.slice(0, 8) + '…') : '—'}</span>,
  }),
];

const PAGE_SIZE = 50;

export default function OpsErrorsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1);
  const endpoint = searchParams.get('endpoint') ?? undefined;
  const since = searchParams.get('since') ?? undefined;

  const { data, isLoading, isFetching } = useOpsErrors({ page, pageSize: PAGE_SIZE, endpoint, since });

  const items = data?.data?.items ?? [];
  const total = data?.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lastRefreshed = data?.meta?.lastRefreshed;

  const table = useReactTable({
    data: items,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  function setPage(p: number) {
    setSearchParams((prev) => { prev.set('page', String(p)); return prev; });
  }
  function setEndpointFilter(v: string) {
    setSearchParams((prev) => { v ? prev.set('endpoint', v) : prev.delete('endpoint'); prev.set('page', '1'); return prev; });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-danger to-warning text-white shadow-[0_4px_12px_rgba(220,38,38,0.35)]">
            <AlertTriangle size={18} strokeWidth={2.5} />
          </span>
          API Errors
        </h1>
        <FreshnessChip source="live" lastRefreshed={lastRefreshed} />
      </div>

      {/* Filters — URL-state */}
      <div className="flex gap-3">
        <input
          type="text"
          defaultValue={endpoint ?? ''}
          onBlur={(e) => setEndpointFilter(e.target.value.trim())}
          onKeyDown={(e) => { if (e.key === 'Enter') setEndpointFilter((e.target as HTMLInputElement).value.trim()); }}
          placeholder="Filter by endpoint…"
          className="w-72 rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-brand-teal"
        />
        {endpoint && (
          <Button variant="outline" size="sm" onClick={() => setEndpointFilter('')}>
            Clear filter
          </Button>
        )}
        <span className="ml-auto text-sm text-text-muted self-center">
          {isFetching ? 'Refreshing…' : `${total.toLocaleString()} total`}
        </span>
      </div>

      {/* Table */}
      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-row-divider">
                {hg.headers.map((h) => (
                  <th key={h.id} className="py-3 pr-4 text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted first:pl-4">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-row-divider">
                {COLUMNS.map((_, j) => (
                  <td key={j} className="py-2.5 pr-4 first:pl-4">
                    <div className="h-4 animate-pulse rounded bg-surface-sidebar" />
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="py-16 text-center text-sm text-text-muted">
                  No errors found. The system is healthy.
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="py-2.5 pr-4 first:pl-4">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} /> Prev
          </Button>
          <span className="text-sm font-semibold text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
