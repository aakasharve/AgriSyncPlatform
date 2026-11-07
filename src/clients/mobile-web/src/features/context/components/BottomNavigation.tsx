/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BottomNavigation — the app's bottom bar (founder-approved 2026-10-25, "trial v3").
 *
 * The standard Android (Material 3) navigation bar, the one farmers already know from their other apps:
 *   - five equal columns: लक्ष द्या, खरेदी, शेड्यूल, उत्पन्न, चाचण्या;
 *   - one professional line-icon set (the app's Lucide icons, 27px) — it replaced two PNG pictures, one line icon and one hand-drawn SVG of
 *     different sizes;
 *   - where you are: the icon sits in a soft green pill (it pops in when chosen) and its label turns bold green; the rest stays a quiet grey;
 *   - शेड्यूल is the one raised button: a bold green circle with a white calendar, sitting in a white "cradle" that the bar lifts around it, so
 *     the page behind never shows through or crowds it (it used to float half over the page content).
 *   - spec: plr-d10 (I22, founder D-1) — लक्ष द्या carries a small count: how many items its page lists for the farm on screen
 *     (`attentionItems.ts` — the same list the page and the आढावा strip read). No count when there is none or none is known (P4).
 *   - spec: plr-d10 lane MU-1 (MU design §6, role-shaped doors) - a door this seat cannot use is not drawn: a worker's bar is
 *     लक्ष द्या and शेड्यूल only (no खरेदी / उत्पन्न / चाचण्या); the columns share the width and शेड्यूल keeps its raised place
 *     (`doors`, read from the seat's authorities by `core/session/seatDoors.ts`; absent = every door, as before).
 *   - lane FX-1 (founder rule FOOT-1, 2026-10-31: nothing may sit behind the bar): while any sheet, pop-up or full-screen
 *     overlay is open the bar steps away, exactly as it does for the keyboard (`useOverlayOverBar`; the rule is
 *     `shared/utils/bottomBar.ts`). It is also the app's base layer (z-40): every sheet is drawn above it. The room it
 *     takes, which every page leaves free at its end, is `BOTTOM_BAR_CLEARANCE` (same file).
 */
import React, { useRef } from 'react';
import { CalendarCheck, CircleAlert, FlaskConical, IndianRupee, ShoppingBag, type LucideIcon } from 'lucide-react';
import type { AppRoute, PageView } from '../../../types';
import { hapticFeedback } from '../../../shared/utils/haptics';
import { useLanguage } from '../../../i18n/LanguageContext';
import { useOverlayOverBar } from '../../../shared/hooks/useOverlayOverBar';
import { BOTTOM_BAR_ROW_PX } from '../../../shared/utils/bottomBar';
import type { SeatDoors } from '../../../core/session/seatDoors';

/** One column per place drawn (2 to 5): whole class names, so the style sheet keeps them. */
const BAR_COLUMNS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' };

interface BottomNavigationProps {
    currentRoute: AppRoute;
    /** Not used by the bar; kept so callers need not change. */
    currentView?: PageView;
    onNavigate: (route: AppRoute) => void;
    /** Not used by the bar; kept so callers need not change. */
    onViewChange?: (view: PageView) => void;
    hidden?: boolean;
    /** The Attention place's label. Founder-approved name (2026-10-25): "लक्ष द्या". */
    attentionLabel?: string;
    /** Items on लक्ष द्या right now (`useAttentionModel().total`). Absent or 0 → no badge. */
    attentionCount?: number;
    /** MU-1 - which doors this seat is shown. Absent = all (the seat is not known yet, or a test). */
    doors?: SeatDoors;
}

const BottomNavigation: React.FC<BottomNavigationProps> = ({ currentRoute, onNavigate, hidden = false, attentionLabel = 'लक्ष द्या', attentionCount, doors }) => {
    const show: SeatDoors = doors ?? { procurement: true, money: true, tests: true };
    const { t } = useLanguage();
    const navRef = useRef<HTMLElement>(null);
    // FOOT-1 — a sheet or pop-up is open: the bar steps away so nothing of it sits under the bar.
    const overlayOpen = useOverlayOverBar(navRef);
    const away = hidden || overlayOpen;
    const go = (route: AppRoute) => { hapticFeedback.medium(); onNavigate(route); };
    const on = (route: AppRoute) => currentRoute === route;

    // a plain function (not a component defined inside render, which React would remount on every render)
    const side = (route: AppRoute, Icon: LucideIcon, iconName: string, label: string, testId?: string, aria?: string, badge?: number) => (
        <button key={route} type="button" onClick={() => go(route)} data-testid={testId ?? `nav-${route}`} aria-label={aria} aria-current={on(route) ? 'page' : undefined}
            className="relative z-[1] flex flex-col items-center justify-end gap-1 pb-2 transition-transform duration-150 active:scale-90">
            <span key={on(route) ? 'on' : 'off'}
                className={`relative grid h-9 w-16 place-items-center rounded-full ${on(route) ? 'animate-plr-pop bg-emerald-100 text-emerald-800' : 'text-stone-600'}`}>
                <Icon size={27} strokeWidth={on(route) ? 2.4 : 2} aria-hidden="true" data-nav-icon={iconName} />
                {badge !== undefined && badge > 0 && (
                    <span data-testid={`nav-${route}-count`} aria-hidden="true" style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="absolute -right-0.5 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-rose-600 px-1 text-[11.5px] font-extrabold leading-none text-white ring-2 ring-white">
                        {badge > 99 ? '99+' : badge}
                    </span>
                )}
            </span>
            <span className={`text-[12.5px] leading-none ${on(route) ? 'font-extrabold text-emerald-900' : 'font-semibold text-stone-600'}`}>{label}</span>
        </button>
    );

    return (
        <nav ref={navRef} data-testid="bottom-nav" data-hidden={away ? 'yes' : 'no'}
            className={`fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-white pb-safe-area shadow-[0_-4px_16px_-6px_rgba(28,25,23,0.12)] transition-all duration-200 ${away ? 'pointer-events-none translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}>
            <div aria-hidden="true" className="pointer-events-none absolute -top-8 left-0 right-0 h-8 bg-gradient-to-b from-transparent to-[rgba(250,250,249,0.92)]" />
            {/* the cradle: a white half-disc the bar lifts around the raised button (it covers the bar's top line inside it) */}
            <div className={`page-content pl-safe-area pr-safe-area relative grid items-end ${BAR_COLUMNS[2 + (show.procurement ? 1 : 0) + (show.money ? 1 : 0) + (show.tests ? 1 : 0)]}`} data-testid="nav-row" style={{ height: BOTTOM_BAR_ROW_PX }}>
                {side('attention', CircleAlert, 'attention', attentionLabel, undefined,
                    attentionCount ? `${attentionLabel}, ${attentionCount}` : undefined, attentionCount)}
                {show.procurement && side('procurement', ShoppingBag, 'procure', t('nav.procure'), 'procurement-nav-btn')}

                {/* the one raised button: शेड्यूल */}
                <div className="relative z-[1] flex flex-col items-center justify-end gap-1.5 pb-2">
                    {/* the cradle: a white half-disc the bar lifts around the raised button (it covers the bar's top line inside it);
                        it sits on the button's own column, so it follows the button when a door is not drawn. */}
                    <div aria-hidden="true" data-testid="nav-cradle"
                        className="pointer-events-none absolute -top-[22px] left-1/2 -z-[1] h-[84px] w-[84px] -translate-x-1/2 rounded-full bg-white shadow-[0_-6px_12px_-8px_rgba(28,25,23,0.22)]" />
                    <button type="button" onClick={() => go('schedule')} data-testid="nav-schedule" aria-label={t('nav.schedule')} aria-current={on('schedule') ? 'page' : undefined}
                        className={`-mt-9 grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-b text-white shadow-[0_10px_20px_-8px_rgba(4,120,87,0.75)] ring-4 transition-transform duration-150 active:scale-90 ${on('schedule') ? 'from-emerald-600 to-emerald-800 ring-emerald-100' : 'from-emerald-500 to-emerald-700 ring-white'}`}>
                        <CalendarCheck size={30} strokeWidth={2.4} aria-hidden="true" data-nav-icon="schedule" />
                    </button>
                    <span className="text-[12.5px] font-extrabold leading-none text-emerald-800">{t('nav.schedule')}</span>
                </div>

                {show.money && side('income', IndianRupee, 'income', t('nav.income'))}
                {show.tests && side('tests', FlaskConical, 'tests', t('nav.tests'), undefined, t('nav.tests'))}
            </div>
        </nav>
    );
};

export default BottomNavigation;
