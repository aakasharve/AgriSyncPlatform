/**
 * DailySummaryCard — one day, one card.
 *
 * REDESIGN 2026-08-14 (founder review, BH-1 pill overflow).
 *
 * The problem: `dfes.closeToday` became a 53-character first-person Sathi
 * SENTENCE ("आजची सगळी कामे माझ्यापर्यंत पोहोचली का याची खात्री करा") and it was
 * being used as the label of a `px-4 py-2 text-xs rounded-full` pill inside a
 * `justify-between` header. At 390 px that pill either shoves the day's count
 * off the card or wraps into a five-line blob. One string was doing two
 * different jobs — Sathi speaking, and a control naming its action — and no
 * single string can do both.
 *
 * The fix splits the jobs:
 *   • the CONTROL says what it does, in two words (`dfes.closeTodayAction`),
 *     icon-led so a farmer who reads slowly recognises it by shape;
 *   • the founder's SENTENCE becomes the heading of the panel that control
 *     opens, where it has the full card width to breathe;
 *   • the panel then asks the already-written question
 *     (`dfes.closeTodayQuestion`) and takes हो / नाही.
 *
 * The founder's `closeToday` text is untouched — it is founder-locked. Only its
 * placement changed.
 *
 * `onCloseToday` now fires on हो rather than on the pill tap. Confirm-before-act
 * is the right shape for "I am done telling you about today", and the callback
 * had no callers to break.
 */
import React from 'react';
import { ClipboardCheck, ChevronUp } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { toMarathiNumber } from '../../../features/logs/services/disciplineRecognition';

interface DailySummaryStats {
    logsCount: number;
    totalSpent: number;
    pendingTasks: number;
    verifiedCount: number;
    unverifiedCount: number;
}

interface DailySummaryCardProps {
    date: string;
    stats: DailySummaryStats;
    onClick?: () => void;
    isToday?: boolean;
    onCloseToday?: () => void; // BH-1
}

// Font rules (CHARTER). Marathi body -> Noto Sans Devanagari; the panel heading
// is Sathi speaking, i.e. decorative/heading -> Noto Serif Devanagari. Latin and
// numerals -> DM Sans. Set explicitly rather than inherited so the card is
// correct wherever it is mounted.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";
const MARATHI_HEADING = "'Noto Serif Devanagari', serif";

