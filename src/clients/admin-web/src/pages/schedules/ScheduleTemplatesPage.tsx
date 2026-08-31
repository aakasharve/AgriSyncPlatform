import { useQuery } from '@tanstack/react-query';
import { Calendar, CheckCircle, XCircle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { FreshnessChip } from '@/components/ui/FreshnessChip';

interface ScheduleTemplate {
  templateId: string; name: string; cropType: string; version: string;
  isPublished: boolean; taskCount: number; estimatedDurationDays: number;
}

export default function ScheduleTemplatesPage() {
  /*
   * The eleventh key of Task 12 Step 3 — and the plan calls it
   * `useScheduleTemplates`, a hook that does not exist. It is an inline
   * useQuery here; Task 24 extracts it. Only the key changes in this task, so
   * that a mechanical change cannot hide a behavioural one.
   *
   * The org is in the key. Whether this endpoint is org-scoped at all cannot
   * be settled from the repo today: the console asks for
   * `/shramsafal/reference-data/crop-schedule-templates` and the backend
   * publishes `/shramsafal/reference/schedule-templates`
   * (`ReferenceDataEndpoints.cs:14,16`), so this screen has been calling a
   * route that does not exist. Task 24 owns that. Until it is resolved the org
   * stays in the key: a redundant refetch on an org switch costs one request,
   * and the other way round costs a tenant boundary.
   */
  const org = useOrgKey();
  const { data: templates, isLoading } = useQuery<ScheduleTemplate[]>({
    queryKey: ['schedules', 'templates', org],
    queryFn: async () => {
      const { data } = await adminApi.get<ScheduleTemplate[]>('/shramsafal/reference-data/crop-schedule-templates');
      return data;
    },
    staleTime: 300_000,
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-text-primary">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(82,192,190,0.35)]"><Calendar size={18} strokeWidth={2.5}/></span>
          Schedule Templates
        </h1>
        <FreshnessChip source="materialized" />
      </div>

      {isLoading && (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({length:6}).map((_,i)=><div key={i} className="h-32 animate-pulse rounded-xl bg-surface-sidebar"/>)}
        </div>
      )}

      {!isLoading && !templates?.length && (
        <div className="glass-panel py-16 text-center text-sm text-text-muted">
          No schedule templates found. Create one via the farming app.
        </div>
      )}

      {!isLoading && !!templates?.length && (
        <div className="grid grid-cols-3 gap-4">
          {templates.map(t => (
            <Card key={t.templateId}>
              <CardHeader>
                <CardTitle>
                  <span className="inline-grid h-6 w-6 place-items-center rounded-[7px] text-white bg-gradient-to-br from-brand-teal to-brand-sky"><Calendar size={14} strokeWidth={2.5}/></span>
                  {t.name}
                </CardTitle>
                {t.isPublished
                  ? <CheckCircle size={16} className="text-brand-green" strokeWidth={2.5}/>
                  : <XCircle size={16} className="text-text-muted" strokeWidth={2.5}/>}
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted font-medium">Crop</span>
                    <span className="font-semibold text-text-primary">{t.cropType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted font-medium">Version</span>
                    <span className="font-mono text-[12px] font-bold text-text-primary">{t.version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted font-medium">Tasks</span>
                    <span className="font-mono text-[14px] font-bold text-text-primary">{t.taskCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted font-medium">Duration</span>
                    <span className="font-mono text-[12px] font-bold text-text-primary">{t.estimatedDurationDays}d</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold"
                    style={{color: t.isPublished ? 'var(--color-brand-green)' : 'var(--color-text-muted)'}}>
                    {t.isPublished ? <CheckCircle size={12}/> : <XCircle size={12}/>}
                    {t.isPublished ? 'Published' : 'Draft'}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
