/**
 * BottomNavigation — Android Material 3 bottom navigation bar
 * Standard flat layout, no SVG curves, no glows
 */

import React from 'react';
import { FlaskConical } from 'lucide-react';
import { AppRoute, PageView } from '../../../types';
import { hapticFeedback } from '../../../shared/utils/haptics';
import { useLanguage } from '../../../i18n/LanguageContext';

interface BottomNavigationProps {
    currentRoute: AppRoute;
    currentView: PageView;
    onNavigate: (route: AppRoute) => void;
    onViewChange: (view: PageView) => void;
    hidden?: boolean;
}


const BottomNavigation: React.FC<BottomNavigationProps> = ({ currentRoute, currentView, onNavigate, onViewChange, hidden = false }) => {
    const { t } = useLanguage();

    const handleNavClick = (route: AppRoute) => {
        hapticFeedback.medium();
        onNavigate(route);
    };

    const isActive = (route: AppRoute) => currentRoute === route;

    return (
        <nav className={`fixed bottom-0 left-0 right-0 z-50 border-t border-stone-100 bg-white/95 pb-safe-area backdrop-blur-md shadow-[0_-8px_24px_-4px_rgba(0,0,0,0.10)] transition-all duration-200 ${hidden ? 'pointer-events-none translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
            <div aria-hidden="true" className="pointer-events-none absolute -top-8 left-0 right-0 h-8 bg-gradient-to-b from-transparent to-[rgba(250,250,249,0.92)]" />
            <div className="page-content pl-safe-area pr-safe-area flex h-[80px] items-end justify-center pb-2">

                {/* ATTENTION SECTION */}
                <button
                    onClick={() => handleNavClick('attention')}
                    className={`
                        flex w-16 flex-col items-center justify-end pb-1 transition-all duration-200 group
                    `}
                >
                    <div className={`
                        mb-1 rounded-2xl px-2 py-1 transition-all duration-200
                        ${isActive('attention') ? 'bg-emerald-100' : ''}
                    `}>
                        <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={isActive('attention') ? '#059669' : '#78716c'}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <span className={`text-[10px] tracking-tight ${isActive('attention') ? 'font-extrabold text-emerald-700' : 'font-bold text-stone-700'}`}>
                        Attention
                    </span>
                    <span className={`mt-1 h-1 w-1 rounded-full bg-emerald-600 transition-opacity ${isActive('attention') ? 'opacity-100' : 'opacity-0'}`} />
                </button>

                {/* PROCUREMENT SECTION */}
                <button
                    data-testid="procurement-nav-btn"
                    onClick={() => handleNavClick('procurement')}
                    className={`
                        flex w-20 flex-col items-center justify-end pb-1 transition-all duration-200 group
                    `}
                >
                    <div className={`
                        mb-1 rounded-2xl px-3 py-1 transition-all duration-200
                        ${isActive('procurement') ? 'bg-emerald-100' : ''}
                    `}>
                        <img
                            src="/assets/Procurement_rb.png"
                            alt="Procure"
                            className={`w-9 h-9 object-contain`}
                        />
                    </div>
                    <span className={`text-[10px] tracking-tight ${isActive('procurement') ? 'font-extrabold text-emerald-700' : 'font-bold text-stone-700'}`}>
                        {t('nav.procure')}
                    </span>
                    <span className={`mt-1 h-1 w-1 rounded-full bg-emerald-600 transition-opacity ${isActive('procurement') ? 'opacity-100' : 'opacity-0'}`} />
                </button>

                {/* SCHEDULE (CENTER - BIG BUTTON) */}
                <div className="relative -top-6 mx-4">
                    <button
                        onClick={() => handleNavClick('schedule')}
                        className={`
                            flex flex-col items-center justify-center w-20 h-20 rounded-full transition-all duration-300 shadow-2xl border-4 border-[#FDFBF7]
                            ${isActive('schedule')
                                ? 'bg-gradient-to-b from-emerald-500 to-emerald-700 scale-110 translate-y-0 shadow-emerald-200/50'
                                : 'bg-white translate-y-2 hover:translate-y-0 shadow-stone-200'
                            }
                        `}
                    >
                        <div className="relative flex items-center justify-center">
                            <img
                                src="/assets/Schedule.png"
                                alt="Schedule"
                                className={`w-10 h-10 object-contain drop-shadow-sm ${isActive('schedule') ? 'brightness-110 contrast-110' : ''}`}
                            />
                        </div>
                    </button>
                    <span className={`
                        absolute -bottom-5 w-full text-center text-[10px] font-extrabold uppercase tracking-wider 
                        ${isActive('schedule') ? 'text-emerald-800 scale-110' : 'text-stone-700 opacity-100'}
                        transition-all duration-300
                    `}>
                        {t('nav.schedule')}
                    </span>
                </div>

                {/* INCOME SECTION */}
                <button
                    onClick={() => handleNavClick('income')}
                    className={`
                        flex w-16 flex-col items-center justify-end pb-1 transition-all duration-200 group
                    `}
                >
                    <div className={`
                        mb-1 rounded-2xl px-3 py-1 transition-all duration-200
                        ${isActive('income') ? 'bg-emerald-100' : ''}
                    `}>
                        <img
                            src="/assets/Income_Rb.png"
                            alt="Income"
                            className={`w-9 h-9 object-contain`}
                        />
                    </div>
                    <span className={`text-[10px] tracking-tight ${isActive('income') ? 'font-extrabold text-emerald-700' : 'font-bold text-stone-700'}`}>
                        {t('nav.income')}
                    </span>
                    <span className={`mt-1 h-1 w-1 rounded-full bg-emerald-600 transition-opacity ${isActive('income') ? 'opacity-100' : 'opacity-0'}`} />
                </button>

                {/* TESTS SECTION — CEI Phase 2 §4.5 */}
                <button
                    onClick={() => handleNavClick('tests')}
                    aria-label={t('nav.tests')}
                    className={`
                        flex w-16 flex-col items-center justify-end pb-1 transition-all duration-200 group
                    `}
                >
                    <div className={`
                        mb-1 rounded-2xl px-2 py-1 transition-all duration-200
                        ${isActive('tests') ? 'bg-emerald-100' : ''}
                    `}>
                        <FlaskConical
                            size={28}
                            strokeWidth={2}
                            className={isActive('tests') ? 'text-emerald-700' : 'text-stone-500'}
                        />
                    </div>
                    <span className={`text-[10px] tracking-tight ${isActive('tests') ? 'font-extrabold text-emerald-700' : 'font-bold text-stone-700'}`}>
                        {t('nav.tests')}
                    </span>
                    <span className={`mt-1 h-1 w-1 rounded-full bg-emerald-600 transition-opacity ${isActive('tests') ? 'opacity-100' : 'opacity-0'}`} />
                </button>

            </div>
        </nav>
    );
};

export default BottomNavigation;
