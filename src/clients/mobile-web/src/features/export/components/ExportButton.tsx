import React, { useEffect, useState } from 'react';
import Button from '../../../shared/components/ui/Button';
import { DownloadIcon } from 'lucide-react';
import { useExportReport, ReportType, ExportOptions } from '../hooks/useExportReport';

interface ExportButtonProps {
     reportType: ReportType;
     options: ExportOptions;
     label?: string;
     variant?: "primary" | "secondary" | "danger" | "ghost";
     className?: string;
}

export function ExportButton({
     reportType,
     options,
     label = "Export PDF",
     variant = "secondary",
     className
}: ExportButtonProps) {
     const { exportReport, isExporting, error } = useExportReport();
     const [successMessage, setSuccessMessage] = useState<string | null>(null);

     const handleExport = async () => {
          const success = await exportReport(reportType, options);
          if (success) {
               setSuccessMessage('PDF saved to Downloads');
               return;
          }

          if (error) {
               console.error("Failed to export:", error);
          }
     };

     useEffect(() => {
          if (!successMessage) {
               return;
          }

          const timer = window.setTimeout(() => setSuccessMessage(null), 2200);
          return () => window.clearTimeout(timer);
     }, [successMessage]);

     return (
          <div className="flex flex-col items-end gap-1">
               <Button
                    variant={variant}
                    onClick={handleExport}
                    isLoading={isExporting}
                    className={className}
                    icon={!isExporting ? <DownloadIcon className="h-4 w-4" /> : undefined}
               >
                    {label}
               </Button>
               {successMessage && (
                    <span className="text-[10px] font-semibold text-emerald-600">{successMessage}</span>
               )}
          </div>
     );
}
