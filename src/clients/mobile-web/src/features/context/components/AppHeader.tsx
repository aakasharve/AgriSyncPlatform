/**
 * AppHeader — Android Material top app bar
 * Solid surface, clean elevation, no glassmorphism
 */

import React from 'react';
import { User2, Settings, Leaf } from 'lucide-react';
import { AppRoute, PageView } from '../../../types';
import PageToggle from '../../../shared/components/ui/PageToggle';
import { useLanguage } from '../../../i18n/LanguageContext';

import { FarmOperator } from '../../../domain/types/farm.types';

interface AppHeaderProps {
  currentRoute: AppRoute;
  currentView: PageView;
  onNavigate: (route: AppRoute) => void;
  onViewChange: (view: PageView) => void;
  disabled?: boolean;
  activeOperator?: FarmOperator;
  onVoiceTrigger?: () => void;
}

const getUserColor = (name: string) => {
  const colors = [
    'border-emerald-500 text-emerald-600 bg-emerald-50',
    'border-blue-500 text-blue-600 bg-blue-50',
    'border-purple-500 text-purple-600 bg-purple-50',
    'border-amber-500 text-amber-600 bg-amber-50',
    'border-rose-500 text-rose-600 bg-rose-50',
    'border-cyan-500 text-cyan-600 bg-cyan-50',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const AppHeader: React.FC<AppHeaderProps> = ({
  currentRoute,
  currentView,
  onNavigate,
  onViewChange,
  disabled,
  activeOperator,
  onVoiceTrigger
}) => {
  const { t } = useLanguage();

  const userColorClass = activeOperator ? getUserColor(activeOperator.name) : 'border-stone-200 text-stone-500 bg-stone-50';

  return (
    <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur" style={{ boxShadow: '0 4px 12px -2px rgba(0,0,0,0.06), 0 1px 0 rgba(0,0,0,0.04)' }}>
      <div className="page-content pl-safe-area pr-safe-area flex min-h-[56px] items-center justify-between gap-3 py-2">

        {/* LEFT: Profile / User Identity */}
        <button
          onClick={() => onNavigate('profile')}
          disabled={disabled}
          className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center rounded-2xl px-1 py-1"
          title={activeOperator ? activeOperator.name : t('header.profile')}
        >
          <div className={`
             w-9 h-9 flex items-center justify-center rounded-full border-2 transition-all duration-150
             ${activeOperator ? userColorClass : 'border-transparent bg-stone-100 text-stone-400'}
          `}>
            <User2 size={18} strokeWidth={2.5} />
          </div>
          {activeOperator && (
            <span className="text-[9px] font-bold text-stone-600 max-w-[60px] truncate leading-tight mt-0.5">
              {activeOperator.name.split(' ')[0]}
            </span>
          )}
        </button>

        {/* CENTER: Toggle (Visible on all core pages) */}
        <div className="flex-1 flex items-center justify-center">
          {['main', 'schedule', 'procurement', 'income', 'profile', 'settings', 'finance-manager', 'finance-ledger', 'finance-price-book', 'finance-review-inbox', 'finance-reports', 'finance-settings'].includes(currentRoute) ? (
            <div className="w-full max-w-[220px]">
              <PageToggle
                view={currentView}
                onChange={(v) => {
                  onViewChange(v);
                  if (currentRoute !== 'main') onNavigate('main');
                }}
                disabled={disabled}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                <Leaf size={16} fill="white" strokeWidth={0} />
              </div>
              <span className="font-bold text-lg text-stone-800">ShramSafal</span>
              {activeOperator && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-stone-100/50 border border-stone-200 rounded-full">
                  <span className="text-[10px] uppercase font-bold text-stone-500 tracking-wide">Owner</span>
                  <span className="text-xs font-bold text-stone-700">{activeOperator.name.split(' ')[0]}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Voice & Settings */}
        <div className="flex items-center gap-1">
          {/* Phase 4: Global Voice Trigger (Moved to Header) */}
          {onVoiceTrigger && !disabled && (
            <button
              onClick={onVoiceTrigger}
              className="w-11 h-11 flex items-center justify-center rounded-full text-emerald-600 bg-emerald-50 active:bg-emerald-100 transition-colors duration-150"
              title={t('nav.voice')}
            >
              <User2 size={0} className="hidden" /> {/* Hack to keep import valid if unused, but we use Lucide icons */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          )}

          <button
            onClick={() => onNavigate('settings')}
            disabled={disabled}
            className={`
              w-11 h-11 flex items-center justify-center rounded-full transition-colors duration-150
              ${currentRoute === 'settings'
                ? 'bg-emerald-100 text-emerald-700'
                : 'text-stone-500 active:bg-stone-100'}
            `}
          >
            <Settings size={22} strokeWidth={2} />
          </button>
        </div>

      </div>
    </header>
  );
};

export default AppHeader;
