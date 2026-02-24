/**
 * Application Ports (Interfaces)
 *
 * This module defines the contracts between the application layer and infrastructure.
 * The application layer uses these ports; infrastructure implements them.
 *
 * Architecture:
 * - Domain (pure logic) -> Application (orchestration) -> Infrastructure (I/O)
 * - UI imports from Application layer only
 * - Application depends on ports, not concrete implementations
 */

import { DailyLog, LogScope, CropProfile, FarmerProfile, LogVerificationStatus, AgriLogResponse } from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';

export interface ConfidenceAssessment {
    fieldConfidences: Record<string, { score: number; level: string; reason?: string }>;
    suggestedAction: 'auto_confirm' | 'manual_review' | 'ask_clarification';
    averageScore: number;
    hasLowConfidenceFields: boolean;
    lowConfidenceFields: string[];
}

// ============================================
// LOGS REPOSITORY PORT
// ============================================

/**
 * Repository interface for log persistence operations.
 */
// Unified Audit Context (Fix-07)
export interface AuditContext {
    actorId: string;
    reason: string;
    action?: string; // e.g. "CORRECT_LOG"
}

export interface LogsRepository {
    /**
     * Get all logs.
     * @param filters - Optional filters
     * @param filters.includeDeleted - If true, return even soft-deleted logs (default: false)
     */
    getAll(filters?: { includeDeleted?: boolean }): Promise<DailyLog[]>;

    /**
     * Get logs for a specific date.
     */
    getByDate(date: string): Promise<DailyLog[]>;

    /**
     * Get logs for a specific plot.
     */
    getByPlot(plotId: string): Promise<DailyLog[]>;

    /**
     * Get a single log by ID.
     */
    getById(id: string): Promise<DailyLog | null>;

    /**
     * Save a single log (insert or update).
     * @param log - The log to save
     * @param audit - Optional context for auditing the change
     */
    save(log: DailyLog, audit?: AuditContext): Promise<void>;

    /**
     * Save multiple logs in a batch (atomic operation).
     */
    batchSave(logs: DailyLog[]): Promise<void>;

    /**
     * Delete a log by ID (Soft delete if verified).
     * @param id - Log ID
     * @param actorId - Operator performing deletion
     * @param reason - Reason for deletion
     */
    delete(id: string, actorId: string, reason: string): Promise<void>;

    /**
     * Update a log's verification status.
     */
    updateVerification(id: string, status: LogVerificationStatus, verifierId?: string): Promise<void>;
}

// AI PARSING PORT
// ============================================

/**
 * Result of AI voice parsing.
 */
export interface VoiceParseResult {
    success: boolean;
    data?: AgriLogResponse;
    provenance?: LogProvenance;
    confidenceAssessment?: ConfidenceAssessment;
    error?: string;
    rawTranscript?: string;
}

export type VoiceInput =
    | {
        type: 'audio';
        data: string;
        mimeType: string;
        idempotencyKey?: string;
        sessionId?: string;
        segmentIndex?: number;
        contentHash?: string;
        inputSpeechDurationMs?: number;
        inputRawDurationMs?: number;
        segmentMetadataJson?: string;
        requestPayloadHash?: string;
    }
    | {
        type: 'text';
        content: string;
        idempotencyKey?: string;
        requestPayloadHash?: string;
    };

/**
 * Port for AI voice parsing operations.
 */
export interface VoiceParserPort {
    /**
     * Parse voice/text input into structured log data.
     */
    parseInput(input: VoiceInput, context: LogScope, crops: CropProfile[], profile: FarmerProfile, options?: { focusCategory?: string }): Promise<VoiceParseResult>;
}

// ============================================
// NOTIFICATION PORT
// ============================================

/**
 * Port for user notifications.
 */
export interface NotificationPort {
    /**
     * Show a success message.
     */
    success(message: string): void;

    /**
     * Show an error message.
     */
    error(message: string): void;

    /**
     * Show an info message.
     */
    info(message: string): void;
}

// ============================================
// STORAGE EVENTS
// ============================================

/**
 * Events emitted by storage operations.
 */
export type StorageEvent =
    | { type: 'LOG_CREATED'; log: DailyLog }
    | { type: 'LOG_UPDATED'; log: DailyLog }
    | { type: 'LOG_DELETED'; logId: string }
    | { type: 'LOGS_BATCH_SAVED'; count: number }
    | { type: 'VERIFICATION_UPDATED'; logId: string; status: LogVerificationStatus };

/**
 * Listener for storage events.
 */
export type StorageEventListener = (event: StorageEvent) => void;

// Dedicated audit boundary port
export type { AuditAction, AuditEntry, AuditPort } from './AuditPort';
export type { WeatherPort } from './WeatherPort';
