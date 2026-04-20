using System;

namespace ShramSafal.Application.UseCases.Export.ExportDailySummary;

public record ExportDailySummaryQuery(Guid FarmId, DateOnly Date);
