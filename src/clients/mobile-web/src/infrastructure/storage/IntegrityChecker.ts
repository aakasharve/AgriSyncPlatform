/**
 * IntegrityChecker - Storage Integrity Verification
 *
 * Runs on app startup to verify storage health:
 * - JSON parse-ability of stored data
 * - Schema version compatibility
 * - Data structure validation
 *
 * Design principle: Log warnings, don't crash.
 * Corrupted data should be recoverable through backups.
 *
 * @module infrastructure/storage/IntegrityChecker
 */

import { CURRENT_SCHEMA_VERSION, STORAGE_KEYS } from './schema';

/**
 * Result of an integrity check for a single storage key.
 */
export interface IntegrityCheckResult {
    key: string;
    status: 'ok' | 'corrupted' | 'version_mismatch' | 'empty' | 'missing';
    schemaVersion?: number;
    expectedVersion?: number;
    error?: string;
    recordCount?: number;
}

/**
 * Overall integrity report for all storage.
 */
export interface IntegrityReport {
    timestamp: string;
    overallStatus: 'healthy' | 'degraded' | 'critical';
    checks: IntegrityCheckResult[];
    recommendations: string[];
}

/**
 * Severity levels for logging.
 */
type LogLevel = 'info' | 'warn' | 'error';

/**
 * IntegrityChecker verifies storage health on app startup.
 *
 * Usage:
 * ```typescript
 * const checker = new IntegrityChecker();
 * const report = checker.runFullCheck();
 * if (report.overallStatus !== 'healthy') {
 *     console.warn('Storage issues detected:', report.recommendations);
 * }
 * ```
 */
export class IntegrityChecker {
    private logger: (level: LogLevel, message: string, data?: unknown) => void;

    constructor(
        customLogger?: (level: LogLevel, message: string, data?: unknown) => void
    ) {
        this.logger = customLogger || this.defaultLogger;
    }

    private defaultLogger(level: LogLevel, message: string, data?: unknown): void {
        const prefix = '[IntegrityChecker]';
        switch (level) {
            case 'info':
                console.info(prefix, message, data ?? '');
                break;
            case 'warn':
                console.warn(prefix, message, data ?? '');
                break;
            case 'error':
                console.error(prefix, message, data ?? '');
                break;
        }
    }

    /**
     * Run a full integrity check on all storage keys.
     */
    runFullCheck(): IntegrityReport {
        const timestamp = new Date().toISOString();
        const checks: IntegrityCheckResult[] = [];
        const recommendations: string[] = [];

        // Check schema version
        const schemaCheck = this.checkSchemaVersion();
        checks.push(schemaCheck);

        if (schemaCheck.status === 'version_mismatch') {
            recommendations.push(
                `Schema version mismatch: found v${schemaCheck.schemaVersion}, expected v${schemaCheck.expectedVersion}. Migration may be required.`
            );
        }

        // Check logs storage
        const logsCheck = this.checkStorageKey(STORAGE_KEYS.LOGS, 'logs');
        checks.push(logsCheck);

        if (logsCheck.status === 'corrupted') {
            recommendations.push(
                `Logs storage is corrupted. Consider restoring from backup. Error: ${logsCheck.error}`
            );
        }

        // Check profile storage
        const profileCheck = this.checkStorageKey(STORAGE_KEYS.PROFILE, 'profile');
        checks.push(profileCheck);

        if (profileCheck.status === 'corrupted') {
            recommendations.push(
                `Profile storage is corrupted. Consider restoring from backup. Error: ${profileCheck.error}`
            );
        }

        // Check tasks storage
        const tasksCheck = this.checkStorageKey(STORAGE_KEYS.TASKS, 'tasks');
        checks.push(tasksCheck);

        if (tasksCheck.status === 'corrupted') {
            recommendations.push(
                `Tasks storage is corrupted. Consider restoring from backup. Error: ${tasksCheck.error}`
            );
        }

        // Determine overall status
        const overallStatus = this.determineOverallStatus(checks);

        const report: IntegrityReport = {
            timestamp,
            overallStatus,
            checks,
            recommendations,
        };

        // Log the report
        if (overallStatus === 'healthy') {
            this.logger('info', 'Storage integrity check passed', {
                recordCounts: checks
                    .filter((c) => c.recordCount !== undefined)
                    .reduce(
                        (acc, c) => ({ ...acc, [c.key]: c.recordCount }),
                        {}
                    ),
            });
        } else if (overallStatus === 'degraded') {
            this.logger('warn', 'Storage integrity issues detected', report);
        } else {
            this.logger('error', 'Critical storage integrity failures', report);
        }

        return report;
    }

    /**
     * Check the stored schema version.
     */
    private checkSchemaVersion(): IntegrityCheckResult {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);

            if (stored === null) {
                // First run or legacy data - set the version
                localStorage.setItem(
                    STORAGE_KEYS.SCHEMA_VERSION,
                    String(CURRENT_SCHEMA_VERSION)
                );
                this.logger('info', 'Schema version initialized', {
                    version: CURRENT_SCHEMA_VERSION,
                });
                return {
                    key: STORAGE_KEYS.SCHEMA_VERSION,
                    status: 'ok',
                    schemaVersion: CURRENT_SCHEMA_VERSION,
                    expectedVersion: CURRENT_SCHEMA_VERSION,
                };
            }

            const version = parseInt(stored, 10);

