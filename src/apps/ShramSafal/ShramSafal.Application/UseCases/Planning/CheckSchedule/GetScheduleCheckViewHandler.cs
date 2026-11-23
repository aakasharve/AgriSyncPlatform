using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CheckSchedule;

/// <summary>
/// A stored day as the checker reads it, through the ONE server day helper (<see cref="ScheduleDayNumbers"/>): <c>Shown</c> = stored + 1 for the start day and
/// after; a day before the start day is never printed as day 0 or a negative day but as <c>DaysBeforeStart</c> ("N days before").
/// </summary>
public sealed record ShownDayDto(int Stored, int? Shown, int? DaysBeforeStart)
{
    public static ShownDayDto? Of(int? stored) =>
        stored is not { } s ? null : new ShownDayDto(s, s < 0 ? null : ScheduleDayNumbers.ShownFromStored(s), ScheduleDayNumbers.DaysBeforeStart(s));
}

public sealed record CheckStageDto(int Index, string Name, ShownDayDto From, ShownDayDto To, string? StartSign, string? EndSign);

/// <summary>The shown days of one task's timing (all null for a dayless task, which is never given a day).</summary>
public sealed record CheckTaskDaysDto(ShownDayDto? From, ShownDayDto? To, ShownDayDto? ExpectedFrom, ShownDayDto? ExpectedTo, ShownDayDto? RepeatEnd);

/// <summary>One task as the checker ticks it: its key, its own content hash, EVERY field (the canonical task JSON), and its days as shown.</summary>
public sealed record CheckTaskDto(string TaskKey, string ContentHash, JsonElement Task, CheckTaskDaysDto Shown, bool ProjectedForOldPhones);

public sealed record CheckChallengeDto(string ChallengeKey, string ContentHash, JsonElement Challenge);

/// <summary>
/// spec: plr-d10 schedule slice 7 - one library row as the platform checker sees it before ticking: who it comes from, the version, the chain, who MADE it (that
/// person may not approve it: <see cref="MadeByCaller"/>), the content hash the ticks are recorded on, its state, and every stage, task and challenge in full.
/// </summary>
public sealed record ScheduleCheckViewDto(
    Guid Id,
    string Name,
    int Version,
    Guid? ChainId,
    Guid? PreviousVersionId,
    string? CropKey,
    string? OwnerType,
    string? SourceLabel,
    Guid? MadeByUserId,
    bool MadeByCaller,
    DateTime CreatedAtUtc,
    string? ContentHash,
    ScheduleCheckDto Check,
    IReadOnlyList<string>? CheckedTaskKeys,
    IReadOnlyList<CheckStageDto> Stages,
    IReadOnlyList<CheckTaskDto> Tasks,
    IReadOnlyList<CheckChallengeDto> Challenges,
    int ProjectedActivityCount);

/// <summary>
/// spec: plr-d10 schedule slice 7 - <c>GET /shramsafal/schedule-templates/{id}/check-view</c>: a library row in the task format with everything the checker must
/// see. The platform review seat only (read on <c>schedules.review</c>); a farm seat of any role is refused; a row that is not Public is answered as unknown.
/// </summary>
public sealed class GetScheduleCheckViewHandler(IShramSafalRepository repository, IEntitlementResolver entitlements)
{
    public async Task<Result<ScheduleCheckViewDto>> HandleAsync(Guid callerUserId, Guid templateId, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty || templateId == Guid.Empty)
        {
            return Result.Failure<ScheduleCheckViewDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!await entitlements.MayReadScheduleChecksAsync(new UserId(callerUserId), ct))
        {
            return Result.Failure<ScheduleCheckViewDto>(ShramSafalErrors.Forbidden);
        }

        var template = await repository.GetScheduleTemplateWithTasksByIdAsync(templateId, ct);
        if (template is null || template.TenantScope != TenantScope.Public || !template.IsInTaskFormat)
        {
            return Result.Failure<ScheduleCheckViewDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var checks = await repository.GetScheduleChecksAsync([template.Id], ct);
        var latest = ScheduleCheck.Latest(checks);
        var checkDto = latest is null
            ? new ScheduleCheckDto(nameof(ScheduleCheckState.NotChecked), null, null, null)
            : new ScheduleCheckDto(ScheduleCheck.StateOf(checks).ToString(), latest.CheckerDisplayName, latest.CheckedAtUtc, latest.Note);

        var projected = template.ProjectedTaskKeyByActivity().Values.ToHashSet(StringComparer.Ordinal);
        var stages = template.OwnStages()
            .Select((s, i) => new CheckStageDto(i, s.Name, ShownDayDto.Of(s.StartDay)!, ShownDayDto.Of(s.EndDay)!, s.StartSign, s.EndSign))
            .ToList();
        var tasks = template.Tasks
            .OrderBy(t => t.StageIndex).ThenBy(t => t.Order).ThenBy(t => t.TaskKey, StringComparer.Ordinal)
            .Select(t =>
            {
                var timing = t.Content.Timing;
                return new CheckTaskDto(
                    t.TaskKey,
                    t.ContentHash,
                    Element(t.Content.ToCanonicalJson()),
                    new CheckTaskDaysDto(
                        ShownDayDto.Of(timing.FromDay), ShownDayDto.Of(timing.ToDay),
                        ShownDayDto.Of(timing.ExpectedFromDay), ShownDayDto.Of(timing.ExpectedToDay), ShownDayDto.Of(timing.RepeatEndDay)),
                    projected.Contains(t.TaskKey));
            })
            .ToList();
        var challenges = template.Challenges
            .OrderBy(c => c.StageIndex).ThenBy(c => c.Order).ThenBy(c => c.ChallengeKey, StringComparer.Ordinal)
            .Select(c => new CheckChallengeDto(c.ChallengeKey, c.ContentHash, Element(c.Content.ToCanonicalJson())))
            .ToList();

        return Result.Success(new ScheduleCheckViewDto(
            template.Id,
            template.Name,
            template.Version,
            template.ChainId,
            template.PreviousVersionId,
            template.CropKey,
            template.OwnerType is { } owner ? ScheduleOwnerTypeWire.ToWire(owner) : null,
            template.SourceLabel,
            template.CreatedByUserId?.Value,
            template.CreatedByUserId?.Value == callerUserId,
            template.CreatedAtUtc,
            template.TaskFormatHash(),
            checkDto,
            latest?.Decision == ScheduleCheckDecision.Approved ? latest.CheckedTaskKeys : null,
            stages,
            tasks,
            challenges,
            template.Activities.Count));
    }

    /// <summary>The canonical JSON as a free-standing element (every field, exactly as stored and hashed).</summary>
    internal static JsonElement Element(string canonicalJson)
    {
        using var document = JsonDocument.Parse(canonicalJson);
        return document.RootElement.Clone();
    }
}
