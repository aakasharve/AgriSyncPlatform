/**
 * BottomNavigation — Android Material 3 bottom navigation bar
 * Standard flat layout, no SVG curves, no glows
 */

import React from 'react';
import { Home, ClipboardList, Package, TrendingUp, User } from 'lucide-react';
import { AppRoute, PageView } from '../../../types';
import { hapticFeedback } from '../../../shared/utils/haptics';
import { useLanguage } from '../../../i18n/LanguageContext';

interface BottomNavigationProps {
    currentRoute: AppRoute;
    currentView: PageView;
    onNavigate: (route: AppRoute) => void;
    onViewChange: (view: PageView) => void;
}

interface NavItemProps {
    icon: React.ReactNode;
    label: string;
    active: boolean;
    onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`
            flex flex-col items-center justify-center flex-1 py-2 min-h-[56px] transition-colors duration-150
            ${active ? 'text-emerald-700' : 'text-stone-400 active:text-stone-600'}
        `}
    >
        <div className={`
            px-5 py-1 rounded-full transition-colors duration-150 mb-0.5
            ${active ? 'bg-emerald-100' : 'active:bg-stone-100'}
        `}>
            {icon}
        </div>
        <span className={`text-[11px] font-semibold ${active ? 'text-emerald-700' : 'text-stone-500'}`}>
            {label}
        </span>
    </button>
);

const BottomNavigation: React.FC<BottomNavigationProps> = ({ currentRoute, currentView, onNavigate, onViewChange }) => {
    const { t } = useLanguage();

    const handleNavClick = (route: AppRoute) => {
        hapticFeedback.light();
        onNavigate(route);
    };

    const isActive = (route: AppRoute) => currentRoute === route;

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-stone-100 pb-safe-area shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]">
            <div className="max-w-md mx-auto flex items-end justify-center h-[72px] px-2 pb-2">

                {/* PROCUREMENT SECTION */}
                <button
                    onClick={() => handleNavClick('procurement')}
                    className={`
                        flex flex-col items-center justify-end pb-2 w-20 transition-all duration-200 group
                        ${isActive('procurement') ? 'scale-110' : 'hover:opacity-100'}
                    `}
                >
                    <div className={`
                        mb-1 transition-all duration-200
                        ${isActive('procurement') ? 'drop-shadow-lg filter' : ''}
                    `}>
                        <img
                            src="/assets/Procurement_rb.png"
                            alt="Procure"
                            className={`w-9 h-9 object-contain`}
                        />
                    </div>
                    <span className={`text-[10px] font-bold tracking-tight ${isActive('procurement') ? 'text-emerald-800' : 'text-stone-700'}`}>
                        {t('nav.procure')}
                    </span>
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
                        flex flex-col items-center justify-end pb-2 w-20 transition-all duration-200 group
                        ${isActive('income') ? 'scale-110' : 'hover:opacity-100'}
                    `}
                >
                    <div className={`
                        mb-1 transition-all duration-200
                        ${isActive('income') ? 'drop-shadow-lg filter' : ''}
                    `}>
                        <img
                            src="/assets/Income_Rb.png"
                            alt="Income"
                            className={`w-10 h-10 object-contain`}
                        />
                    </div>
                    <span className={`text-[10px] font-bold tracking-tight ${isActive('income') ? 'text-emerald-800' : 'text-stone-700'}`}>
                        {t('nav.income')}
                    </span>
                </button>

            </div>
        </nav>
    );
};

export default BottomNavigation;
