using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CheckSchedule;

/// <summary>
/// A reference schedule in FORMAT 2 exactly as it travels: the body of <c>POST /shramsafal/schedule-templates/import/format-2</c>, and the body of a creator's draft
/// (slice 15), which is the same shape on purpose.
/// </summary>
public sealed record ReferenceScheduleBody(
    int? Format,
    string? Name,
    string? CropKey,
    string? OwnerType,
    string? SourceLabel,
    Guid? PreviousVersionId,
    IReadOnlyList<ImportReferenceStageInput>? Stages,
    IReadOnlyList<JsonElement>? Tasks,
    IReadOnlyList<JsonElement>? Challenges);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) and slice 15 (the creator door) - the ONE importer of a reference schedule in format 2. It reads the body
/// strictly, refuses with words, and builds the library row in memory (<see cref="ScheduleTemplate.ImportReference"/>); it saves nothing and decides nothing about who may
/// call. The staff import route saves what it builds at once; a creator's submission is built by it when he sends, when staff look, and when staff approve, and is saved
/// only then.
/// </summary>
public static class ReferenceScheduleImporter
{
    public const int ReferenceFormat = 2;

    public static async Task<Result<ScheduleTemplate>> BuildAsync(
        IShramSafalRepository repository,
        ReferenceScheduleBody body,
        UserId maker,
        Guid templateId,
        DateTime nowUtc,
        CancellationToken ct = default)
    {
        if (body.Format != ReferenceFormat)
        {
            return Fail("ScheduleImportFormat", $"This door reads format {ReferenceFormat} only (the task format); the old import keeps the old shape.");
        }

        if (!ScheduleOwnerTypeWire.TryParse(body.OwnerType, out var ownerType))
        {
            return Fail("ScheduleImportOwnerType", "The owner type must be one of INSTITUTION, EXPERT, USER, SYSTEM_DEFAULT.");
        }

        if (!string.IsNullOrWhiteSpace(body.CropKey) && Services.ScheduleLibrary.CropTypeNameFor(body.CropKey) is null)
        {
            return Fail("ScheduleImportCrop", $"The crop key \"{body.CropKey.Trim()}\" matches no crop ShramSafal knows.");
        }

        var tasks = new List<ScheduleTaskContent>(body.Tasks?.Count ?? 0);
        foreach (var (raw, index) in (body.Tasks ?? []).Select((t, i) => (t, i)))
        {
            if (!ScheduleTaskContent.TryParseWire(raw.GetRawText(), out var task, out var problem))
            {
                return Fail(problem!.Code, $"Task {index + 1}: {problem.Message}");
            }

            tasks.Add(task!);
        }

        var challenges = new List<ScheduleChallengeContent>(body.Challenges?.Count ?? 0);
        foreach (var (raw, index) in (body.Challenges ?? []).Select((c, i) => (c, i)))
        {
            if (!ScheduleChallengeContent.TryParseWire(raw.GetRawText(), out var challenge, out var problem))
            {
                return Fail(problem!.Code, $"Challenge {index + 1}: {problem.Message}");
            }

            challenges.Add(challenge!);
        }

        ScheduleTemplate? previous = null;
        if (body.PreviousVersionId is { } previousId)
        {
            previous = await repository.GetScheduleTemplateWithTasksByIdAsync(previousId, ct);
            if (previous is null || previous.TenantScope != TenantScope.Public)
            {
                return Result.Failure<ScheduleTemplate>(ShramSafalErrors.ScheduleTemplateNotFound);
            }
        }

        var stages = (body.Stages ?? [])
            .Select(s => new OwnScheduleStage(s.Name ?? string.Empty, s.StartDay, s.EndDay, s.StartSign, s.EndSign))
            .ToList();
        var input = new ReferenceScheduleImport(body.Name ?? string.Empty, ownerType, body.SourceLabel, body.CropKey, stages, tasks, challenges);

        var template = ScheduleTemplate.ImportReference(templateId, previous, input, maker, nowUtc, out var importProblem);
        return template is null
            ? Fail(importProblem!.Code, importProblem.Message)
            : Result.Success(template);
    }

    private static Result<ScheduleTemplate> Fail(string code, string message) =>
        Result.Failure<ScheduleTemplate>(Error.Validation($"ShramSafal.{code}", message));
}
