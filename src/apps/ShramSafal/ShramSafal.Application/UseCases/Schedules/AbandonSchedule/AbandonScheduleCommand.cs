namespace ShramSafal.Application.UseCases.Schedules.AbandonSchedule;

public sealed record AbandonScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ActorUserId,
    string? ReasonText = null,
    string? ActorRole = null,
    string? ClientCommandId = null);
