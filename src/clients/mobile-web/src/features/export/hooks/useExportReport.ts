import { useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';

export type ReportType = 'daily-summary' | 'monthly-cost' | 'verification';

export interface ExportOptions {
     farmId: string;
     date?: string; // Format: YYYY-MM-DD
     year?: number;
     month?: number;
     fromDate?: string; // Format: YYYY-MM-DD
     toDate?: string; // Format: YYYY-MM-DD
     fileName: string;
}

export function useExportReport() {
     const [isExporting, setIsExporting] = useState(false);
     const [error, setError] = useState<Error | null>(null);

     const exportReport = async (type: ReportType, options: ExportOptions) => {
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

               // Create a File from Blob to share or download
               const file = new File([blob], options.fileName, { type: 'application/pdf' });

               // Try the Web Share API first
               if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                         await navigator.share({
                              files: [file],
                              title: 'Farm Report',
                              text: `Here is the ${type} report.`
                         });
                         // Successfully shared, no need to download
                         return true;
                    } catch (shareError) {
                         console.error("User cancelled share or share failed", shareError);
                         // Fall back to download
                    }
               }

               // Fallback: Trigger download
               const url = window.URL.createObjectURL(blob);
               const link = document.createElement('a');
               link.href = url;
               link.download = options.fileName;
               document.body.appendChild(link);
               link.click();
               document.body.removeChild(link);
               window.URL.revokeObjectURL(url);

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
          error
     };
}
