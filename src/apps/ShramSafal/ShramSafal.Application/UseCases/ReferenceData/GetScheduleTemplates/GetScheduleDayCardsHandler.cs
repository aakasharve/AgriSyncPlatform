using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8, "Rich day cards, one renderer"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 5)

/// <summary>Who made a version, as far as a reader may be told: the kind of maker and the label the import gave (an institution's name). Never a person.</summary>
public sealed record DayCardsMadeByDto(string? OwnerType, string? Label);

/// <summary>
/// What the check says about this version. <c>IsChecked</c> is true only for the latest decision "Checked" on the version's own content; an unchecked reference
/// is readable and says so. <c>CheckedBy</c> is the display name the checker gave, <c>null</c> when nobody has checked it.
/// </summary>
public sealed record DayCardsCheckDto(string State, bool IsChecked, string? CheckedBy, DateTime? CheckedAtUtc);

/// <summary>One task: its key, its own hash, every field (canonical task JSON), its shown days, and whether its doses may be shown as checked.</summary>
public sealed record DayCardTaskDto(string TaskKey, string ContentHash, JsonElement Task, CheckTaskDaysDto Shown, bool DoseChecked);

/// <summary>
/// One version of a schedule as the day cards draw it: <c>Kind</c> is <c>reference</c> (a library row, which has a check) or <c>own</c> (a person's or
/// team's own copy, which no check applies to). Carries the version's content hash so a phone's offline copy knows when it is stale.
/// </summary>
public sealed record ScheduleDayCardsDto(
    Guid TemplateId,
    Guid? ChainId,
    int Version,
    string ContentHash,
    string Kind,
    string Name,
    string? CropKey,
    DayCardsMadeByDto MadeBy,
    DayCardsCheckDto Check,
    IReadOnlyList<CheckStageDto> Stages,
    IReadOnlyList<DayCardTaskDto> Tasks,
    IReadOnlyList<CheckChallengeDto> Challenges);

/// <summary>
/// <c>GET /shramsafal/reference/schedule-templates/{id}/day-cards?scheduleFormat=2</c> - a NEW route (no key of any older payload changes). The version must be one
/// this caller may see (<see cref="ScheduleViewer"/>, the one visibility rule: a Public row, his own schedule, his team's); anything else is answered as unknown
/// (E4). Unlike the task-format route, an UNCHECKED reference is returned (spec decision 5: readable and marked): its check says so and no task's dose is
/// presented as checked.
/// </summary>
public sealed class GetScheduleDayCardsHandler(IShramSafalRepository repository)
{
    public async Task<Result<ScheduleDayCardsDto>> HandleAsync(Guid callerUserId, Guid templateId, int? scheduleFormat, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty || templateId == Guid.Empty)
        {
            return Result.Failure<ScheduleDayCardsDto>(ShramSafalErrors.InvalidCommand);
        }

        if (scheduleFormat is not >= GetScheduleTaskFormatHandler.Format)
        {
            return Result.Failure<ScheduleDayCardsDto>(Error.Validation(
                "ShramSafal.ScheduleFormatNotDeclared",
                $"This route serves the task format to a phone that declares scheduleFormat={GetScheduleTaskFormatHandler.Format}."));
        }

        var template = await repository.GetScheduleTemplateWithTasksByIdAsync(templateId, ct);
        if (template is null || !template.IsInTaskFormat || template.TaskFormatHash() is not { } hash)
        {
            return Result.Failure<ScheduleDayCardsDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var viewer = new ScheduleViewer(repository, callerUserId, [template]);
        if (!await viewer.MaySeeAsync(template, ct))
        {
            return Result.Failure<ScheduleDayCardsDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var isReference = template.TenantScope == TenantScope.Public;
        var checks = isReference ? await repository.GetScheduleChecksAsync([template.Id], ct) : [];
        var latest = ScheduleCheck.Latest(checks);
        var state = ScheduleCheck.StateOf(checks);
        var check = !isReference
            ? new DayCardsCheckDto("Own", false, null, null)
            : new DayCardsCheckDto(state.ToString(), state == ScheduleCheckState.Checked, state == ScheduleCheckState.Checked ? latest?.CheckerDisplayName : null,
                state == ScheduleCheckState.Checked ? latest?.CheckedAtUtc : null);

        var stages = template.OwnStages()
            .Select((s, i) => new CheckStageDto(i, s.Name, ShownDayDto.Of(s.StartDay)!, ShownDayDto.Of(s.EndDay)!, s.StartSign, s.EndSign))
            .ToList();
        var tasks = template.Tasks
            .OrderBy(t => t.StageIndex).ThenBy(t => t.Order).ThenBy(t => t.TaskKey, StringComparer.Ordinal)
            .Select(t =>
            {
                var timing = t.Content.Timing;
                return new DayCardTaskDto(
                    t.TaskKey,
                    t.ContentHash,
                    GetScheduleCheckViewHandler.Element(t.Content.ToCanonicalJson()),
                    new CheckTaskDaysDto(
                        ShownDayDto.Of(timing.FromDay), ShownDayDto.Of(timing.ToDay),
                        ShownDayDto.Of(timing.ExpectedFromDay), ShownDayDto.Of(timing.ExpectedToDay), ShownDayDto.Of(timing.RepeatEndDay)),
                    check.IsChecked);
            })
            .ToList();
        var challenges = template.Challenges
            .OrderBy(c => c.StageIndex).ThenBy(c => c.Order).ThenBy(c => c.ChallengeKey, StringComparer.Ordinal)
            .Select(c => new CheckChallengeDto(c.ChallengeKey, c.ContentHash, GetScheduleCheckViewHandler.Element(c.Content.ToCanonicalJson())))
            .ToList();

        // The maker is named by kind. Only the platform may import a reference: an institution's (or the built-in) one is made by
        // ShramSafal from that body's publications, so its SourceLabel is the SOURCE and is never sent as the maker (founder v7,
        // slice 10). An expert's (or a farmer's) reference names that person, its maker. A person who typed an own copy is never named here.
        var madeBy = new DayCardsMadeByDto(
            template.OwnerType is { } owner ? ScheduleOwnerTypeWire.ToWire(owner) : null,
            isReference && template.OwnerType is ScheduleOwnerType.Expert or ScheduleOwnerType.User ? template.SourceLabel : null);

        return Result.Success(new ScheduleDayCardsDto(
            template.Id, template.ChainId, template.Version, hash, isReference ? "reference" : "own", template.Name, template.CropKey, madeBy, check,
            stages, tasks, challenges));
    }
}
