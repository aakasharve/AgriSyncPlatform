/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 — what the field card ("तुमचं शेत") may draw, read ONLY from the real parse (P4).
 * Nothing is drawn before the answer: while he speaks the field is bare (no live parse exists). After it: workers only for a
 * headcount he stated (the app's one headcount rule, `sumLabourHeadcount`; unknown = none drawn, never a guess), capped at
 * MAX_WORKERS figures; a sprayer for a spray; drip lines for watering; a tractor for any machine; vines for the work done.
 */
import type { AgriLogResponse } from '../../../../types';
import { sumLabourHeadcount } from '../../../../domain/logs/labourHeadcount';

/** The field has room for this many figures; a larger crew is drawn as this many (the count itself is never shown). */
export const MAX_WORKERS = 12;

export interface FieldScene {
    /** Figures to draw: his stated headcount, capped; 0 = none. */
    workers: number;
    spray: boolean;
    drip: boolean;
    tractor: boolean;
    vines: boolean;
}

export const EMPTY_FIELD: FieldScene = { workers: 0, spray: false, drip: false, tractor: false, vines: false };

/** How many kinds of things are drawn (the design's "शेतात भरलं: N"). */
export const sceneCount = (s: FieldScene): number =>
    (s.workers > 0 ? 1 : 0) + (s.spray ? 1 : 0) + (s.drip ? 1 : 0) + (s.tractor ? 1 : 0) + (s.vines ? 1 : 0);

export function fieldSceneOf(draft: AgriLogResponse | undefined | null): FieldScene {
    if (!draft) return EMPTY_FIELD;
    const labour = draft.labour ?? [];
    const heads = labour.length > 0 ? sumLabourHeadcount(labour) : 0;
    const irrigation = (draft.irrigation ?? []).filter(e => e.role !== 'spray-carrier');
    return {
        workers: typeof heads === 'number' && heads > 0 ? Math.min(MAX_WORKERS, Math.round(heads)) : 0,
        spray: (draft.inputs ?? []).some(i => i.method === 'Spray'),
        drip: irrigation.length > 0,
        tractor: (draft.machinery ?? []).length > 0,
        vines: (draft.cropActivities ?? []).length > 0,
    };
}
