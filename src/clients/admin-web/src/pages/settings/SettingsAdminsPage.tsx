import { ShieldCheck, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

const SEEDED_ADMINS = [
  { userId: '00000000-0000-0000-0000-000000000099', phone: '0000000000', note: 'Seeded admin (config)' },
];

export default function SettingsAdminsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-green to-brand-teal text-white shadow-[0_4px_12px_rgba(0,200,83,0.35)]">
            <ShieldCheck size={18} strokeWidth={2.5}/>
          </span>
          Admin Users
        </h1>
      </div>

      <div className="glass-panel border-l-4 border-l-brand-teal p-4 flex gap-3">
        <Info size={18} className="flex-shrink-0 text-brand-teal mt-0.5" strokeWidth={2.5}/>
        <div className="text-sm text-text-secondary">
          <p className="font-semibold text-text-primary mb-1">Admin management in Phase 6</p>
          <p>Admin IDs are currently read from <code className="font-mono bg-surface-sidebar px-1 py-0.5 rounded text-[11px]">appsettings.Admins[]</code>.
          Full DB-backed admin management (add/remove via UI, <code className="font-mono bg-surface-sidebar px-1 py-0.5 rounded text-[11px]">ssf.admin_users</code> table,
          IAdminResolver union config+DB, audit events) is implemented in Phase 6 of the plan.
          The migration and IAdminResolver are ready — run the migration to activate.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-grid h-6 w-6 place-items-center rounded-[7px] text-white bg-gradient-to-br from-brand-green to-brand-teal"><ShieldCheck size={14} strokeWidth={2.5}/></span>
            Current Admins (from config)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-row-divider text-left text-[11px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
              {['User ID','Phone','Source','Status'].map(h=><th key={h} className="py-2 pr-4">{h}</th>)}
            </tr></thead>
            <tbody>
              {SEEDED_ADMINS.map(a=>(
                <tr key={a.userId} className="border-b border-row-divider last:border-0">
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-text-primary">{a.userId}</td>
                  <td className="py-2.5 pr-4 font-mono text-[13px] font-semibold text-text-primary">{a.phone}</td>
                  <td className="py-2.5 pr-4 text-[12px] text-text-muted">{a.note}</td>
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[11px] font-bold text-brand-leaf">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-green"/>Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
