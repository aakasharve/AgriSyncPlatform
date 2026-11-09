namespace ShramSafal.Application.Contracts.Dtos;

public sealed record ScheduleSubscriptionDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string CropKey,
    Guid ScheduleTemplateId,
    string ScheduleVersionTag,
    DateTime AdoptedAtUtc,
    string State,
    Guid? MigratedFromSubscriptionId,
    Guid? MigratedToSubscriptionId,
    string? MigrationReason,
    DateTime? StateChangedAtUtc,
    // spec: plr-d10 lane L8b-1 — the plot's day 0 (null = the crop season's start). Additive, last (P11).
    DateOnly? ReferenceDate = null,
    // spec: plr-d10 lane L8b-1F - additive at the END and optional (P11). CheckState is what ShramSafal's check says NOW about the
    // schedule this follows (Checked | NotChecked | Returned | Withdrawn; a withdrawal changes it, never the subscription - R8).
    // Origin is Outside | Own; null = chosen before this lane, read as Outside.
    string? CheckState = null,
    string? Origin = null,
    // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - additive at the END and optional (P11). The place this schedule holds on its
    // plot-season: 0 = his own, 1..3 = outside; null = it holds none (written by a binary that sets none).
    short? Slot = null);
