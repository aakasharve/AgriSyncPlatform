namespace ShramSafal.Application.UseCases.Export.ExportMonthlyCost;

public sealed record ExportMonthlyCostQuery(Guid FarmId, int Year, int Month);
