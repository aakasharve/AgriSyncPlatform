import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Home as HomeIcon,
  Zap,
  AlertTriangle,
  Mic,
  Star,
  Wheat,
  TrendingDown,
  Frown,
  Calendar,
  Users as UsersIcon,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useAdminAuth } from './AdminAuthProvider';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  badge?: number;
  shortcut?: string;
  group: 'Overview' | 'Operations' | 'Product' | 'Farms' | 'Schedules' | 'Admin';
  iconColor?: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', Icon: HomeIcon, group: 'Overview', shortcut: '⌘1' },
  { to: '/ops/live', label: 'Live Health', Icon: Zap, group: 'Operations', shortcut: '⌘2' },
  { to: '/ops/errors', label: 'API Errors', Icon: AlertTriangle, group: 'Operations', iconColor: '#d60000' },
  { to: '/ops/voice', label: 'Voice Pipeline', Icon: Mic, group: 'Operations' },
  { to: '/metrics/nsm', label: 'WVFD', Icon: Star, group: 'Product', iconColor: '#f59e0b' },
  { to: '/farms', label: 'All Farms', Icon: Wheat, group: 'Farms', shortcut: '⌘F' },
  { to: '/farms/silent-churn', label: 'Silent Churn', Icon: TrendingDown, group: 'Farms', iconColor: '#dc2626' },
  { to: '/farms/suffering', label: 'Suffering', Icon: Frown, group: 'Farms', iconColor: '#ea580c' },
  { to: '/schedules/templates', label: 'Templates', Icon: Calendar, group: 'Schedules' },
  { to: '/users', label: 'Users', Icon: UsersIcon, group: 'Admin' },
  { to: '/settings/admins', label: 'Settings', Icon: SettingsIcon, group: 'Admin' },
];

const GROUP_ORDER: NavItem['group'][] = ['Overview', 'Operations', 'Product', 'Farms', 'Schedules', 'Admin'];

export function AdminShell() {
  const { mode, toggleMode } = useTheme();
  const { session } = useAdminAuth();
  const location = useLocation();

  const crumb = humanizePath(location.pathname);

  return (
    <div className="relative z-10 mx-auto max-w-[1760px] px-8 py-8">
      <div className="glass overflow-hidden rounded-2xl">
        <header className="flex h-14 items-center justify-between border-b border-surface-border bg-surface-sidebar px-5">
          <div className="text-[13px] font-semibold text-text-muted">
            <span className="font-extrabold text-text-primary">{crumb}</span>
          </div>
          <div className="flex items-center gap-3 text-[13px] text-text-secondary">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-surface-border bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-text-primary dark:bg-white/10">
              <Search size={12} /> <kbd className="font-mono">⌘K</kbd>
            </span>
            <button
              type="button"
              onClick={toggleMode}
              aria-label="Toggle dark mode"
              className="grid h-8 w-8 place-items-center rounded-md border border-surface-border bg-white/60 text-text-primary transition-colors hover:bg-white/90 dark:bg-white/10 dark:hover:bg-white/20"
            >
              {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-green to-brand-teal text-[11px] font-bold text-white shadow-[0_3px_10px_rgba(0,200,83,0.4)]">
              {initialsOf(session?.displayName, session?.phone)}
            </div>
          </div>
        </header>

        <div className="grid min-h-[640px] grid-cols-[240px_1fr]">
          <aside className="glass-sidebar p-4">
            {GROUP_ORDER.map((group) => {
              const items = NAV.filter((n) => n.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="mb-1">
                  <div className="px-2.5 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-[0.09em] text-brand-leaf dark:text-brand-mint">
                    {group}
                  </div>
                  {items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'mb-0.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold text-text-primary transition-colors',
                          isActive
                            ? 'nav-active font-extrabold'
                            : 'hover:bg-[color-mix(in_oklab,var(--color-brand-mint)_25%,transparent)]'
                        )
                      }
                    >
                      <span style={{ color: n.iconColor }}>
                        <n.Icon size={18} strokeWidth={2.2} />
                      </span>
                      <span>{n.label}</span>
                      {n.shortcut && (
                        <span className="ml-auto rounded border border-surface-border bg-white/70 px-1.5 py-0.5 font-mono text-[11px] font-bold text-text-muted dark:bg-white/10 dark:text-text-secondary">
                          {n.shortcut}
                        </span>
                      )}
                      {typeof n.badge === 'number' && (
                        <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-[11px] font-extrabold text-white shadow-[0_2px_6px_rgba(239,68,68,0.4)]">
                          {n.badge}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </aside>

          <main className="overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function humanizePath(path: string): string {
  if (path === '/') return 'Home';
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(' / ');
}

function initialsOf(name?: string | null, phone?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  }
  if (phone) return phone.slice(-2);
  return 'AK';
}