            if (isNaN(version)) {
                return {
                    key: STORAGE_KEYS.SCHEMA_VERSION,
                    status: 'corrupted',
                    error: `Invalid schema version value: ${stored}`,
                    expectedVersion: CURRENT_SCHEMA_VERSION,
                };
            }

            if (version !== CURRENT_SCHEMA_VERSION) {
                return {
                    key: STORAGE_KEYS.SCHEMA_VERSION,
                    status: 'version_mismatch',
                    schemaVersion: version,
                    expectedVersion: CURRENT_SCHEMA_VERSION,
                };
            }

            return {
                key: STORAGE_KEYS.SCHEMA_VERSION,
                status: 'ok',
                schemaVersion: version,
                expectedVersion: CURRENT_SCHEMA_VERSION,
            };
        } catch (error) {
            return {
                key: STORAGE_KEYS.SCHEMA_VERSION,
                status: 'corrupted',
                error: error instanceof Error ? error.message : String(error),
                expectedVersion: CURRENT_SCHEMA_VERSION,
            };
        }
    }

    /**
     * Check a specific storage key for JSON validity and structure.
     */
    private checkStorageKey(
        key: string,
        dataType: 'logs' | 'profile' | 'tasks'
    ): IntegrityCheckResult {
        try {
            const stored = localStorage.getItem(key);

            if (stored === null) {
                return {
                    key,
                    status: 'missing',
                };
            }

            if (stored.trim() === '') {
                return {
                    key,
                    status: 'empty',
                };
            }

            // Attempt JSON parse
            const parsed = JSON.parse(stored);

            // Type-specific validation
            switch (dataType) {
                case 'logs':
                    return this.validateLogsStructure(key, parsed);
                case 'profile':
                    return this.validateProfileStructure(key, parsed);
                case 'tasks':
                    return this.validateTasksStructure(key, parsed);
                default:
                    return {
                        key,
                        status: 'ok',
                    };
            }
        } catch (error) {
            if (error instanceof SyntaxError) {
                return {
                    key,
                    status: 'corrupted',
                    error: `JSON parse error: ${error.message}`,
                };
            }
            return {
                key,
                status: 'corrupted',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Validate logs storage structure.
     */
    private validateLogsStructure(
        key: string,
        parsed: unknown
    ): IntegrityCheckResult {
        if (!Array.isArray(parsed)) {
            return {
                key,
                status: 'corrupted',
                error: 'Logs storage is not an array',
            };
        }

        // Check each log has required fields
        const validLogs = parsed.filter(
            (log) =>
                log &&
                typeof log === 'object' &&
                typeof log.id === 'string' &&
                typeof log.date === 'string'
        );

        if (validLogs.length !== parsed.length) {
            this.logger('warn', 'Some logs have invalid structure', {
                total: parsed.length,
                valid: validLogs.length,
            });
        }

        return {
            key,
            status: 'ok',
            recordCount: validLogs.length,
        };
    }

    /**
     * Validate profile storage structure.
     */
    private validateProfileStructure(
        key: string,
        parsed: unknown
    ): IntegrityCheckResult {
        if (parsed === null || typeof parsed !== 'object') {
            return {
                key,
                status: 'corrupted',
                error: 'Profile storage is not an object',
            };
        }

        // Basic profile shape check
        const profile = parsed as Record<string, unknown>;
        if (typeof profile.name !== 'string') {
            return {
                key,
                status: 'corrupted',
                error: 'Profile missing required "name" field',
            };
        }

        return {
            key,
            status: 'ok',
            recordCount: 1,
        };
    }

    /**
     * Validate tasks storage structure.
     */
    private validateTasksStructure(
        key: string,
        parsed: unknown
    ): IntegrityCheckResult {
        if (!Array.isArray(parsed)) {
            return {
                key,
                status: 'corrupted',
                error: 'Tasks storage is not an array',
            };
        }

        return {
            key,
            status: 'ok',
            recordCount: parsed.length,
        };
    }

    /**
     * Determine overall status from individual checks.
     */
    private determineOverallStatus(
        checks: IntegrityCheckResult[]
    ): 'healthy' | 'degraded' | 'critical' {
        const hasCorrupted = checks.some((c) => c.status === 'corrupted');
        const hasVersionMismatch = checks.some(
            (c) => c.status === 'version_mismatch'
        );

        if (hasCorrupted) {
            // Check if logs are corrupted (critical)
            const logsCorrupted = checks.some(
                (c) => c.key === STORAGE_KEYS.LOGS && c.status === 'corrupted'
            );
            return logsCorrupted ? 'critical' : 'degraded';
        }

        if (hasVersionMismatch) {
            return 'degraded';
        }

        return 'healthy';
    }

    /**
     * Quick check if storage is usable (doesn't throw).
     * Use this for fast startup checks.
     */
    isStorageUsable(): boolean {
        try {
            const testKey = '__agrilog_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch {
            this.logger('error', 'localStorage is not available');
            return false;
        }
    }
}

/**
 * Run integrity check on app startup.
 * This is the main entry point for startup verification.
 */
export function runStartupIntegrityCheck(): IntegrityReport {
    const checker = new IntegrityChecker();

    if (!checker.isStorageUsable()) {
        return {
            timestamp: new Date().toISOString(),
            overallStatus: 'critical',
            checks: [],
            recommendations: [
                'localStorage is not available. The app cannot persist data.',
            ],
        };
    }

    return checker.runFullCheck();
}
