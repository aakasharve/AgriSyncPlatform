import { useEffect, useState, useCallback, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Zap, AlertTriangle, Mic, Star, Wheat, TrendingDown, Frown, Calendar, Users, Settings, Home } from 'lucide-react';

interface Command { id: string; label: string; path: string; icon: React.ReactNode; group: string; }

const COMMANDS: Command[] = [
  { id:'home',    label:'Home',              path:'/',                       icon:<Home size={16}/>,         group:'Navigate' },
  { id:'live',    label:'Live Health',       path:'/ops/live',               icon:<Zap size={16}/>,          group:'Operations' },
  { id:'errors',  label:'API Errors',        path:'/ops/errors',             icon:<AlertTriangle size={16}/>, group:'Operations' },
  { id:'voice',   label:'Voice Pipeline',    path:'/ops/voice',              icon:<Mic size={16}/>,          group:'Operations' },
  { id:'nsm',     label:'WVFD North Star',   path:'/metrics/nsm',            icon:<Star size={16}/>,         group:'Metrics' },
  { id:'farms',   label:'All Farms',         path:'/farms',                  icon:<Wheat size={16}/>,        group:'Farms' },
  { id:'churn',   label:'Silent Churn',      path:'/farms/silent-churn',     icon:<TrendingDown size={16}/>, group:'Farms' },
  { id:'suffer',  label:'Suffering Watchlist',path:'/farms/suffering',       icon:<Frown size={16}/>,        group:'Farms' },
  { id:'tpl',     label:'Schedule Templates',path:'/schedules/templates',    icon:<Calendar size={16}/>,     group:'Schedules' },
  { id:'users',   label:'Users',             path:'/users',                  icon:<Users size={16}/>,        group:'Admin' },
  { id:'admins',  label:'Admin Settings',    path:'/settings/admins',        icon:<Settings size={16}/>,     group:'Admin' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();

  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.group.toLowerCase().includes(query.toLowerCase())
  );

  const select = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
    setQuery('');
    setIdx(0);
  }, [navigate]);

  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  useEffect(() => { setIdx(0); }, [query]);

  if (!open) return null;

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, filtered.length-1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
    if (e.key === 'Enter' && filtered[idx]) select(filtered[idx].path);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]"
      onClick={()=>setOpen(false)}>
      <div className="glass-panel w-full max-w-xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-row-divider px-4 py-3">
          <Search size={16} className="flex-shrink-0 text-text-muted" strokeWidth={2.5}/>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages…"
            className="flex-1 bg-transparent text-[14px] font-semibold text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="font-mono text-[11px] text-text-muted bg-surface-sidebar px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="py-6 text-center text-sm text-text-muted">No pages match "{query}"</div>
          )}
          {filtered.map((c, i) => (
            <button key={c.id} onClick={()=>select(c.path)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] font-semibold transition-colors ${
                i === idx ? 'bg-surface-kpi text-text-primary' : 'text-text-primary hover:bg-surface-sidebar'
              }`}>
              <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-surface-sidebar text-text-muted">{c.icon}</span>
              <span className="flex-1">{c.label}</span>
              <span className="text-[11px] font-normal text-text-muted">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
