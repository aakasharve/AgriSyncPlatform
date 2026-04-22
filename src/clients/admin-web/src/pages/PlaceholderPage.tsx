import { Sprout } from 'lucide-react';

export interface PlaceholderPageProps {
  title: string;
  phase: string;
  bullets?: string[];
}

export default function PlaceholderPage({ title, phase, bullets = [] }: PlaceholderPageProps) {
  return (
    <div className="glass-panel flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-green via-brand-teal to-brand-sky text-white shadow-[0_6px_18px_rgba(0,200,83,0.3)]">
        <Sprout size={28} strokeWidth={2.5} />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-text-primary">{title}</h1>
      <div className="text-xs font-bold uppercase tracking-[0.15em] text-brand-leaf dark:text-brand-mint">
        Scheduled for {phase}
      </div>
      {bullets.length > 0 && (
        <ul className="mt-2 max-w-lg list-disc pl-5 text-left text-sm text-text-secondary">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
