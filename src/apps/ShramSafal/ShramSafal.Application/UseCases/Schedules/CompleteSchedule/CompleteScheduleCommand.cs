namespace ShramSafal.Application.UseCases.Schedules.CompleteSchedule;

public sealed record CompleteScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientCommandId = null);
