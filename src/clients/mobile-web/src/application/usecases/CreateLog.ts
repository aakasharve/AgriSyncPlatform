/**
 * CreateLog Use-Case
 *
 * Orchestrates the creation of DailyLog entries from various sources.
 * This is the SINGLE entry point for log creation.
 *
 * Sources:
 * - Manual entry form
 * - Voice recording (AI parsed)
 *
 * Responsibilities:
 * - Validate input
 * - Create log entities via LogFactory
 * - Enrich with weather data
 * - Persist to repository
 * - Emit events for UI updates
 */

import { DailyLog, LogScope, CropProfile, FarmerProfile, WeatherStamp } from '../../types';
import { LogFactory } from '../../core/domain/LogFactory';
import { LogsRepository, WeatherPort, VoiceParseResult } from '../ports';

/**
 * Input for creating logs from manual entry.
 */
export interface CreateLogsFromManualInput {
    formData: any; // Raw form data (to be typed as ManualEntryData)
    logScope: LogScope;
    crops: CropProfile[];
    profile: FarmerProfile;
}

/**
 * Input for creating logs from voice result.
 */
export interface CreateLogsFromVoiceInput {
    voiceResult: VoiceParseResult;
    logScope: LogScope;
    crops: CropProfile[];
    profile: FarmerProfile;
    enrichWithWeather?: boolean;
}

/**
 * Result of log creation.
 */
export interface CreateLogsResult {
    success: boolean;
    logs: DailyLog[];
    error?: string;
}

/**
 * Use-case for creating logs from manual entry.
 *
 * Phase 1: This is a thin wrapper that calls existing services.
 * Phase 2: Will add validation, weather enrichment, and proper error handling.
 */
export async function createLogsFromManualEntry(
    input: CreateLogsFromManualInput,
    repository: LogsRepository
): Promise<CreateLogsResult> {
    try {
        // 1. Create logs via factory
        const logs = LogFactory.createFromManualEntry(
            input.formData,
            input.logScope,
            input.crops,
            input.profile
        );

        if (logs.length === 0) {
            return {
                success: false,
                logs: [],
                error: 'No logs created - check selection context'
            };
        }

        // 2. Persist to repository
        await repository.batchSave(logs);

        // 3. Return success
        return {
            success: true,
            logs
        };
    } catch (error) {
        return {
            success: false,
            logs: [],
            error: error instanceof Error ? error.message : 'Unknown error creating logs'
        };
    }
}

/**
 * Use-case for creating logs from voice parsing result.
 *
 * Phase 1: This is a thin wrapper that calls existing services.
 * Phase 2: Will add weather enrichment and proper error handling.
 */
export async function createLogsFromVoiceResult(
    input: CreateLogsFromVoiceInput,
    repository: LogsRepository,
    weatherPort?: WeatherPort
): Promise<CreateLogsResult> {
    try {
        // 1. Optionally fetch weather for plots
        let weatherStamps: Record<string, WeatherStamp> | undefined;

        if (input.enrichWithWeather && weatherPort) {
            weatherStamps = {};
            await Promise.all(input.logScope.selectedPlotIds.map(async (plotId) => {
                const crop = input.crops.find(c => c.plots.some(p => p.id === plotId));
                const plot = crop?.plots.find(p => p.id === plotId);
                if (!plot?.geo) return;

                try {
                    const stamp = await weatherPort.getCurrentWeather(plot.geo);
                    weatherStamps![plotId] = { ...stamp, plotId };
                } catch {
                    // Weather enrichment is best-effort and must not block log creation
                }
            }));
        }

        if (!input.voiceResult.data) {
            return {
                success: false,
                logs: [],
                error: 'No structured data in voice result'
            };
        }

        // 2. Create logs via factory
        const logs = LogFactory.createFromVoiceResult(
            input.voiceResult.data,
            input.logScope,
            input.crops,
            input.profile,
            weatherStamps,
            input.voiceResult.provenance
        );

        if (logs.length === 0) {
            return {
                success: false,
                logs: [],
                error: 'No logs created from voice result'
            };
        }

        // 3. Persist to repository
        await repository.batchSave(logs);

        // 4. Return success
        return {
            success: true,
            logs
        };
    } catch (error) {
        return {
            success: false,
            logs: [],
            error: error instanceof Error ? error.message : 'Unknown error creating logs from voice'
        };
    }
}
