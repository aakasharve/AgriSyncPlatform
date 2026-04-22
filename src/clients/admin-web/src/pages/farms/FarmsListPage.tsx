import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Wheat, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useFarmsList } from '@/hooks/useFarms';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { Button } from '@/components/ui/Button';

const TIER_COLORS: Record<string, string> = { A:'#00c853', B:'#52c0be', C:'#f59e0b', D:'#dc2626' };
const TIERS = ['A','B','C','D'];
const PAGE_SIZE = 40;

export default function FarmsListPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const page = Number(sp.get('page') ?? 1);
  const search = sp.get('search') ?? undefined;
  const tier = sp.get('tier') ?? undefined;
  const [draft, setDraft] = useState(search ?? '');

  const { data, isLoading, isFetching } = useFarmsList(page, PAGE_SIZE, search, tier);
  const items = data?.data?.items ?? [];
  const total = data?.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applySearch() { setSp(p => { draft ? p.set('search', draft) : p.delete('search'); p.set('page','1'); return p; }); }
  function setTier(t: string) { setSp(p => { t===tier ? p.delete('tier') : p.set('tier', t); p.set('page','1'); return p; }); }
  function setPage(p: number) { setSp(prev => { prev.set('page', String(p)); return prev; }); }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-green to-brand-leaf text-white shadow-[0_4px_12px_rgba(50,145,40,0.4)]"><Wheat size={18} strokeWidth={2.5}/></span>
          All Farms
        </h1>
        <FreshnessChip source="live-aggregated" lastRefreshed={data?.meta?.lastRefreshed} />
      </div>

      <div className="flex flex-wrap gap-3">
        <input type="text" value={draft} onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&applySearch()}
          placeholder="Search by name…"
          className="w-64 rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-brand-teal" />
        <Button variant="outline" size="sm" onClick={applySearch}>Search</Button>
        <div className="flex gap-1.5">
          {TIERS.map(t => (
            <button key={t} onClick={()=>setTier(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold border transition-colors ${tier===t ? 'text-white border-transparent' : 'border-surface-border text-text-muted hover:bg-surface-sidebar'}`}
              style={tier===t ? {background: TIER_COLORS[t]} : {}}>
              Tier {t}
            </button>
          ))}
        </div>
        <span className="ml-auto self-center text-sm text-text-muted">
          {isFetching?'Refreshing…':`${total.toLocaleString()} farms`}
        </span>
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
              {['Farm','Owner','Tier','WVFD 7d','Errors 24h','Last Log','Created'].map(h=><th key={h} className="py-3 pr-4 first:pl-4">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({length:8}).map((_,i)=>(
              <tr key={i} className="border-b border-row-divider">
                {Array.from({length:7}).map((_,j)=>(<td key={j} className="py-2.5 pr-4 first:pl-4"><div className="h-4 animate-pulse rounded bg-surface-sidebar"/></td>))}
              </tr>
            ))}
            {!isLoading&&!items.length&&(
              <tr><td colSpan={7} className="py-16 text-center text-sm text-text-muted">No farms found</td></tr>
            )}
            {items.map(f=>(
              <tr key={f.farmId} onClick={()=>navigate(`/farms/${f.farmId}`)}
                className="cursor-pointer border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                <td className="py-2.5 pl-4 pr-4 font-semibold text-text-primary">{f.name}</td>
                <td className="py-2.5 pr-4 font-mono text-[12px] text-text-muted">{f.ownerPhone}</td>
                <td className="py-2.5 pr-4">
                  {f.engagementTier ? (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{background: TIER_COLORS[f.engagementTier]??'#888'}}>
                      {f.engagementTier}
                    </span>
                  ) : <span className="text-text-muted">—</span>}
                </td>
                <td className="py-2.5 pr-4 font-mono text-[13px] font-bold text-text-primary">{f.wvfd7d?.toFixed(1) ?? '—'}</td>
                <td className={`py-2.5 pr-4 font-mono text-[13px] font-bold ${f.errors24h>0?'text-danger':'text-text-muted'}`}>{f.errors24h||'—'}</td>
                <td className="py-2.5 pr-4 font-mono text-[11px] text-text-muted">{f.lastLogAt?format(new Date(f.lastLogAt),'dd MMM'):'—'}</td>
                <td className="py-2.5 pr-4 font-mono text-[11px] text-text-muted">{format(new Date(f.createdAt),'dd MMM yy')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages>1&&(
        <div className="flex items-center justify-between px-1">
          <Button variant="outline" size="sm" disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={14}/> Prev</Button>
          <span className="text-sm font-semibold text-text-muted">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page>=totalPages} onClick={()=>setPage(page+1)}>Next <ChevronRight size={14}/></Button>
        </div>
      )}
    </div>
  );
}
