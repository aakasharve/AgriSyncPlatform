namespace ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;

public sealed record CreateCropCycleCommand(
    Guid FarmId,
    Guid PlotId,
    string CropName,
    string Stage,
    DateOnly StartDate,
    DateOnly? EndDate,
    Guid? CropCycleId = null);
