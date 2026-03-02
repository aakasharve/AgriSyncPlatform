import { useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { deviceShareAndSaveService } from '../../../infrastructure/device/DeviceShareAndSaveService';

export type ReportType = 'daily-summary' | 'monthly-cost' | 'verification';

export interface ExportOptions {
     farmId: string;
     date?: string; // Format: YYYY-MM-DD
     year?: number;
     month?: number;
     fromDate?: string; // Format: YYYY-MM-DD
     toDate?: string; // Format: YYYY-MM-DD
     fileName: string;
     tryShare?: boolean;
}

export function useExportReport() {
     const [isExporting, setIsExporting] = useState(false);
     const [error, setError] = useState<Error | null>(null);
     const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);

     const exportReport = async (type: ReportType, options: ExportOptions): Promise<boolean> => {
          setIsExporting(true);
          setError(null);

          try {
               let blob: Blob;

               switch (type) {
                    case 'daily-summary':
                         if (!options.date) throw new Error("date is required for daily-summary");
                         blob = await agriSyncClient.exportDailySummary(options.farmId, options.date);
                         break;
                    case 'monthly-cost':
                         if (options.year === undefined || options.month === undefined) throw new Error("year and month required for monthly-cost");
                         blob = await agriSyncClient.exportMonthlyCost(options.farmId, options.year, options.month);
                         break;
                    case 'verification':
                         if (!options.fromDate || !options.toDate) throw new Error("fromDate and toDate required for verification");
                         blob = await agriSyncClient.exportVerificationReport(options.farmId, options.fromDate, options.toDate);
                         break;
                    default:
                         throw new Error(`Unsupported report type: ${type}`);
               }

               const shouldTryShare = options.tryShare ?? true;
               const wasShared = shouldTryShare
                    ? await deviceShareAndSaveService.shareFile(blob, options.fileName, {
                         title: 'Farm Report',
                         text: `Here is the ${type} report.`,
                         mimeType: 'application/pdf',
                    })
                    : false;

               if (!wasShared) {
                    await deviceShareAndSaveService.saveToDownloads(blob, options.fileName, 'application/pdf');
               }

               setLastExportedAt(new Date().toISOString());

               return true;
          } catch (err) {
               console.error("Export error:", err);
               setError(err instanceof Error ? err : new Error(String(err)));
               return false;
          } finally {
               setIsExporting(false);
          }
     };

     return {
          exportReport,
          isExporting,
          lastExportedAt,
          error,
     };
}