export const DailySummaryCard: React.FC<DailySummaryCardProps> = ({
    date,
    stats,
    onClick,
    isToday = false,
    onCloseToday
}) => {
    const { t, language } = useLanguage();
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const panelId = React.useId();
    const showCloseControl = isToday && Boolean(onCloseToday);

    // Counts sit inside Marathi sentences, so in Marathi they are Devanagari —
    // the same ०-९ the streak strip and the understanding meter already show.
    // Guarded on `language` because this card, unlike those DFES-only surfaces,
    // also renders in English. The ₹ figure deliberately stays Latin: it keeps
    // its thousands grouping and matches the Running Cost block on the home view.
    const count = (value: number): string =>
        language === 'mr' ? toMarathiNumber(value) : String(value);

    return (
        <div
            onClick={onClick}
            className={`
        relative overflow-hidden rounded-3xl p-6 transition-all duration-300 active:scale-[0.97] cursor-pointer group
        ${isToday
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-400/30'
                    : 'bg-white border border-stone-100 shadow-soft hover:shadow-medium hover:border-emerald-100'
                }
      `}
        >
            <div className="flex items-center justify-between gap-3 mb-5 relative z-10">
                {/* min-w-0 lets the day block shrink instead of shoving the
                    control off the card at 390px. */}
                <div className="min-w-0">
                    <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isToday ? 'text-emerald-100' : 'text-stone-400'}`}>
                        {isToday ? t('common.today') : date}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-3xl font-display font-extrabold ${isToday ? 'text-white' : 'text-stone-800'}`}>
                            {count(stats.logsCount)}
                        </span>
                        <span
                            className={`text-sm font-medium truncate ${isToday ? 'text-emerald-100' : 'text-stone-500'}`}
                            style={{ fontFamily: MARATHI_BODY }}
                        >
                            {t('dfes.activitiesLogged')}
                        </span>
                    </div>
                </div>

                {/* BH-1: the control that OPENS the close-today confirm panel.
                    Two words + an icon, never wrapped, never shorter than the
                    44px minimum tap target. */}
                {showCloseControl ? (
                    <button
                        type="button"
                        data-testid="close-today-action"
                        aria-expanded={confirmOpen}
                        aria-controls={panelId}
                        onClick={(e) => { e.stopPropagation(); setConfirmOpen(prev => !prev); }}
                        className="shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-4 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-xs font-bold rounded-full transition-colors border border-white/30 whitespace-nowrap"
                        style={{ fontFamily: MARATHI_BODY }}
                    >
                        {confirmOpen
                            ? <ChevronUp size={16} strokeWidth={3} aria-hidden="true" />
                            : <ClipboardCheck size={16} strokeWidth={2.5} aria-hidden="true" />}
                        {t('dfes.closeTodayAction')}
                    </button>
                ) : (
                    /* Visual Indicator of "Completeness" for past days */
                    <div className="flex -space-x-2 shrink-0">
                        {stats.unverifiedCount > 0 ? (
                            <div className="w-12 h-12 rounded-full bg-amber-100 border-4 border-white flex items-center justify-center text-amber-600 font-bold shadow-sm">
                                {count(stats.unverifiedCount)}
                            </div>
                        ) : (
                            <div className={`w-12 h-12 rounded-full border-4 border-white flex items-center justify-center shadow-sm ${isToday ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* BH-1: where the founder's sentence lives now. Full card width, its
                own line height, nothing competing with it. No transform/opacity
                animation is used here, so there is nothing for
                prefers-reduced-motion to suppress. */}
            {showCloseControl && confirmOpen && (
                <div
                    id={panelId}
                    data-testid="close-today-panel"
                    onClick={(e) => e.stopPropagation()}
                    className="mb-4 rounded-2xl bg-white/15 backdrop-blur-md border border-white/30 p-4 text-left relative z-10"
                >
                    <p
                        data-testid="close-today-panel-heading"
                        className="text-[15px] font-bold leading-relaxed text-white"
                        style={{ fontFamily: MARATHI_HEADING }}
                    >
                        {t('dfes.closeToday')}
                    </p>
                    <p
                        className="mt-2 text-sm font-semibold text-emerald-50"
                        style={{ fontFamily: MARATHI_BODY }}
                    >
                        {t('dfes.closeTodayQuestion')}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                        <button
                            type="button"
                            data-testid="close-today-yes"
                            onClick={() => { setConfirmOpen(false); onCloseToday?.(); }}
                            className="min-h-[44px] px-6 rounded-full bg-white text-emerald-800 text-sm font-bold transition-colors hover:bg-emerald-50"
                            style={{ fontFamily: MARATHI_BODY }}
                        >
                            {t('common.yes')}
                        </button>
                        <button
                            type="button"
                            data-testid="close-today-no"
                            onClick={() => setConfirmOpen(false)}
                            className="min-h-[44px] px-6 rounded-full border border-white/50 text-white text-sm font-bold transition-colors hover:bg-white/10"
                            style={{ fontFamily: MARATHI_BODY }}
                        >
                            {t('common.no')}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm relative z-10">
                <span
                    className={`px-2.5 py-1 rounded-lg font-bold text-xs ${stats.unverifiedCount > 0
                        ? 'bg-amber-100 text-amber-800'
                        : isToday ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-surface-100 text-stone-600'
                        }`}
                    style={{ fontFamily: MARATHI_BODY }}
                >
                    {stats.unverifiedCount > 0
                        ? `${count(stats.unverifiedCount)} ${t('dfes.needsReview')}`
                        : t('dfes.allVerified')}
                </span>
                {stats.totalSpent > 0 && (
                    <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${isToday ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-surface-100 text-stone-600'}`}>
                        ₹{stats.totalSpent.toLocaleString()}
                    </span>
                )}
            </div>

            {/* Decorative Background for Today Card */}
            {isToday && (
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-400/30 rounded-full blur-3xl pointer-events-none" />
            )}
        </div>
    );
};
