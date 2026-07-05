/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ClosureReceiptCard — Track C "closure receipt" view (WP-4, Task 10).
 *
 * A dumb, minimal presentational card over a `ClosureReceipt` projection
 * (closureReceiptProjection.ts). It renders the visible buckets, the work-done
 * rows, the cost total, weather, and (when present) the understanding score.
 *
 * Gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert in
 * production. The final visual treatment — palette, iconography, the /100 face,
 * Devanagari copy — is DEFERRED to the visual-polish pass (founder art assets;
 * build-infra-now-defer-ui-polish-until-assets). This is LOGIC + minimal markup.
 *
 * Font rules: numbers/brand use DM Sans; any Marathi/Devanagari copy would use
 * 'Noto Sans Devanagari' (body) / 'Noto Serif Devanagari' (headings). The
 * bucket/work labels here are the existing English labels from the codebase.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { visibleBucketLabels } from '../../../domain/ai/BucketId';
import type { ClosureReceipt } from '../services/closureReceiptProjection';

export interface ClosureReceiptCardProps {
    receipt: ClosureReceipt;
}

const NUMERIC_FONT = "'DM Sans', sans-serif";

export function ClosureReceiptCard({ receipt }: ClosureReceiptCardProps): React.ReactElement | null {
    // Flag gate: inert in production until the receipt visual is founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const { buckets, workDone, totals, weather, score } = receipt;

    // PLACEHOLDER visuals — intentionally minimal/unstyled. Visual polish replaces this.
    return (
        <div
            data-testid="closure-receipt-card"
            className="mt-6 rounded-2xl border border-dashed border-stone-300 p-4 text-left"
        >
            {buckets.length > 0 && (
                <div data-testid="closure-buckets" className="flex flex-wrap gap-2">
                    {buckets.map((b) => (
                        <span
                            key={b}
                            className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold text-stone-700"
                        >
                            {visibleBucketLabels[b]}
                        </span>
                    ))}
                </div>
            )}

            {workDone.length > 0 && (
                <ul data-testid="closure-work-done" className="mt-3 space-y-1">
                    {workDone.map((item) => (
                        <li key={item.id} className="text-xs text-stone-700">
                            {item.title}
                            {item.detail ? <span className="text-stone-400"> — {item.detail}</span> : null}
                        </li>
                    ))}
                </ul>
            )}

            <div data-testid="closure-total" className="mt-3 text-sm text-stone-600">
                Total: <span style={{ fontFamily: NUMERIC_FONT }} className="font-bold">Rs {totals.grandTotal}</span>
            </div>

            {weather && (
                <div data-testid="closure-weather" className="mt-1 text-xs text-stone-500">
                    {weather.conditionText}
                    {' '}
                    <span style={{ fontFamily: NUMERIC_FONT }}>{weather.tempC}&deg;C</span>
                </div>
            )}

            {score && score.score != null && (
                <div data-testid="closure-score" className="mt-1 text-xs text-stone-500">
                    Understanding:{' '}
                    <span style={{ fontFamily: NUMERIC_FONT }}>{score.score}/100</span>
                    {' '}({score.outcome})
                </div>
            )}
        </div>
    );
}
