import { useMemo } from 'react';
import { Frown } from 'lucide-react';
import { DataList } from '@/components/data';
import type { DataListColumn } from '@/components/data';
import { MetricLines, NotMeasured } from '@/components/state';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { PersonName } from '@/components/ui/PersonName';
import { metaRefreshedAt } from '@/lib/api';
import { DATE_FORMATS, fmt } from '@/lib/format';
import { useFarmContacts, type FarmContact } from '@/hooks/useFarmContacts';
import { useSuffering, type SufferingItem } from '@/hooks/useFarms';

/**
 * SUFFERING (`/farms/suffering`) — farms with repeated problems, counted on request.
 *
 * The server counts, from the problems recorded in the last 7 days, the farms
 * with three or more (platform owners only). A problem is counted for the farm
 * its request NAMED. Each problem lands in exactly one of four areas: syncing,
 * saving entries, voice recording, other.
 *
 * Farm names are not in this answer: `useFarmContacts` asks for them once per
 * new farm id; the short farm id shows while a name loads or when none is known.
 *
 * A failed request is the DataList's own "could not load" state, never an empty
 * list. A true empty answer is a real "none", worded with its window.
 */
const WINDOW_WORDS = 'the last 7 days';

function shortFarmId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

function buildColumns(contacts: Map<string, FarmContact>): DataListColumn<SufferingItem>[] {
  return [
    {
      key: 'farm',
      label: 'Farm',
      render: (f) => {
        const contact = contacts.get(f.farmId.toLowerCase());
        return contact ? (
          <PersonName name={contact.name} fallback={shortFarmId(f.farmId)} />
        ) : (
          <span title={f.farmId} className="break-all">
            {shortFarmId(f.farmId)}
          </span>
        );
      },
      sortType: 'text',
      sortValue: (f) => contacts.get(f.farmId.toLowerCase())?.name ?? f.farmId,
      defaultDir: 'asc',
    },
    {
      key: 'problems',
      label: 'Problems',
      align: 'right',
      render: (f) => fmt.num(f.problemCount) ?? <NotMeasured />,
      sortType: 'num',
      sortValue: (f) => f.problemCount,
      defaultDir: 'desc',
    },
    {
      key: 'sync',
      label: 'Syncing',
      align: 'right',
      render: (f) => fmt.num(f.syncProblems) ?? <NotMeasured />,
      sortType: 'num',
      sortValue: (f) => f.syncProblems,
      defaultDir: 'desc',
    },
    {
      key: 'entries',
      label: 'Entries',
      align: 'right',
      render: (f) => fmt.num(f.entryProblems) ?? <NotMeasured />,
      sortType: 'num',
      sortValue: (f) => f.entryProblems,
      defaultDir: 'desc',
    },
    {
      key: 'voice',
      label: 'Voice',
      align: 'right',
      render: (f) => fmt.num(f.voiceProblems) ?? <NotMeasured />,
      sortType: 'num',
      sortValue: (f) => f.voiceProblems,
      defaultDir: 'desc',
    },
    {
      key: 'other',
      label: 'Other',
      align: 'right',
      render: (f) => fmt.num(f.otherProblems) ?? <NotMeasured />,
      sortType: 'num',
      sortValue: (f) => f.otherProblems,
      defaultDir: 'desc',
    },
    {
      key: 'last',
      label: 'Last problem',
      render: (f) => fmt.dateTime(f.lastProblemAt, DATE_FORMATS.usersLastLogin) ?? <NotMeasured />,
      sortType: 'date',
      sortValue: (f) => f.lastProblemAt,
      defaultDir: 'desc',
    },
  ];
}

export default function SufferingPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useSuffering();
  const items = useMemo(() => data?.data ?? [], [data]);
  const contacts = useFarmContacts(useMemo(() => items.map((i) => i.farmId), [items]));
  const columns = useMemo(() => buildColumns(contacts), [contacts]);

  const lastRefreshed = metaRefreshedAt(data?.meta);
  const checkedAt =
    fmt.dateTime(lastRefreshed, DATE_FORMATS.usersLastLogin) ?? 'a time the server did not report';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
            <Frown size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
            Farmer Suffering Watchlist
          </h1>
          <p className="mt-1 max-w-[var(--text-measure)] text-body text-text-2">
            Farms that keep hitting problems: three or more in {WINDOW_WORDS}, on requests that
            named the farm.
          </p>
        </div>
        <FreshnessChip source="live-aggregated" lastRefreshed={lastRefreshed} />
      </div>

      <div className="flex flex-col gap-2">
        <MetricLines metric="suffering-watchlist" />
        <MetricLines metric="suffering-areas" />
      </div>

      <DataList<SufferingItem>
        id="suffering"
        label="Farms with repeated problems"
        caption="Each farm with three or more problems in the last 7 days, the four areas they fall in, and the last problem."
        noun={{ one: 'farm', many: 'farms' }}
        rows={items}
        rowKey={(f) => f.farmId}
        columns={columns}
        defaultSort={{ key: 'problems', dir: 'desc' }}
        states={{
          isLoading,
          isFetching,
          error: isError ? error : null,
          onRetry: () => void refetch(),
          measuredZero: {
            what: `No farm has repeated problems in ${WINDOW_WORDS}`,
            checkedAt,
          },
        }}
        skeleton={{ rows: 6, cells: 7 }}
      />
    </div>
  );
}
