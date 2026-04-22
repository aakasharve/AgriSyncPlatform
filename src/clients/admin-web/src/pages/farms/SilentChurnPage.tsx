import { TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { useSilentChurn } from '@/hooks/useFarms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

export default function SilentChurnPage() {
  const { data, isLoading } = useSilentChurn();
  const items = data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-danger to-warning text-white shadow-[0_4px_12px_rgba(220,38,38,0.35)]"><TrendingDown size={18} strokeWidth={2.5}/></span>
          Silent Churn Watchlist
        </h1>
        <FreshnessChip source="materialized" lastRefreshed={data?.meta?.lastRefreshed} />
      </div>
      <p className="text-sm text-text-muted px-1">Paid farms with WVFD = 0 for 2+ consecutive weeks. Act before renewal.</p>
      <Card>
        <CardHeader>
          <CardTitle><span className="inline-grid h-6 w-6 place-items-center rounded-[7px] text-white bg-gradient-to-br from-danger to-warning"><TrendingDown size={14} strokeWidth={2.5}/></span>{items.length} farms at risk</CardTitle>
          <FreshnessChip source="materialized" lastRefreshed={data?.meta?.lastRefreshed} />
        </CardHeader>
        <CardContent>
          {isLoading&&<div className="flex flex-col gap-2">{Array.from({length:5}).map((_,i)=><div key={i} className="h-9 animate-pulse rounded bg-surface-sidebar"/>)}</div>}
          {!isLoading&&!items.length&&<div className="py-10 text-center text-sm text-text-muted">No farms in silent churn</div>}
          {!isLoading&&!!items.length&&(
            <table className="w-full text-sm">
              <thead><tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
                {['Farm','Phone','Plan','Weeks Silent','Last Log'].map(h=><th key={h} className="py-2 pr-4 first:pl-0">{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((f,i)=>(
                  <tr key={i} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                    <td className="py-2.5 pr-4 font-semibold text-text-primary">{f.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-[12px] text-text-muted">{f.ownerPhone}</td>
                    <td className="py-2.5 pr-4 text-[12px] text-text-muted">{f.plan}</td>
                    <td className="py-2.5 pr-4"><span className="font-mono text-[15px] font-extrabold text-danger">{f.weeksSilent}w</span></td>
                    <td className="py-2.5 font-mono text-[12px] text-text-muted">{f.lastLogAt?format(new Date(f.lastLogAt),'dd MMM yyyy'):'Never'}</td>
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
