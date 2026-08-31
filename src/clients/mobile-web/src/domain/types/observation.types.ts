/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observation, note and planned-task types.
 *
 * Extracted from `log.types.ts` to bring that file under the mobile-web
 * 800-line budget (`npm run check:file-sizes`). PURE CODE MOVE — every type
 * below is byte-identical to what it was, and `log.types.ts` re-exports the
 * whole module, so every existing `from ...log.types` import keeps working
 * and no call site changed.
 *
 * This is the seam the file already had: the block was fenced off under its
 * own "OBSERVATIONS & NOTES" banner, referenced nothing above it, and is the
 * one group here that a reader looks for on its own.
 */

// =============================================================================
// OBSERVATIONS & NOTES (Facts - immutable)
// =============================================================================

export type ObservationNoteType = 'observation' | 'issue' | 'tip' | 'reminder' | 'unknown';
export type ObservationSeverity = 'normal' | 'important' | 'urgent';
export type ObservationSource = 'voice' | 'manual';

export interface TaskCandidate {
    id: string;
    title: string;
    dueDate?: string;         // YYYY-MM-DD or null
    dueWindow?: { start: string; end: string };
    plotId: string;
    priority: 'normal' | 'high';
    status: 'suggested' | 'pending' | 'done';
    confidence: number;      // 0-100
    sourceNoteId: string;
    rawText?: string;       // Original text that triggered this
}

export interface ObservationNote {
    id: string;
    plotId: string;           // Required - always linked to a plot
    cropId?: string;          // Optional - crop if available
    dateKey: string;          // Required (YYYY-MM-DD)
    timestamp: string;        // ISO string

    // Content (IMMUTABLE - observations are facts, not mutable tasks)
    textRaw: string;          // Required - original voice/manual text (never lost)
    textCleaned?: string;     // Optional - AI cleaned/completed sentence with context

    // Classification
    noteType: ObservationNoteType;
    severity: ObservationSeverity;
    tags?: string[];          // e.g., ['leaf curl', 'wind', 'pump', 'weather']

    // Metadata
    source: ObservationSource;
    aiConfidence?: number;    // 0-100 (how confident AI was in classification)

    // @deprecated TASK TRACKING (TO BE REMOVED - use PlannedTask instead)
    status?: 'open' | 'resolved';
    resolvedAt?: string;
    extractedTasks?: TaskCandidate[];

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11) — see
    // CropActivityEvent.provenanceVerified for the contract. Missing = verified.
    provenanceVerified?: boolean;
}

// =============================================================================
// PLANNED TASKS (Intent - mutable)
// =============================================================================

export interface PlannedTask {
    id: string;
    title: string;
    description?: string;

    // Temporal bounds (future)
    dueHint?: string | null;   // Raw spoken/typed temporal cue ('उद्या', '३ दिवसांनी') — provenance for dueDate
    dueDate?: string;          // YYYY-MM-DD (resolved from dueHint via dueDateResolver for CLEAR cues)
    dueWindow?: { start: string; end: string };

    // Context binding
    plotId: string;
    cropId?: string;

    // Task lifecycle (mutable - tasks can change status)
    priority: 'normal' | 'high' | 'urgent';
    status: 'suggested' | 'pending' | 'in_progress' | 'done' | 'cancelled';

    // Assignment (Layer 3)
    assigneeId?: string; // Link to Person.id

    // Source attribution (CRITICAL for event-driven model)
    sourceType: 'ai_extracted' | 'observation_derived' | 'manual' | 'schedule';
    sourceObservationId?: string;  // Link back to ObservationNote IF derived from observation
    aiConfidence?: number;         // 0-100 if AI-extracted

    // Metadata
    createdAt: string;
    updatedAt?: string;
    completedAt?: string;
    tags?: string[];

    // Transparency
    sourceText?: string;
    systemInterpretation?: string;

    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11) — see
    // CropActivityEvent.provenanceVerified for the contract. Missing = verified.
    provenanceVerified?: boolean;
}
