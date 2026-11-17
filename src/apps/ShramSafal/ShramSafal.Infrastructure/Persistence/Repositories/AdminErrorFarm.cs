using System.Data.Common;
using ShramSafal.Application.UseCases.Admin.Shared;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Tasks 1 and 2, amendments C1, C2, C6).
/// The one rule that ties a row of <c>analytics.events</c> to a farm, and the one rule for what counts as a
/// problem. Every read that counts problems per farm uses <see cref="ProblemSql"/> and <see cref="FarmSql"/>
/// together, so one farm shows the same count on All Farms, Suffering, Live Health and its own page.
///
/// <para>
/// <b>The farm (C2).</b> The <c>farm_id</c> column when the row has one; otherwise the farm the request NAMED in
/// its address (<c>props.routeFarmId</c>), read only on rows the server itself writes (<c>api.error</c>,
/// <c>api.slow</c>, <c>api.refused</c>) and only when it is a uuid. <c>POST /telemetry/client-error</c> is
/// anonymous and stores the caller's raw body, so a phone report's <c>routeFarmId</c> is never read: it can
/// neither name a farm nor break the query. A sync upload names no farm in its address, so its farm is null
/// ("not named in the request"), never a guess.
/// </para>
///
/// <para>
/// The SQL fragments name the columns unqualified, so they work in any single-table read of
/// <c>analytics.events</c>.
/// </para>
/// </summary>
internal static class AdminErrorFarm
{
    /// <summary>The rows the request middleware writes; only these carry a trustworthy <c>routeFarmId</c>.</summary>
    private const string ServerWrittenTypes = "event_type IN ('api.error','api.slow','api.refused')";

    private const string RouteFarmIsUuid =
        "props->>'routeFarmId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

    /// <summary>The farm a row belongs to (uuid), or NULL when no farm was named.</summary>
    public const string FarmSql =
        "COALESCE(farm_id, CASE WHEN " + ServerWrittenTypes + " AND " + RouteFarmIsUuid
        + " THEN (props->>'routeFarmId')::uuid END)";

    /// <summary>
    /// Where <see cref="FarmSql"/> found the farm: <c>'event'</c> (the row's own farm), <c>'address'</c> (the farm
    /// the request named), or NULL (no farm named).
    /// </summary>
    public const string SourceSql =
        "CASE WHEN farm_id IS NOT NULL THEN 'event' WHEN " + ServerWrittenTypes + " AND " + RouteFarmIsUuid
        + " THEN 'address' END";

    /// <summary>
    /// C1: what counts as a problem. A failed request, a problem the phone reported, or a failed voice call.
    /// </summary>
    public const string ProblemSql =
        "(event_type IN ('api.error','client.error') OR (event_type = 'ai.invocation' AND props->>'outcome' = 'failure'))";

    /// <summary>All Farms' "Errors 24h" and Live Health's repeated problems.</summary>
    public static readonly TimeSpan LastDay = TimeSpan.FromHours(24);

    /// <summary>The Suffering page.</summary>
    public static readonly TimeSpan LastWeek = TimeSpan.FromDays(7);

    /// <summary>
    /// Farms with at least <paramref name="minProblems"/> problems in the <paramref name="window"/> before now,
    /// each problem counted once in one <see cref="ProblemArea"/>. Ordered by count, then the latest problem, at
    /// most <paramref name="maxFarms"/>. Rows with no farm are not counted. Nothing is caught: a failed read
    /// escapes, never an empty list.
    /// </summary>
    public static async Task<IReadOnlyList<RepeatedProblemFarm>> ReadRepeatedProblemsAsync(
        DbConnection conn, TimeSpan window, int minProblems, int maxFarms, CancellationToken ct)
    {
        using var cmd = conn.CreateCommand();
        // One row per farm, kind of row, route and outcome; the area of each is decided by ProblemArea.For, so
        // every problem lands in exactly one area. A client.error is always 'other': its route text, if the
        // phone sent one, is the phone's own and is not read.
        cmd.CommandText = $"""
            WITH p AS (
                SELECT
                    {FarmSql} AS farm,
                    event_type,
                    CASE WHEN event_type = 'client.error' THEN NULL ELSE props->>'route' END AS route,
                    props->>'outcome' AS outcome,
                    occurred_at_utc
                FROM analytics.events
                WHERE {ProblemSql}
                  AND occurred_at_utc >= NOW() - @window
            )
            SELECT farm, event_type, route, outcome, COUNT(*), MAX(occurred_at_utc)
            FROM p
            WHERE farm IN (
                SELECT farm FROM p
                WHERE farm IS NOT NULL
                GROUP BY farm
                HAVING COUNT(*) >= @min)
            GROUP BY farm, event_type, route, outcome
            """;
        AddParam(cmd, "@window", window);
        AddParam(cmd, "@min", minProblems);

        var tallies = new Dictionary<Guid, Tally>();
        using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var farmId = r.GetGuid(0);
                var area = ProblemArea.For(
                    eventType: r.GetString(1),
                    routePattern: r.IsDBNull(2) ? null : r.GetString(2),
                    outcome: r.IsDBNull(3) ? null : r.GetString(3));
                var count = checked((int)r.GetInt64(4));
                var last = r.GetDateTime(5);

                if (!tallies.TryGetValue(farmId, out var tally))
                {
                    tally = new Tally();
                    tallies[farmId] = tally;
                }

                tally.Add(area, count, last);
            }
        }

        return tallies
            .Where(t => t.Value.Total >= minProblems)
            .OrderByDescending(t => t.Value.Total)
            .ThenByDescending(t => t.Value.Last)
            .ThenBy(t => t.Key)
            .Take(maxFarms)
            .Select(t => new RepeatedProblemFarm(
                t.Key, t.Value.Total, t.Value.Sync, t.Value.Entries, t.Value.Voice, t.Value.Other, t.Value.Last))
            .ToList();
    }

    private static void AddParam(DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }

    private sealed class Tally
    {
        public int Total { get; private set; }
        public int Sync { get; private set; }
        public int Entries { get; private set; }
        public int Voice { get; private set; }
        public int Other { get; private set; }
        public DateTime Last { get; private set; } = DateTime.MinValue;

        public void Add(string area, int count, DateTime last)
        {
            Total += count;
            switch (area)
            {
                case ProblemArea.Sync: Sync += count; break;
                case ProblemArea.Entries: Entries += count; break;
                case ProblemArea.Voice: Voice += count; break;
                default: Other += count; break;
            }

            if (last > Last) Last = last;
        }
    }
}

/// <summary>One farm's repeated problems: the total, the same total split into the four areas, and the latest.</summary>
internal sealed record RepeatedProblemFarm(
    Guid FarmId, int ProblemCount, int Sync, int Entries, int Voice, int Other, DateTime LastProblemAt);
