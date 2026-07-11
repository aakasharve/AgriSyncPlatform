/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Setup Hub accordion — replaces the menu-above-content ProfileSidebar layout.
 * Each row expands its own section body directly beneath it (F-14-22). One
 * section open at a time; tapping the open row collapses it.
 *
 * Guided mode (opt-in via `doneIds` + `onAdvance`): shows a progress bar, a
 * green ✓ on finished steps, and a "Next →" button that walks the farmer to
 * the next section — turning the hub into a gentle setup wizard.
 */
import React from 'react';
import { ChevronDown, CheckCircle2, ArrowRight } from 'lucide-react';
import { useLanguage } from '../../../i18n/LanguageContext';
import type { ProfileTab } from '../ProfilePage';

export interface HubSection {
    id: ProfileTab;
    label: string;
    icon: React.ReactNode;
    body: React.ReactNode;
}

interface SetupHubAccordionProps {
    sections: HubSection[];
    activeTab: ProfileTab | null;
    onToggle: (id: ProfileTab) => void;
    /** Finance / Referrals nav buttons, rendered below the accordion. */
    rail?: React.ReactNode;
    /** Guided setup: when provided, shows progress + done ticks. */
    doneIds?: Set<ProfileTab>;
    /** Guided setup: renders a "Next: <section>" button in the open section. */
    onAdvance?: (next: ProfileTab) => void;
}

export const SetupHubAccordion: React.FC<SetupHubAccordionProps> = ({ sections, activeTab, onToggle, rail, doneIds, onAdvance }) => {
    const { t } = useLanguage();
    const guided = !!doneIds;
    const doneCount = guided ? sections.filter(s => doneIds!.has(s.id)).length : 0;
    const pct = guided && sections.length ? Math.round((doneCount / sections.length) * 100) : 0;

    return (
        <div className="space-y-3">
            {guided ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-emerald-800">{t('profile.setupHub')}</span>
                        <span className="text-xs font-bold text-emerald-700">{doneCount} / {sections.length} पूर्ण</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-100">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                </div>
            ) : (
                <div className="px-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                    {t('profile.setupHub')}
                </div>
            )}

            {sections.map((section, i) => {
                const isActive = section.id === activeTab;
                const isDone = guided && doneIds!.has(section.id);
                const next = sections[i + 1];
                return (
                    <div
                        key={section.id}
                        className={`overflow-hidden rounded-2xl border transition-all ${
                            isActive ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white shadow-md ring-1 ring-emerald-100' : 'border-slate-200 bg-slate-50/60'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => onToggle(section.id)}
                            aria-expanded={isActive}
                            className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left min-h-[60px] transition-all active:scale-[0.99] ${
                                isActive ? 'text-emerald-900 bg-emerald-50/40' : 'text-slate-600 hover:bg-white active:bg-emerald-50/50'
                            }`}
                        >
                            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all ${
                                isDone || isActive ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200' : 'bg-white text-slate-400 border border-slate-200'
                            }`}>
                                {isDone ? <CheckCircle2 size={20} /> : section.icon}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">{section.label}</span>
                            <ChevronDown
                                size={18}
                                className={`flex-shrink-0 transition-transform duration-200 ${
                                    isActive ? 'rotate-180 text-emerald-600' : 'text-slate-300'
                                }`}
                            />
                        </button>

                        {isActive && (
                            <div className="animate-in fade-in slide-in-from-top-1 px-3 pb-4 pt-1 duration-200">
                                {section.body}
                                {guided && next && onAdvance && (
                                    <button
                                        type="button"
                                        onClick={() => onAdvance(next.id)}
                                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-md active:scale-[0.98] transition-all"
                                    >
                                        पुढील · Next: {next.label.split(' · ')[0]} <ArrowRight size={16} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {rail && <div className="space-y-1 pt-2">{rail}</div>}
        </div>
    );
};
