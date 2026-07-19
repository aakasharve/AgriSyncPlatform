/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { AlertTriangle, Check, HelpCircle, Zap } from 'lucide-react';
import { t as translateForced } from '../../../../../i18n/translations';

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari. The
// "not certain I heard this" flag is Marathi copy shown inline with the
// farmer's own transcript quote, so it must set this explicitly.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

const BucketItem = ({ icon, label, sublabel, filled, theme = 'slate', onClick, sourceText, systemInterpretation, hasIssue, provenanceVerified }: {
    icon: React.ReactNode,
    label: string,
    sublabel?: string,
    filled: boolean,
    theme?: 'slate' | 'emerald' | 'orange' | 'blue' | 'purple' | 'rose' | 'amber' | 'indigo',
    onClick: () => void,
    sourceText?: string,
    systemInterpretation?: string,
    hasIssue?: boolean,
    /**
     * ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11) — `false`
     * means the backend could not verify `sourceText` actually appears in
     * the voice transcript. Renders a gentle "please check this" flag next
     * to the quote — never an error/red state, never auto-removes anything.
     * `undefined` (the common case — manual entries, verified AI items,
     * items that predate this field) renders nothing.
     */
    provenanceVerified?: boolean
}) => {

    // Theme Maps
    const themes = {
        slate: {
            bg: 'bg-slate-50',
            border: 'border-slate-200',
            gradient: 'from-slate-50 to-white',
            text: 'text-slate-600',
            iconBg: 'bg-slate-200',
            iconColor: 'text-slate-500',
            shadow: 'shadow-slate-200'
        },
        emerald: {
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
            gradient: 'from-emerald-50 to-white',
            text: 'text-emerald-700',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
            shadow: 'shadow-emerald-200'
        },
        orange: {
            bg: 'bg-orange-50',
            border: 'border-orange-200',
            gradient: 'from-orange-50 to-white',
            text: 'text-orange-700',
            iconBg: 'bg-orange-100',
            iconColor: 'text-orange-600',
            shadow: 'shadow-orange-200'
        },
        blue: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            gradient: 'from-blue-50 to-white',
            text: 'text-blue-700',
            iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600',
            shadow: 'shadow-blue-200'
        },
        purple: {
            bg: 'bg-purple-50',
            border: 'border-purple-200',
            gradient: 'from-purple-50 to-white',
            text: 'text-purple-700',
            iconBg: 'bg-purple-100',
            iconColor: 'text-purple-600',
            shadow: 'shadow-purple-200'
        },
        rose: {
            bg: 'bg-rose-50',
            border: 'border-rose-200',
            gradient: 'from-rose-50 to-white',
            text: 'text-rose-700',
            iconBg: 'bg-rose-100',
            iconColor: 'text-rose-600',
            shadow: 'shadow-rose-200'
        },
        amber: {
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            gradient: 'from-amber-50 to-white',
            text: 'text-amber-700',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
            shadow: 'shadow-amber-200'
        },
        indigo: {
            bg: 'bg-indigo-50',
            border: 'border-indigo-200',
            gradient: 'from-indigo-50 to-white',
            text: 'text-indigo-700',
            iconBg: 'bg-indigo-100',
            iconColor: 'text-indigo-600',
            shadow: 'shadow-indigo-200'
        }
    };

    const t = themes[theme] || themes.slate;

    return (
        <div
            onClick={onClick}
            className={`
                relative overflow-hidden group transition-all duration-300 cursor-pointer
                rounded-2xl border-2 p-3
                ${filled
                    ? `bg-gradient-to-br ${t.gradient} ${t.border} shadow-lg ${t.shadow} translate-y-[-2px]`
                    : 'bg-white border-slate-100 hover:border-slate-200 shadow-sm hover:shadow-md'
                }
            `}
        >
            {/* Glossy Overlay (Shine) */}
            {filled && (
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/40 to-white/0 opacity-50" />
            )}

            <div className="relative flex items-center gap-4">
                {/* 3D Icon Box */}
                <div
                    className={`
                        w-12 h-12 rounded-xl flex items-center justify-center shadow-inner transition-transform duration-300 group-hover:scale-110
                        ${filled ? `${t.iconBg} ${t.iconColor} shadow-sm ring-2 ring-white` : 'bg-slate-100 text-slate-400'}
                    `}
                >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- icon is any lucide-react element; pre-existing, not touched by this change */}
                    {React.cloneElement(icon as React.ReactElement<any>, { size: 24, strokeWidth: filled ? 2.5 : 2 })}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h4 className={`text-base font-bold leading-tight ${filled ? 'text-slate-800' : 'text-slate-500'}`}>
                        {label}
                    </h4>
                    <div className="flex items-center gap-1 mt-0.5">
                        {filled ? (
                            <span className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-white/60 backdrop-blur-sm ${t.text}`}>
                                {sublabel || 'Completed'}
                            </span>
                        ) : (
                            <span className="text-xs font-medium text-slate-400">Tap to add details</span>
                        )}
                    </div>
                </div>

                {/* Action Indicator - with Issue Badge */}
                <div className="flex items-center gap-2">
                    {/* Issue Badge */}
                    {hasIssue && (
                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-amber-100 text-amber-600 shadow-sm animate-in zoom-in">
                            <AlertTriangle size={16} strokeWidth={2.5} />
                        </div>
                    )}

                    {/* Check/Add Indicator */}
                    <div className={`
                        w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300
                        ${filled ? `bg-white text-emerald-500 shadow-sm opacity-100` : 'bg-slate-50 text-slate-300 opacity-60 group-hover:opacity-100'}
                    `}>
                        {filled ? <Check size={18} strokeWidth={3} /> : <div className="w-2 h-2 rounded-full bg-slate-300" />}
                    </div>
                </div>
            </div>

            {/* NEW: Transparency Feedback (Source -> Interpretation) */}
            {filled && (sourceText || systemInterpretation) && (
                <div className="mt-4 pt-3 border-t border-slate-100/50">
                    {provenanceVerified === false && (
                        <div
                            data-testid="provenance-unverified-flag"
                            className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5"
                        >
                            <HelpCircle size={13} className="mt-0.5 flex-shrink-0 text-amber-500" />
                            <span
                                className="text-[11px] font-semibold leading-snug text-amber-700"
                                style={{ fontFamily: MARATHI_BODY }}
                            >
                                {translateForced('voice.unverifiedSourceLabel', 'mr')}
                            </span>
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        {sourceText && (
                            <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">YOU SAID:</span>
                                <p className="text-xs font-medium text-slate-600 italic">"{sourceText}"</p>
                            </div>
                        )}
                        {systemInterpretation && (
                            <div className="flex items-start gap-2 bg-emerald-50/50 p-2 rounded-xl border border-emerald-100/50">
                                <div className="mt-0.5 text-emerald-500">
                                    <Zap size={10} fill="currentColor" />
                                </div>
                                <p className="text-[11px] font-medium text-emerald-800 leading-relaxed">
                                    {systemInterpretation}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BucketItem;
