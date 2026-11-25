namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, "Library, profile and honest numbers")

/// <summary>One aggregate row of <c>ssf.schedule_chain_totals</c>: a metric name, a task key (only for <c>work</c>), the distinct farmers behind it (always five or more) and the number itself.</summary>
public sealed record ScheduleTotalsRow(string Metric, string? TaskKey, int Farmers, int Amount);

/// <summary>One version of a schedule's chain: its id and its version number.</summary>
public sealed record ScheduleChainVersion(Guid Id, int Version);

/// <summary>
/// The ONE cross-farm read of the schedule totals. It calls the database function <c>ssf.schedule_chain_totals</c> (SECURITY DEFINER, aggregates only; the five-farmer threshold, the test-farm list
/// and the Public-schedule rule are applied inside it), never a farm's rows. Nothing else in the application reads across farms for a total.
/// </summary>
public interface IScheduleTotalsStore
{
    /// <summary>The aggregates for one chain. A number under five farmers is not a row. <paramref name="taskKeys"/> are the works of the latest checked version (the per-work lines and the works count are limited to them).</summary>
    Task<IReadOnlyList<ScheduleTotalsRow>> GetTotalsAsync(Guid chainKey, IReadOnlyCollection<string> taskKeys, CancellationToken ct = default);

    /// <summary>Every version of the chain (a row with no chain names itself as its chain): library rows, which have no row policy.</summary>
    Task<IReadOnlyList<ScheduleChainVersion>> GetChainVersionsAsync(Guid chainKey, CancellationToken ct = default);
}
