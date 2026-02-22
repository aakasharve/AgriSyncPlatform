import { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../types';
import { LogsRepository, VoiceParseResult, WeatherPort } from '../ports';
import { mutationQueue } from '../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../infrastructure/sync/BackgroundSyncWorker';
import { captureLocation } from '../use-cases/CaptureLocation';

export interface CreateLogsFromManualInput {
    formData: any;
    logScope: LogScope;
    crops: CropProfile[];
    profile: FarmerProfile;
}

export interface CreateLogsFromVoiceInput {
    voiceResult: VoiceParseResult;
    logScope: LogScope;
    crops: CropProfile[];
    profile: FarmerProfile;
    enrichWithWeather?: boolean;
}

export interface CreateLogsResult {
    success: boolean;
    logs: DailyLog[];
    error?: string;
}

function tryExtractFarmId(crops: CropProfile[]): string | undefined {
    for (const crop of crops) {
        for (const plot of crop.plots) {
            const candidate = (plot as any).farmId;
            if (typeof candidate === 'string' && candidate.length > 0) {
                return candidate;
            }
        }
    }

    return undefined;
}

async function triggerSyncBestEffort(): Promise<void> {
    try {
        await backgroundSyncWorker.triggerNow();
    } catch {
        // Fire-and-forget sync trigger; queue durability is the source of safety.
    }
}

export async function createLogsFromManualEntry(
    input: CreateLogsFromManualInput,
    _repository: LogsRepository
): Promise<CreateLogsResult> {
    try {
        const farmId = tryExtractFarmId(input.crops);
        const location = await captureLocation();

        await mutationQueue.enqueue('create_daily_log', {
            farmId,
            selectedCropIds: input.logScope.selectedCropIds,
            selectedPlotIds: input.logScope.selectedPlotIds,
            applyPolicy: input.logScope.applyPolicy,
            mode: input.logScope.mode,
            capturedAtUtc: new Date().toISOString(),
            source: 'manual',
            draft: input.formData,
            location,
        });

        await triggerSyncBestEffort();

        return {
            success: true,
            logs: [],
        };
    } catch (error) {
        return {
            success: false,
            logs: [],
            error: error instanceof Error ? error.message : 'Failed to queue manual log mutation.',
        };
    }
}

export async function createLogsFromVoiceResult(
    input: CreateLogsFromVoiceInput,
    _repository: LogsRepository,
    _weatherPort?: WeatherPort
): Promise<CreateLogsResult> {
    try {
        const farmId = tryExtractFarmId(input.crops);
        const location = await captureLocation();

        await mutationQueue.enqueue('create_daily_log', {
            farmId,
            selectedCropIds: input.logScope.selectedCropIds,
            selectedPlotIds: input.logScope.selectedPlotIds,
            applyPolicy: input.logScope.applyPolicy,
            mode: input.logScope.mode,
            capturedAtUtc: new Date().toISOString(),
            source: 'voice',
            draft: input.voiceResult.data,
            provenance: input.voiceResult.provenance,
            rawTranscript: input.voiceResult.rawTranscript,
            location,
        });

        await triggerSyncBestEffort();

        return {
            success: true,
            logs: [],
        };
    } catch (error) {
        return {
            success: false,
            logs: [],
            error: error instanceof Error ? error.message : 'Failed to queue voice log mutation.',
        };
    }
}
