using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CheckSchedule;

/// <summary>One stage of an imported schedule, as the platform reviewer loads it.</summary>
public sealed record ImportScheduleStageInput(string Name, int StartDay, int EndDay);

/// <summary>
/// One activity of an imported schedule. <c>Key</c> is request-local; <c>AfterKey</c> (R34) names another activity of the
/// same request that this once-only work comes after; <c>Role</c> is optional (WORK-ID proposes it from the title).
/// <c>FrequencyMode</c> is <c>one_time | every_n_days | per_week</c> (or the enum names).
/// </summary>
public sealed record ImportScheduleActivityInput(
    string? Key,
    string Name,
    int StartDay,
    int EndDay,
    string FrequencyMode,
    int? IntervalDays,
    string? AfterKey = null,
    string? Role = null);

public sealed record ImportScheduleTemplateCommand(
    Guid CallerUserId,
    string Name,
    string? CropKey,
    string OwnerType,
    string? SourceLabel,
    IReadOnlyList<ImportScheduleStageInput> Stages,
    IReadOnlyList<ImportScheduleActivityInput> Activities,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record ImportScheduleTemplateResult(
    Guid TemplateId,
    int Version,
    bool HasStoredDays,
    int StageCount,
    int ActivityCount);

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 4; founder D-74, L8-R) - a ShramSafal PLATFORM reviewer loads a schedule with ALL its days:
/// name, crop key, owner type, source label, stages, activities (each with its start and end day, repeat, optional role, and
/// an optional order: <c>afterKey</c> names another activity of the same request, R34). The server mints every id and turns
/// <c>afterKey</c> into <c>after_activity_id</c>. The row is Public (the library's), and its first version's maker is him, so
/// its owner (<see cref="Services.ScheduleViewer.OwnerOfAsync"/>) is him. Part, operation key, role and nutrient key are
/// PROPOSED by WORK-ID's <c>WorkRecogniser</c> and stored; the checker ticks them with the row (D-104a, R4). The days are
/// stored, but nothing is checked: a check is a separate act (<see cref="RecordScheduleCheckHandler"/>).
/// </summary>
public sealed class ImportScheduleTemplateHandler(
    IShramSafalRepository repository,
    IEntitlementResolver entitlements,
    IClock clock)
{
    public async Task<Result<ImportScheduleTemplateResult>> HandleAsync(
        ImportScheduleTemplateCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<ImportScheduleTemplateResult>(ShramSafalErrors.InvalidCommand);
        }

        // A platform act: a farm seat of any role holds nothing here (E4).
        if (!await entitlements.MayCheckSchedulesAsync(new UserId(command.CallerUserId), ct))
        {
            return Result.Failure<ImportScheduleTemplateResult>(ShramSafalErrors.Forbidden);
        }

        if (!ScheduleOwnerTypeWire.TryParse(command.OwnerType, out var ownerType))
        {
            return Result.Failure<ImportScheduleTemplateResult>(Error.Validation(
                "ShramSafal.ScheduleImportOwnerType",
                "The owner type must be one of INSTITUTION, EXPERT, USER, SYSTEM_DEFAULT."));
        }

        // S006: a crop key must be a crop ShramSafal knows (it is listed under that crop's name); it is stored as given.
        if (!string.IsNullOrWhiteSpace(command.CropKey) && Services.ScheduleLibrary.CropTypeNameFor(command.CropKey) is null)
        {
            return Result.Failure<ImportScheduleTemplateResult>(Error.Validation(
                "ShramSafal.ScheduleImportCrop",
                $"The crop key \"{command.CropKey.Trim()}\" matches no crop ShramSafal knows."));
        }

        var activities = new List<ImportedActivity>(command.Activities?.Count ?? 0);
        foreach (var a in command.Activities ?? [])
        {
            if (!TryParseMode(a.FrequencyMode, out var mode))
            {
                return Result.Failure<ImportScheduleTemplateResult>(Error.Validation(
                    "ShramSafal.ScheduleImportRepeat",
                    $"\"{a.Name}\": the repeat must be one_time, every_n_days or per_week."));
            }

            activities.Add(new ImportedActivity(
                a.Key, a.Name ?? string.Empty, a.StartDay, a.EndDay, mode, a.IntervalDays ?? 1, a.AfterKey, a.Role));
        }

        var stages = (command.Stages ?? [])
            .Select(s => new StageDefinition(s.Name ?? string.Empty, s.StartDay, s.EndDay))
            .ToList();

        var now = clock.UtcNow;
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), command.Name, ownerType, command.SourceLabel, command.CropKey,
            new UserId(command.CallerUserId), TenantScope.Public, now, stages, activities, out var problem);
        if (template is null)
        {
            return Result.Failure<ImportScheduleTemplateResult>(Error.Validation(
                $"ShramSafal.{problem!.Code}", problem.Message));
        }

        await repository.AddScheduleTemplateAsync(template, ct);

        var audit = AuditEventFactory.Create(
            entityType: "ScheduleTemplate",
            entityId: template.Id,
            action: "schedule.imported",
            actorUserId: command.CallerUserId,
            actorRole: "platform",
            payload: new { templateId = template.Id, templateVersion = template.Version },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);
        await repository.AddAuditEventAsync(audit, ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new ImportScheduleTemplateResult(
            template.Id, template.Version, template.HasStoredDays, template.StageRows.Count, template.Activities.Count));
    }

    internal static bool TryParseMode(string? wire, out FrequencyMode mode)
    {
        switch (wire?.Trim().Replace("_", string.Empty).ToLowerInvariant())
        {
            case "onetime": mode = FrequencyMode.OneTime; return true;
            case "everyndays": mode = FrequencyMode.EveryNDays; return true;
            case "perweek": mode = FrequencyMode.PerWeek; return true;
            default: mode = FrequencyMode.OneTime; return false;
        }
    }
}
