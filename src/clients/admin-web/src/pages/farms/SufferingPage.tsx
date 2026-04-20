import { Frown } from 'lucide-react';
import { format } from 'date-fns';
import { useSuffering } from '@/hooks/useFarms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

export default function SufferingPage() {
  const { data, isLoading } = useSuffering();
  const items = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#ea580c] to-danger text-white shadow-[0_4px_12px_rgba(234,88,12,0.35)]"><Frown size={18} strokeWidth={2.5}/></span>
          Farmer Suffering Watchlist
        </h1>
        <FreshnessChip source="live-aggregated" lastRefreshed={data?.meta?.lastRefreshed} />
      </div>
      <p className="text-sm text-text-muted px-1">Farms hitting repeated API errors in the last 24h. Drill into a farm to see error details.</p>
      <Card>
        <CardHeader>
          <CardTitle><span className="inline-grid h-6 w-6 place-items-center rounded-[7px] text-white bg-gradient-to-br from-[#ea580c] to-danger"><Frown size={14} strokeWidth={2.5}/></span>{items.length} farms suffering</CardTitle>
          <FreshnessChip source="live-aggregated" lastRefreshed={data?.meta?.lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading&&<div className="flex flex-col gap-2">{Array.from({length:5}).map((_,i)=><div key={i} className="h-9 animate-pulse rounded bg-surface-sidebar"/>)}</div>}
          {!isLoading&&!items.length&&<div className="py-10 text-center text-sm text-text-muted">No farms with repeated errors — great!</div>}
          {!isLoading&&!!items.length&&(
            <table className="w-full text-sm">
              <thead><tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                {['Farm','Total Errors','Sync','Logs','Voice','Last Error'].map(h=><th key={h} className="py-2 pr-4 first:pl-0">{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((f,i)=>(
                  <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                    <td className="py-2.5 pr-4 font-semibold text-text-primary">{f.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-[17px] font-extrabold text-danger">{f.errorCount}</td>
                    <td className="py-2.5 pr-4 font-mono text-[13px] text-text-muted">{f.syncErrors}</td>
                    <td className="py-2.5 pr-4 font-mono text-[13px] text-text-muted">{f.logErrors}</td>
                    <td className="py-2.5 pr-4 font-mono text-[13px] text-text-muted">{f.voiceErrors}</td>
                    <td className="py-2.5 font-mono text-[12px] text-text-muted">{format(new Date(f.lastErrorAt),'HH:mm, dd MMM')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
