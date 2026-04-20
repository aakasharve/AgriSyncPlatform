import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useUsersList } from '@/hooks/useUsers';
import { FreshnessChip } from '@/components/ui/FreshnessChip';
import { Button } from '@/components/ui/Button';

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const search = sp.get('search') ?? undefined;
  const [draft, setDraft] = useState(search ?? '');

  const { data, isLoading, isFetching } = useUsersList(page, PAGE_SIZE, search);
  const items = data?.data?.items ?? [];
  const total = data?.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applySearch() { setSp(p => { draft ? p.set('search', draft) : p.delete('search'); p.set('page','1'); return p; }); }
  function setPage(p: number) { setSp(prev => { prev.set('page', String(p)); return prev; }); }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#0ea5e9] to-brand-teal text-white shadow-[0_4px_12px_rgba(14,165,233,0.35)]"><Users size={18} strokeWidth={2.5}/></span>
          Users
        </h1>
        <FreshnessChip source="live" lastRefreshed={data?.meta?.lastRefreshed} />
      </div>

      <div className="flex gap-3">
        <input type="text" value={draft} onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&applySearch()}
          placeholder="Search phone or name…"
          className="w-64 rounded-md border-2 border-surface-border bg-surface-kpi px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-brand-teal"/>
        <Button variant="outline" size="sm" onClick={applySearch}>Search</Button>
        <span className="ml-auto self-center text-sm text-text-muted">{isFetching?'Refreshing…':`${total.toLocaleString()} users`}</span>
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
              {['Phone','Name','Email','Apps','Created','Last Login'].map(h=><th key={h} className="py-3 pr-4 first:pl-4">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading&&Array.from({length:8}).map((_,i)=>(
              <tr key={i} className="border-b border-row-divider">
                {Array.from({length:6}).map((_,j)=><td key={j} className="py-2.5 pr-4 first:pl-4"><div className="h-4 animate-pulse rounded bg-surface-sidebar"/></td>)}
              </tr>
            ))}
            {!isLoading&&!items.length&&<tr><td colSpan={6} className="py-16 text-center text-sm text-text-muted">No users found</td></tr>}
            {items.map(u=>(
              <tr key={u.userId} className="border-b border-row-divider last:border-0 hover:bg-surface-sidebar">
                <td className="py-2.5 pl-4 pr-4 font-mono text-[13px] font-semibold text-text-primary">{u.phone}</td>
                <td className="py-2.5 pr-4 font-semibold text-text-primary">{u.displayName??'—'}</td>
                <td className="py-2.5 pr-4 text-[12px] text-text-muted">{u.email??'—'}</td>
                <td className="py-2.5 pr-4">
                  {u.apps?.length ? u.apps.map(a=><span key={a} className="mr-1 inline-block rounded bg-surface-sidebar px-1.5 py-0.5 text-[10px] font-bold text-text-muted">{a}</span>) : <span className="text-text-muted">—</span>}
                </td>
                <td className="py-2.5 pr-4 font-mono text-[11px] text-text-muted">{format(new Date(u.createdAt),'dd MMM yy')}</td>
                <td className="py-2.5 font-mono text-[11px] text-text-muted">{u.lastLoginAt?format(new Date(u.lastLoginAt),'dd MMM yy, HH:mm'):'—'}</td>
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
