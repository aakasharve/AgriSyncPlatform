namespace ShramSafal.Application.Ports.External;

public sealed record FarmContext(
    Guid FarmId,
    string FarmName,
    Guid? PlotId,
    string? PlotName,
    Guid? CropCycleId,
    string? CropName,
    string? CropStage);
