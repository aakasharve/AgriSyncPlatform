/**
 * PageToggle — Android Material segmented button for Log/Reflect/Compare
 */

import React from 'react';
import { PageView } from '../../../types';
import { useLanguage } from '../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../shared/utils/haptics';

interface PageToggleProps {
  view: PageView;
  onChange: (view: PageView) => void;
  disabled?: boolean;
}

const PageToggle: React.FC<PageToggleProps> = ({ view, onChange, disabled }) => {
  const { t } = useLanguage();

  const items: { key: PageView; label: string }[] = [
    { key: 'log', label: t('header.log') },
    { key: 'reflect', label: t('header.reflect') },
    { key: 'compare', label: t('header.compare') },
  ];

  return (
    // spec: owner-oversight-loop (Task 12 — founder-approved header
    // "Variation B", `G:\VALIDATION\farm-selector-contextual.html`'s
    // `.tog`/`.tog span.on` rules). Task 11's filled-pill active state is
    // GONE: "The Log/Reflect/Compare toggle loses its filled pill. Active
    // tab = emerald text plus a short 2.5px emerald underline centred
    // beneath it (18px wide, rounded). Inactive = text-stone-400, plain.
    // No background on any tab." Two greens (the pill AND the farm chip)
    // were competing for the same "this is active/mine" meaning — spec
    // §P-G reserves emerald for identity, so only ONE emerald signal
    // (the underline) survives per tab.
    //
    // `min-w-0` + `truncate` (Task 11, still load-bearing): flexbox's
    // default `min-width: auto` would otherwise refuse to shrink a button
    // below its label's natural width, colliding at 390px.
    //
    // MEASURED (task-12 report): the reference's own `.tog span` markup
    // carries NO icon, text only — a real Playwright render at 390×844
    // confirmed why: with row 1 also carrying the founder's now-required
    // full farm name + plot count (Task 12, `FarmIdentityElement`), the
    // multi-farm case leaves this toggle only ~120px, and each icon+gap
    // was consuming ~18px of that for zero readability gain — "विश्लेषण"/
    // "REFLECT" were truncating to 1-2 characters. Dropping the icon (per
    // the reference, not invented here) recovers ~54px total and matches
    // `G:\VALIDATION\farm-selector-contextual.html` exactly, which never
    // had one.
    <div className="flex w-full justify-center">
      <div className="flex w-full justify-center gap-0.5">
        {items.map((item) => {
          const isActive = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                hapticFeedback.medium();
                onChange(item.key);
              }}
              disabled={disabled}
              className={`relative flex min-w-0 flex-1 items-center justify-center px-[2px] py-[7px] text-[10.5px] font-bold tracking-normal transition-colors duration-200 ${
                isActive ? 'text-emerald-700' : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              <span className="truncate">{item.label}</span>
              {isActive && (
                <span
                  aria-hidden="true"
                  data-testid="page-toggle-active-underline"
                  className="absolute bottom-0 left-1/2 h-[2.5px] w-[18px] -translate-x-1/2 rounded-full bg-emerald-600"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PageToggle;
