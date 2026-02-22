namespace ShramSafal.Application.UseCases.Export.ExportDailySummary;

public sealed record ExportDailySummaryQuery(Guid FarmId, DateOnly Date);
