using System;
using System.Collections.Generic;

namespace AgriSync.BuildingBlocks.Analytics;

/// <summary>
/// A single monthly range partition of <c>analytics.events</c>.
/// Bounds are half-open <c>[FromInclusive, ToExclusive)</c> to match the
/// Postgres <c>FOR VALUES FROM (..) TO (..)</c> semantics used by the
/// initial-partition DDL in
/// <c>Migrations/Analytics/20260419054331_AnalyticsInitial.cs</c>.
/// </summary>
public readonly record struct AnalyticsPartitionSpec(
    string TableName,
    DateOnly FromInclusive,
    DateOnly ToExclusive)
{
    /// <summary>The owning schema for every analytics partition.</summary>
    public const string SchemaName = "analytics";

    /// <summary>Schema-qualified identifier, e.g. <c>analytics.events_p_2026_06</c>.</summary>
    public string QualifiedName => $"{SchemaName}.{TableName}";
}

/// <summary>
/// Pure (no-IO) planner for the monthly range partitions of
/// <c>analytics.events</c>.
///
/// <para>
/// The initial migration only ever created the current + next month's
/// partition and explicitly deferred ongoing provisioning to "a separate
/// hosted job" (see the migration remarks). That job was never built, so on
/// the first calendar day past the last pre-created partition EVERY analytics
/// insert raises a <c>check_violation</c> (SQLSTATE 23514) — and
/// <see cref="AnalyticsWriter"/> swallows it by design ("telemetry write is
/// non-blocking"). The net effect is a silent, total loss of analytics with no
/// alarm: every matview/dashboard/KPI quietly empties.
/// </para>
///
/// <para>
/// <see cref="PartitionMaintenanceJob"/> uses this planner to keep partitions
/// provisioned a fixed horizon ahead. This type holds only the date math so it
/// is trivially unit-testable without a database.
/// </para>
///
/// Naming and bounds intentionally mirror the migration's DO-block
/// (<c>to_char(start, '"events_p_"YYYY_MM')</c>, monthly ranges) so the job's
/// idempotent <c>CREATE TABLE IF NOT EXISTS</c> never collides with the
/// migration-created partitions.
/// </summary>
public static class AnalyticsPartitionPlan
{
    /// <summary>
    /// The specs that must exist to cover the anchor's month through
    /// <paramref name="monthsAhead"/> additional months — i.e.
    /// <c>monthsAhead + 1</c> contiguous monthly partitions, current month first.
    /// </summary>
    /// <param name="anchorUtc">Any date in the "current" month (caller passes UTC today).</param>
    /// <param name="monthsAhead">How many months beyond the current month to provision. Must be &gt;= 0.</param>
    public static IReadOnlyList<AnalyticsPartitionSpec> ForHorizon(DateOnly anchorUtc, int monthsAhead)
    {
        if (monthsAhead < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(monthsAhead), monthsAhead, "Partition horizon cannot be negative.");
        }

        var monthStart = new DateOnly(anchorUtc.Year, anchorUtc.Month, 1);
        var specs = new List<AnalyticsPartitionSpec>(monthsAhead + 1);

        for (var i = 0; i <= monthsAhead; i++)
        {
            var from = monthStart.AddMonths(i);
            var to = monthStart.AddMonths(i + 1);
            var name = $"events_p_{from.Year:D4}_{from.Month:D2}";
            specs.Add(new AnalyticsPartitionSpec(name, from, to));
        }

        return specs;
    }
}
