namespace ShramSafal.Application.UseCases.Farms.CreatePlot;

public sealed record CreatePlotCommand(
    Guid FarmId,
    string Name,
    decimal AreaInAcres,
    Guid? PlotId = null);
