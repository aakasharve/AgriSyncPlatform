/**
 * PageToggle — Android Material segmented button for Log/Reflect/Compare
 */

import React from 'react';
import { PageView } from '../../../types';
import { PenTool, BarChart3, ArrowRightLeft } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { hapticFeedback } from '../../../shared/utils/haptics';

interface PageToggleProps {
  view: PageView;
  onChange: (view: PageView) => void;
  disabled?: boolean;
}

const PageToggle: React.FC<PageToggleProps> = ({ view, onChange, disabled }) => {
  const { t } = useLanguage();

  const items: { key: PageView; label: string; icon: React.ReactNode }[] = [
    { key: 'log', label: t('header.log'), icon: <PenTool size={14} strokeWidth={2.5} /> },
    { key: 'reflect', label: t('header.reflect'), icon: <BarChart3 size={14} strokeWidth={2.5} /> },
    { key: 'compare', label: t('header.compare'), icon: <ArrowRightLeft size={14} strokeWidth={2.5} /> },
  ];

  return (
    // spec: owner-oversight-loop (Task 11) — the founder header restructure
    // leaves this component less room than before (row 1 also carries a
    // farm chip and a weather chip now). Two changes, MEASURED necessary
    // with a real Playwright render at 390×844 (task-11 report):
    //
    //  1. Padding tightened (outer `px-1` removed, icon-label gap
    //     `mr-1.5` -> `mr-1`, pill padding `p-1` -> `p-0.5`) — the
    //     task-11 brief's own explicitly-allowed compression option
    //     ("tighten the toggle's horizontal padding").
    //
    //  2. `min-w-0` + `truncate` on each button's label (below). Padding
    //     alone was not the real defect: these buttons had no `min-w-0`,
    //     so flexbox's default `min-width: auto` refused to shrink them
    //     below "REFLECT"/"COMPARE"'s own natural text width — the
    //     labels visually COLLIDED with each other regardless of how
    //     much padding was trimmed elsewhere in the header. `min-w-0`
    //     lets each button actually shrink to its allocated share;
    //     `truncate` makes that graceful (an ellipsis, never overlapping
    //     text) at any width row 1 ends up giving this component.
    //
    // Nothing else about this component changes; it renders identically
    // everywhere else it is used, and at its usual ~180-220px width
    // neither change is visible — no truncation actually fires there.
    <div className="flex justify-center w-full">
      <div className="bg-stone-100 p-0.5 rounded-xl flex w-full shadow-inner relative z-0">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              hapticFeedback.medium();
              onChange(item.key);
            }}
            disabled={disabled}
            className={`
              flex-1 min-w-0 flex items-center justify-center py-2 rounded-lg text-xs font-bold tracking-wide transition-all duration-200 relative z-10
              ${view === item.key
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 active:scale-95'}
            `}
          >
            <span className="mr-1 shrink-0">
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PageToggle;
