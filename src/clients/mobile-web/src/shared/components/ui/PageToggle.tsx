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
    <div className="flex justify-center w-full px-1">
      <div className="bg-stone-100 p-1 rounded-xl flex w-full shadow-inner relative z-0">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              hapticFeedback.medium();
              onChange(item.key);
            }}
            disabled={disabled}
            className={`
              flex-1 flex items-center justify-center py-2 rounded-lg text-xs font-bold tracking-wide transition-all duration-200 relative z-10
              ${view === item.key
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 active:scale-95'}
            `}
          >
            <span className="mr-1.5">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default PageToggle;
