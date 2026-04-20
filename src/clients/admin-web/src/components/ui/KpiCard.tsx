import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTrend?: 'up' | 'down' | 'flat';
  icon?: ReactNode;
  iconColor?: string;
  note?: ReactNode;
  className?: string;
}

export function KpiCard({
  label,
  value,
  delta,
  deltaTrend = 'flat',
  icon,
  iconColor,
  note,
  className,
}: KpiCardProps) {
  return (
    <div className={cn('glass-kpi flex flex-col gap-2 p-5', className)}>
      {icon && (
        <div
          className="absolute right-3.5 top-3.5 grid h-[30px] w-[30px] place-items-center rounded-lg border"
          style={{
            color: iconColor ?? 'var(--color-brand-leaf)',
            background:
              'linear-gradient(135deg, color-mix(in oklab, var(--color-brand-mint) 35%, transparent), color-mix(in oklab, var(--color-brand-sky) 30%, transparent))',
            borderColor: 'var(--color-surface-border-strong)',
          }}
        >
          {icon}
        </div>
      )}
      <div className="pr-10 text-[13px] font-bold tracking-tight text-text-primary">{label}</div>
      <div className="font-mono text-[38px] font-extrabold leading-[1.05] tracking-[-0.04em] text-text-primary">
        {value}
      </div>
      {(delta || note) && (
        <div
          className={cn(
            'flex items-center gap-1 text-[13px] font-semibold',
            deltaTrend === 'up' && 'text-[#0b8a3a] dark:text-brand-green',
            deltaTrend === 'down' && 'text-[#b91c1c] dark:text-[#ff6b6b]',
            deltaTrend === 'flat' && 'text-text-secondary'
          )}
        >
          {delta && <span>{delta}</span>}
          {note && <span className="text-text-secondary">{note}</span>}
        </div>
      )}
    </div>
  );
}
