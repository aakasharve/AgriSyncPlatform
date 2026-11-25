using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Schedules.GetScheduleTotals;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, "Library, profile and honest numbers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>One work of the schedule that at least five farmers hold: its key, its name in the latest checked version and how many farmers hold it. A work under five is not in the list.</summary>
public sealed record ScheduleTotalsWorkDto(string TaskKey, string Name, int Farmers);

/// <summary>
/// What a reader may be told about who follows a schedule: counts, task keys and work names. Never a farm, a plot, a person, a phone or a date of a farm.
/// <list type="bullet">
/// <item><c>Kind</c>: <c>totals</c> (a Public reference schedule), <c>sample</c> (a built-in or a row that stores no days: NO number of any kind) or <c>own</c> (a person's or team's own schedule: no totals).</item>
/// <item>A number is <c>null</c> when fewer than five distinct farmers stand behind it, or when no row backs it: 0 to 4 all read the same, and a 0 never stands in for "unknown".</item>
/// <item><c>Following</c> (the headline): farmers who took at least one of its works into their own schedule and still hold it. <c>Having</c>: farmers whose plot has an Active choice of any version of it.
/// <c>WorksTaken</c> of <c>WorksInSchedule</c>: of the works of the latest CHECKED version, how many have a taker (<c>WorksTakenPercent</c> only when both are known). <c>DoneJobs</c>: jobs made from one of its
/// works that were closed as done - counted APART from following. <c>Heard</c>: farmers who heard at least one message of its owner - counted apart too.</item>
/// </list>
/// </summary>
public sealed record ScheduleTotalsDto(
    Guid ScheduleId,
    Guid? ChainId,
    string Kind,
    int MinimumFarmers,
    int? Following,
    int? Having,
    int? WorksTaken,
    int? WorksInSchedule,
    int? WorksTakenPercent,
    IReadOnlyList<ScheduleTotalsWorkDto> Works,
    int? DoneJobs,
    int? Heard,
    Guid? CheckedVersionId);

/// <summary>
/// <c>GET /shramsafal/schedule-templates/{id}/totals</c> - for any signed-in person, for a schedule in the library they can see. The numbers come from ONE database function
/// (<see cref="IScheduleTotalsStore"/>) that returns aggregates only; this handler adds no farm's data and never lowers the threshold.
/// <para>A schedule this caller may not see, and an id nobody knows, are answered alike (E4). A sample has no totals, and neither has a schedule that is not Public.</para>
/// </summary>
public sealed class GetScheduleTotalsHandler(IShramSafalRepository repository, IScheduleTotalsStore store)
{
    public const int MinimumFarmers = 5;

    public async Task<Result<ScheduleTotalsDto>> HandleAsync(Guid callerUserId, Guid scheduleId, CancellationToken ct = default)
    {
        if (callerUserId == Guid.Empty || scheduleId == Guid.Empty)
        {
            return Result.Failure<ScheduleTotalsDto>(ShramSafalErrors.InvalidCommand);
        }

        var row = await repository.GetScheduleTemplateWithTasksByIdAsync(scheduleId, ct);
        if (row is null)
        {
            // The app's built-in samples have no row: a sample, with no number. Any other id is unknown.
            return ReferenceDataCatalog.ScheduleTemplates.Any(t => t.Id == scheduleId)
                ? Result.Success(Empty(scheduleId, null, "sample"))
                : Result.Failure<ScheduleTotalsDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var viewer = new ScheduleViewer(repository, callerUserId, [row]);
        if (!await viewer.MaySeeAsync(row, ct))
        {
            return Result.Failure<ScheduleTotalsDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        var chainKey = row.ChainId ?? row.Id;
        if (row.TenantScope != TenantScope.Public)
        {
            return Result.Success(Empty(scheduleId, chainKey, "own"));
        }

        if (!row.HasStoredDays && !row.IsInTaskFormat)
        {
            return Result.Success(Empty(scheduleId, chainKey, "sample"));
        }

        // The latest CHECKED version of the chain: the highest version whose latest decision is Approved (a check names one row, never the chain).
        var versions = await store.GetChainVersionsAsync(chainKey, ct);
        var checks = versions.Count == 0 ? [] : await repository.GetScheduleChecksAsync(versions.Select(v => v.Id).ToList(), ct);
        var checkedVersion = versions
            .OrderByDescending(v => v.Version)
            .FirstOrDefault(v => ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == v.Id)) == ScheduleCheckState.Checked);

        ScheduleTemplate? checkedRow = null;
        if (checkedVersion is not null)
        {
            checkedRow = checkedVersion.Id == row.Id ? row : await repository.GetScheduleTemplateWithTasksByIdAsync(checkedVersion.Id, ct);
        }

        var tasks = checkedRow is { IsInTaskFormat: true } ? checkedRow.Tasks.ToList() : [];
        var names = tasks.ToDictionary(t => t.TaskKey, t => t.Name, StringComparer.Ordinal);

        var rows = await store.GetTotalsAsync(chainKey, names.Keys.ToList(), ct);

        // A row exists only for five or more farmers (the function), and this repeats the rule so a changed function can never widen it.
        rows = rows.Where(r => r.Farmers >= MinimumFarmers).ToList();
        int? Amount(string metric) => rows.FirstOrDefault(r => r.Metric == metric) is { } m ? m.Amount : null;

        var following = Amount("following");
        var having = Amount("having");
        var worksTaken = Amount("works_taken");
        int? worksInSchedule = names.Count > 0 ? names.Count : null;
        int? percent = worksTaken is { } taken && worksInSchedule is { } total && total > 0
            ? (int)Math.Round(100.0 * taken / total, MidpointRounding.AwayFromZero)
            : null;

        var order = tasks.ToDictionary(t => t.TaskKey, t => (t.StageIndex, t.Order), StringComparer.Ordinal);
        var works = rows
            .Where(r => r.Metric == "work" && r.TaskKey is not null && names.ContainsKey(r.TaskKey))
            .OrderBy(r => order[r.TaskKey!].StageIndex).ThenBy(r => order[r.TaskKey!].Order).ThenBy(r => r.TaskKey, StringComparer.Ordinal)
            .Select(r => new ScheduleTotalsWorkDto(r.TaskKey!, names[r.TaskKey!], r.Farmers))
            .ToList();

        return Result.Success(new ScheduleTotalsDto(
            scheduleId, chainKey, "totals", MinimumFarmers,
            following, having, worksTaken, worksInSchedule, percent, works, Amount("done"), Amount("heard"), checkedVersion?.Id));
    }

    private static ScheduleTotalsDto Empty(Guid scheduleId, Guid? chainId, string kind) =>
        new(scheduleId, chainId, kind, MinimumFarmers, null, null, null, null, null, [], null, null, null);
}
