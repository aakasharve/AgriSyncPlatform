using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CheckSchedule;

/// <summary>One stage of a reference schedule in format 2: stored days, and the sign it starts or ends on (optional words).</summary>
public sealed record ImportReferenceStageInput(string Name, int StartDay, int EndDay, string? StartSign = null, string? EndSign = null);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) - a whole reference schedule in FORMAT 2. <c>Format</c> must be 2. <c>Tasks</c> and
/// <c>Challenges</c> are the canonical task-format JSON objects (read strictly: an unknown key is a refusal). <c>PreviousVersionId</c> null = version 1 of a new
/// chain (today always); else the next version of that library row.
/// </summary>
public sealed record ImportReferenceScheduleCommand(
    Guid CallerUserId,
    int? Format,
    string Name,
    string? CropKey,
    string OwnerType,
    string? SourceLabel,
    Guid? PreviousVersionId,
    IReadOnlyList<ImportReferenceStageInput> Stages,
    IReadOnlyList<JsonElement> Tasks,
    IReadOnlyList<JsonElement> Challenges,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record ImportReferenceScheduleResult(
    Guid TemplateId,
    Guid? ChainId,
    int Version,
    string ContentHash,
    int StageCount,
    int TaskCount,
    int ChallengeCount,
    int ProjectedActivityCount,
    bool HasStoredDays);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7, "Reference schedules in the format") - a ShramSafal PLATFORM reviewer loads a reference schedule
/// in format 2 (<c>POST /shramsafal/schedule-templates/import/format-2</c>, a NEW route: the old import keeps its shape). It becomes a library row (Public) whose
/// maker is him, in its own chain, UNCHECKED: a check is a separate act by ANOTHER person (<see cref="RecordScheduleCheckHandler"/>). Every day task the old rules
/// can hold is also written as a stored activity, so a 1.0.17 phone reads the schedule once it is checked; nothing else reaches an old phone.
/// </summary>
public sealed class ImportReferenceScheduleHandler(
    IShramSafalRepository repository,
    IEntitlementResolver entitlements,
    IClock clock)
{
    public const int ReferenceFormat = ReferenceScheduleImporter.ReferenceFormat;

    public async Task<Result<ImportReferenceScheduleResult>> HandleAsync(
        ImportReferenceScheduleCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<ImportReferenceScheduleResult>(ShramSafalErrors.InvalidCommand);
        }

        // A platform act: a farm seat of any role holds nothing here (E4).
        if (!await entitlements.MayCheckSchedulesAsync(new UserId(command.CallerUserId), ct))
        {
            return Result.Failure<ImportReferenceScheduleResult>(ShramSafalErrors.Forbidden);
        }

        // The ONE importer: the creator door's submissions are read, refused and built by these same rules (slice 15).
        var built = await ReferenceScheduleImporter.BuildAsync(
            repository,
            new ReferenceScheduleBody(
                command.Format, command.Name, command.CropKey, command.OwnerType, command.SourceLabel, command.PreviousVersionId,
                command.Stages, command.Tasks, command.Challenges),
            new UserId(command.CallerUserId),
            Guid.NewGuid(),
            clock.UtcNow,
            ct);
        if (!built.IsSuccess)
        {
            return Result.Failure<ImportReferenceScheduleResult>(built.Error);
        }

        var template = built.Value;

        await repository.AddScheduleTemplateAsync(template, ct);

        var audit = AuditEventFactory.Create(
            entityType: "ScheduleTemplate",
            entityId: template.Id,
            action: "schedule.imported",
            actorUserId: command.CallerUserId,
            actorRole: "platform",
            payload: new { templateId = template.Id, templateVersion = template.Version, format = ReferenceFormat },
            farmId: null,
            clientCommandId: null,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);
        await repository.AddAuditEventAsync(audit, ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new ImportReferenceScheduleResult(
            template.Id, template.ChainId, template.Version, template.TaskFormatHash()!, template.StageRows.Count,
            template.Tasks.Count, template.Challenges.Count, template.Activities.Count, template.HasStoredDays));
    }

}
