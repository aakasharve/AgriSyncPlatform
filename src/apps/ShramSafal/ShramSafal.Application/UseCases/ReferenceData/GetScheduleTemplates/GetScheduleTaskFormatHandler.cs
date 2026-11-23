using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

/// <summary>
/// spec: plr-d10 schedule slice 7 - one listed schedule in the TASK FORMAT, for a phone that declared it reads it (<c>scheduleFormat=2</c>): the version, its
/// chain, its content hash, its check state, the stage line with its signs, and every task and challenge as canonical task JSON (every field).
/// </summary>
public sealed record ScheduleTaskFormatDto(
    Guid TemplateId,
    Guid? ChainId,
    int Version,
    string ContentHash,
    string CheckState,
    IReadOnlyList<StageDefinitionDto> Stages,
    IReadOnlyList<JsonElement> Tasks,
    IReadOnlyList<JsonElement> Challenges);

/// <summary>
/// spec: plr-d10 schedule slice 7 - <c>GET /shramsafal/reference/schedule-templates/{id}/tasks?scheduleFormat=2</c>, a NEW route (the listing an old phone reads
/// keeps its shape: the format is offered only to a phone that declares <c>scheduleFormat=2</c>). The schedule must be in THIS caller's library (the one
/// visibility and check rule, <see cref="Services.ScheduleLibrary.ListingForAsync"/>): a farm caller reads a reference only once it is checked; a schedule he may not
/// see, or one not in the task format, is answered as unknown (E4).
/// </summary>
public sealed class GetScheduleTaskFormatHandler(IShramSafalRepository repository, IEntitlementResolver? entitlements = null)
{
    public const int Format = 2;

    public async Task<Result<ScheduleTaskFormatDto>> HandleAsync(Guid callerUserId, Guid templateId, int? scheduleFormat, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty || templateId == Guid.Empty)
        {
            return Result.Failure<ScheduleTaskFormatDto>(ShramSafalErrors.InvalidCommand);
        }

        if (scheduleFormat is not >= Format)
        {
            return Result.Failure<ScheduleTaskFormatDto>(Error.Validation(
                "ShramSafal.ScheduleFormatNotDeclared", $"This route serves the task format to a phone that declares scheduleFormat={Format}."));
        }

        var listing = await Services.ScheduleLibrary.ListingForAsync(repository, await repository.GetScheduleTemplatesAsync(ct), callerUserId, ct, entitlements);
        var listed = listing.FirstOrDefault(t => t.Id == templateId);
        if (listed is null)
        {
            return Result.Failure<ScheduleTaskFormatDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var template = await repository.GetScheduleTemplateWithTasksByIdAsync(templateId, ct);
        if (template is null || !template.IsInTaskFormat || template.TaskFormatHash() is not { } hash)
        {
            return Result.Failure<ScheduleTaskFormatDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var stages = template.OwnStages().Select(s => new StageDefinitionDto(s.Name, s.StartDay, s.EndDay, s.StartSign, s.EndSign)).ToList();
        var tasks = template.Tasks
            .OrderBy(t => t.StageIndex).ThenBy(t => t.Order).ThenBy(t => t.TaskKey, StringComparer.Ordinal)
            .Select(t => GetScheduleCheckViewHandler.Element(t.Content.ToCanonicalJson()))
            .ToList();
        var challenges = template.Challenges
            .OrderBy(c => c.StageIndex).ThenBy(c => c.Order).ThenBy(c => c.ChallengeKey, StringComparer.Ordinal)
            .Select(c => GetScheduleCheckViewHandler.Element(c.Content.ToCanonicalJson()))
            .ToList();

        return Result.Success(new ScheduleTaskFormatDto(
            template.Id, template.ChainId, template.Version, hash, listed.Check?.State ?? "NotChecked", stages, tasks, challenges));
    }
}
