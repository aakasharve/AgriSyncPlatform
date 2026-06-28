/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — Understanding Meter scaffold (1d-infra; flag-gated; PLACEHOLDER visuals).
 *
 * Consumes the already-built meter engine (scoreVlog output + rankMeterGaps + computeMeterArrival)
 * and renders a minimal placeholder. The final visual treatment — the /10 face, silhouette/reveal,
 * palette, font work — is DEFERRED to the visual-polish pass (founder supplies design assets).
 * Gated by FEATURE_FLAGS.understandingMeter (OFF by default) so it is inert in production.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import React from 'react';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import { rankMeterGaps } from '../services/meterGaps';
import { computeMeterArrival } from '../services/meterArrival';
import type { VlogScore } from '../../../domain/types/log.types';

export interface MeterDisplayProps {
    /** The just-saved log's understanding score (undefined until wired/available). */
    score?: VlogScore;
    /** All of the farmer's logs (each may carry an `understanding` VlogScore) — drives the arrival gate. */
    allLogs?: Array<{ understanding?: VlogScore }>;
}

export function MeterDisplay({ score, allLogs = [] }: MeterDisplayProps): React.ReactElement | null {
    // Flag gate: inert in production until the meter is calibrated + founder-approved.
    if (!FEATURE_FLAGS.understandingMeter) {
        return null;
    }

    const gaps = score ? rankMeterGaps(score) : [];
    const arrival = computeMeterArrival(allLogs);

    // PLACEHOLDER visuals — intentionally minimal/unstyled. Visual polish pass replaces this.
    return (
        <div data-testid="meter-display" className="mt-6 rounded-2xl border border-dashed border-stone-300 p-4 text-left">
            <div data-testid="meter-score" className="text-sm text-stone-600">
                {score && score.score != null
                    ? `Understanding: ${score.score}/100 (${score.outcome})`
                    : 'Understanding: —'}
            </div>
            <div data-testid="meter-arrival" className="mt-1 text-xs text-stone-500">
                {`Rich logs: ${arrival.richLogCount}/${arrival.target}${arrival.arrived ? ' — arrived' : ''}`}
            </div>
            {gaps.length > 0 && (
                <ul data-testid="meter-gaps" className="mt-2 space-y-1">
                    {gaps.map((g) => (
                        <li key={g.questionKey} className="text-xs text-stone-700">{g.question}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
