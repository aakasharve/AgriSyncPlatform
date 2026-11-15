/**
 * COMPANY MIS — one page component for the seven sections, in the console frame.
 *
 * The look is the approved combined look (25 Oct design inside the September
 * console). The numbers are the company answer from
 * `GET /shramsafal/admin/mis/company`, fetched once per chosen range and
 * shared by all seven pages (`useCompanyMis`, `misPeriod`). Nothing here
 * makes up a number: while the answer is loading, refused or failed, no tile
 * and no chart is drawn.
 */
import { useMemo, type ReactNode } from 'react';
import axios from 'axios';
import {
  Activity, AudioLines, CalendarRange, Download, LayoutDashboard, LifeBuoy, MapPinned, Repeat2,
  type LucideIcon,
} from 'lucide-react';
import { LoadFailed, LoadingState, NotMeasuredPanel } from '@/components/state';
import { classifyMisError, useCompanyMis, type CompanyMis } from '@/hooks/useCompanyMis';
import {
  MIS_MAX_DAYS, clampCustom, fmtIndiaTime, istToday, presetPeriod, resetMisPeriod, useMisCompare, useMisPeriod,
  type MisPreset,
} from './misPeriod';
import type { MisSectionKey } from './misItems';
import {
  acquisitionView, engagementView, farmsView, headlineFor, operationsView, overviewView, qualityView, rangeText, retentionView,
} from './misView';
import { cx, itemAttrs } from './MisUi';
import { OverviewSection } from './MisOverview';
import { AcquisitionSection } from './MisAcquisition';
import { EngagementSection } from './MisEngagement';
import { RetentionSection } from './MisRetention';
import { QualitySection } from './MisQuality';
import { FarmsSection } from './MisFarms';
import { OperationsSection } from './MisOperations';

const SECTIONS: Record<MisSectionKey, { label: string; icon: LucideIcon }> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  acquisition: { label: 'Acquisition', icon: Download },
  engagement: { label: 'Engagement', icon: Activity },
  retention: { label: 'Retention', icon: Repeat2 },
  quality: { label: 'Quality', icon: AudioLines },
  farms: { label: 'Farms & geography', icon: MapPinned },
  operations: { label: 'Operations', icon: LifeBuoy },
};

const PRESETS: { key: MisPreset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
];

