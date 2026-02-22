namespace ShramSafal.Application.UseCases.Export.ExportVerificationReport;

public sealed record ExportVerificationReportQuery(Guid FarmId, DateOnly FromDate, DateOnly ToDate);
