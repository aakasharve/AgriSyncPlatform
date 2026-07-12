/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DisciplineStrip — DFES discipline surface (flag-gated by
 * FEATURE_FLAGS.disciplineSystem, OFF by default). Read-only: renders the
 * folded engagement projection (current + longest streak, total Shram points,
 * last accounted date) and the warm Marathi recognition line. Never red.
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';
import { buildRecognitionLine, toMarathiNumber } from '../services/disciplineRecognition';

export interface DisciplineStripProps {
    engagement: FarmerEngagementDto | null;
    className?: string;
}

export function DisciplineStrip({
    engagement,
    className = '',
}: DisciplineStripProps): React.ReactElement | null {
    if (!FEATURE_FLAGS.disciplineSystem || !engagement) {
        return null;
    }

    const recognition = buildRecognitionLine(engagement);

    return (
        <section
            data-testid="discipline-strip"
            className={`rounded-2xl border border-emerald-100 bg-white/80 p-4 text-left shadow-sm ${className}`}
            aria-label="Shram discipline"
        >
            <div className="flex items-center gap-3">
                <div
                    data-testid="discipline-streak"
                    className="flex flex-col items-center rounded-xl bg-emerald-50 px-3 py-2"
                >
                    <span className="font-['DM_Sans'] text-2xl font-black text-emerald-700">
                        {toMarathiNumber(engagement.currentStreak)}
                    </span>
                    <span className="font-['Noto_Sans_Devanagari'] text-[11px] font-bold text-emerald-600">
                        दिवस सलग
                    </span>
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-['DM_Sans'] text-[12px] font-bold text-stone-600">
                        <span data-testid="discipline-points">
                            {toMarathiNumber(engagement.totalShramPoints)} श्रम-गुण
                        </span>
                        <span>सर्वाधिक {toMarathiNumber(engagement.longestStreak)}</span>
                        {engagement.lastAccountedDate && (
                            <span className="text-stone-400">{engagement.lastAccountedDate}</span>
                        )}
                    </div>
                    <p
                        data-testid="discipline-recognition"
                        className="font-['Noto_Sans_Devanagari'] text-sm font-semibold leading-relaxed text-stone-700"
                    >
                        {recognition}
                    </p>
                </div>
            </div>
        </section>
    );
}
