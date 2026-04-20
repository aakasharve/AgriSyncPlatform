using System;

namespace ShramSafal.Application.UseCases.Export.ExportVerificationReport;

public record ExportVerificationReportQuery(Guid FarmId, DateOnly FromDate, DateOnly ToDate);
