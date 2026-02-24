using System;

namespace ShramSafal.Application.UseCases.Export.ExportMonthlyCost;

public record ExportMonthlyCostQuery(Guid FarmId, int Year, int Month);
