import { agriSyncClient } from '../../infrastructure/api/AgriSyncClient';
import type { DeviceShareAndSaveService } from '../../infrastructure/device';

export type ReportType = 'daily' | 'monthly' | 'verification';

export interface DailyExportParams {
    farmId: string;
    date: string;
}

export interface MonthlyExportParams {
    farmId: string;
    year: number;
    month: number;
}

export interface VerificationExportParams {
    farmId: string;
    fromDate: string;
    toDate: string;
}

export type ExportReportInput =
    | { reportType: 'daily'; params: DailyExportParams; shareAfterSave?: boolean }
    | { reportType: 'monthly'; params: MonthlyExportParams; shareAfterSave?: boolean }
    | { reportType: 'verification'; params: VerificationExportParams; shareAfterSave?: boolean };

export interface ExportReportResult {
    fileName: string;
    savedPath: string;
}

export async function exportReport(
    input: ExportReportInput,
    deviceShareAndSaveService: DeviceShareAndSaveService
): Promise<ExportReportResult> {
    const { blob, fileName } = await fetchReportBlob(input);

    const savedPath = await deviceShareAndSaveService.saveToDownloads(
        fileName,
        blob,
        'application/pdf');

    if (input.shareAfterSave && await deviceShareAndSaveService.canShare()) {
        await deviceShareAndSaveService.share({
            title: 'ShramSafal Report',
            text: fileName,
            files: [{ path: savedPath, mimeType: 'application/pdf' }],
        });
    }

    return {
        fileName,
        savedPath,
    };
}

async function fetchReportBlob(input: ExportReportInput): Promise<{ blob: Blob; fileName: string }> {
    switch (input.reportType) {
        case 'daily': {
            const { farmId, date } = input.params;
            return {
                blob: await agriSyncClient.exportDailySummary(farmId, date),
                fileName: `daily-summary-${date}.pdf`,
            };
        }

        case 'monthly': {
            const { farmId, year, month } = input.params;
            const monthText = month.toString().padStart(2, '0');
            return {
                blob: await agriSyncClient.exportMonthlyCost(farmId, year, month),
                fileName: `monthly-cost-${year}-${monthText}.pdf`,
            };
        }

        case 'verification': {
            const { farmId, fromDate, toDate } = input.params;
            return {
                blob: await agriSyncClient.exportVerificationReport(farmId, fromDate, toDate),
                fileName: `verification-${fromDate}-to-${toDate}.pdf`,
            };
        }

        default:
            throw new Error('Unsupported report type.');
    }
}
