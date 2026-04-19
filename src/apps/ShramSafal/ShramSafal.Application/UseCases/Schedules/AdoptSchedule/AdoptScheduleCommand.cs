namespace ShramSafal.Application.UseCases.Schedules.AdoptSchedule;

public sealed record AdoptScheduleCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    Guid ScheduleTemplateId,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientCommandId = null,
    Guid? SubscriptionId = null);