const DAY_MS = 86_400_000;
function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function SectionBody({ section, data, compare }: { section: MisSectionKey; data: CompanyMis; compare: boolean }) {
  const checkedAt = fmtIndiaTime(data.countedAtUtc);
  switch (section) {
    case 'overview': return <OverviewSection view={overviewView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'acquisition': return <AcquisitionSection view={acquisitionView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'engagement': return <EngagementSection view={engagementView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'retention': return <RetentionSection view={retentionView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'quality': return <QualitySection view={qualityView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'farms': return <FarmsSection view={farmsView(data)} compare={compare} checkedAt={checkedAt} />;
    case 'operations': return <OperationsSection view={operationsView()} compare={compare} checkedAt={checkedAt} />;
  }
}

export default function MisPage({ section }: { section: MisSectionKey }) {
  const meta = SECTIONS[section];
  const [period, setPeriod] = useMisPeriod();
  const [compare, setCompare] = useMisCompare();
  const query = useCompanyMis(period);
  const data = query.data?.data ?? null;
  const today = istToday();

  const sentence = useMemo(() => headlineFor(section, data, compare), [section, data, compare]);
  const problem = query.isError ? classifyMisError(query.error) : null;
  /* A 401 is the console's to handle: its interceptor has cleared the session
     and is opening the sign-in screen. Nothing is drawn meanwhile. */
  const signedOut = query.isError && axios.isAxiosError(query.error) && query.error.response?.status === 401;

  const Icon = meta.icon;

  const pickPreset = (p: MisPreset) => {
    if (p === 'custom') setPeriod(clampCustom(period.from, period.to, istToday()));
    else setPeriod(presetPeriod(p, istToday()));
  };

  const shownRange = data
    ? `${rangeText(data.range)}${compare ? `, compared with ${rangeText(data.previousRange)}` : ''}`
    : rangeText({ from: period.from, to: period.to, days: 0 });

  let body: ReactNode;
  if (signedOut) body = null;
  else if (query.isPending) body = <LoadingState label="Counting the company numbers" />;
  else if (problem?.kind === 'denied') {
    body = <NotMeasuredPanel title="Not shown to this account" why={`${problem.message} ${problem.remedy}`} />;
  } else if (problem?.kind === 'badRange') {
    body = <LoadFailed error={problem.message} what="these numbers" onRetry={() => resetMisPeriod()} />;
  } else if (problem) {
    body = <LoadFailed error={problem.message} what="the company numbers" onRetry={() => { void query.refetch(); }} />;
  } else if (data) {
    body = <SectionBody section={section} data={data} compare={compare} />;
  } else {
    body = null;
  }

  const headlineItem = `${section}.headline`;

  return (
    <div className="mx-auto max-w-[1360px] text-stone-900" data-testid="mis-dashboard">
      {/* The 25 Oct filter row: one date range and one compare switch that scope every number below.
          It stays in view under the console's top bar while the page scrolls. */}
      <div className="sticky top-[calc(var(--spacing-topbar)+8px)] z-10 mb-7 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_10px_28px_-18px_rgba(28,25,23,0.18)] ring-1 ring-stone-200/80 backdrop-blur-md">
        <div role="group" aria-label="Date range" className="inline-flex rounded-xl bg-stone-100 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p.key)}
              aria-pressed={period.preset === p.key}
              className={cx(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                period.preset === p.key ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-white hover:text-stone-900',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period.preset === 'custom' && (
          <div className="flex items-center gap-2 text-[13px] text-stone-600">
            <label className="flex items-center gap-1.5">
              From
              <input
                type="date"
                className="rounded-lg border-0 bg-white px-2 py-1.5 text-[13px] text-stone-900 ring-1 ring-stone-200"
                value={period.from}
                min={shiftIso(period.to, -(MIS_MAX_DAYS - 1))}
                max={period.to}
                onChange={(e) => { if (e.target.value) setPeriod(clampCustom(e.target.value, period.to, istToday())); }}
              />
            </label>
            <label className="flex items-center gap-1.5">
              To
              <input
                type="date"
                className="rounded-lg border-0 bg-white px-2 py-1.5 text-[13px] text-stone-900 ring-1 ring-stone-200"
                value={period.to}
                min={period.from}
                max={today}
                onChange={(e) => { if (e.target.value) setPeriod(clampCustom(period.from, e.target.value, istToday())); }}
              />
            </label>
          </div>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={compare}
          onClick={() => setCompare(!compare)}
          className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] text-stone-700"
        >
          <span aria-hidden className={cx('relative h-5 w-9 rounded-full transition-colors', compare ? 'bg-emerald-700' : 'bg-stone-300')}>
            <span className={cx('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', compare ? 'translate-x-[18px]' : 'translate-x-0.5')} />
          </span>
          Compare with previous period
        </button>
        {data && (
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-stone-500">
            <span data-testid="mis-counted-at">Counted at {fmtIndiaTime(data.countedAtUtc)}</span>
            <span data-testid="mis-test-accounts">{data.excludedTestAccounts} {data.excludedTestAccounts === 1 ? 'test account' : 'test accounts'} left out</span>
          </div>
        )}
      </div>

      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-h1 font-bold text-text-1">
          <Icon size={20} strokeWidth={2} aria-hidden="true" className="text-text-2" />
          {meta.label}
        </h1>
        {sentence && (data || section === 'operations') && !problem && (
          <p className="mt-2 max-w-[72ch] text-[17px] leading-relaxed text-stone-700" data-testid="mis-headline" {...itemAttrs(headlineItem)}>
            {sentence}
          </p>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-stone-500">
          <CalendarRange size={14} aria-hidden />
          <span data-testid="mis-range-label">{shownRange}</span>
          {period.preset === 'custom' && <span className="text-stone-400">(custom ranges can span up to {MIS_MAX_DAYS} days)</span>}
        </p>
      </header>

      {body}
    </div>
  );
}
