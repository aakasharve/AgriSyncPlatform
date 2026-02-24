import React from 'react';
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

     const handleExport = async () => {
          const success = await exportReport(reportType, options);
          if (!success && error) {
               console.error("Failed to export:", error);
          }
     };

     return (
          <Button
               variant={variant}
               onClick={handleExport}
               isLoading={isExporting}
               className={className}
               icon={!isExporting ? <DownloadIcon className="h-4 w-4" /> : undefined}
          >
               {label}
          </Button>
     );
}
