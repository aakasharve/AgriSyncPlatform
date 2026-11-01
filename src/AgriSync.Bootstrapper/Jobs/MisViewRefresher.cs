using System;
using System.Threading;
using System.Threading.Tasks;
using Npgsql;

namespace AgriSync.Bootstrapper.Jobs
{
    /// <summary>How one materialized view's refresh ended.</summary>
    public enum MisViewRefreshOutcome
    {
        /// <summary>Normal path: <c>REFRESH ... CONCURRENTLY</c> succeeded.</summary>
        Concurrent,

        /// <summary>
        /// The view had never been populated (created <c>WITH NO DATA</c>), so
        /// CONCURRENTLY was refused; a one-time plain refresh populated it.
        /// </summary>
        InitiallyPopulated,

        /// <summary>The refresh failed; <see cref="MisViewRefreshResult.Error"/> says why.</summary>
        Failed,
    }

    public readonly record struct MisViewRefreshResult(MisViewRefreshOutcome Outcome, Exception? Error);

    /// <summary>
    /// Refresh strategy for one <c>mis.*</c> materialized view, kept separate from
    /// <see cref="MisRefreshJob"/> so the decision is unit-testable without Postgres.
    ///
    /// Why it exists: several views (DWC v2, admin_scope_health) are created
    /// <c>WITH NO DATA</c>. Postgres refuses <c>REFRESH MATERIALIZED VIEW CONCURRENTLY</c>
    /// on a view that has never been populated (SQLSTATE 0A000), so the nightly job
    /// logged an error for them on every run and they stayed empty forever. The first
    /// refresh of such a view must be a plain one; every refresh after that can be
    /// concurrent again (and a plain refresh is only ever tried for 0A000, so no other
    /// failure gets a blocking-lock retry).
    ///
    /// spec: mis-refresh-unpopulated-matviews-2026-11-01
    /// </summary>
    public static class MisViewRefresher
    {
        /// <summary>Postgres SQLSTATE <c>feature_not_supported</c>.</summary>
        public const string FeatureNotSupportedSqlState = "0A000";

        public static bool IsUnpopulatedViewError(Exception ex) =>
            ex is PostgresException { SqlState: FeatureNotSupportedSqlState };

        /// <summary>
        /// <paramref name="viewName"/> must come from the fixed view list in
        /// <see cref="MisRefreshJob"/>, never from user input: it is placed into SQL as-is.
        /// </summary>
        public static string BuildRefreshSql(string viewName, bool concurrently) =>
            concurrently
                ? $"REFRESH MATERIALIZED VIEW CONCURRENTLY {viewName};"
                : $"REFRESH MATERIALIZED VIEW {viewName};";

        public static async Task<MisViewRefreshResult> RefreshAsync(
            string viewName,
            Func<string, CancellationToken, Task> executeSql,
            CancellationToken ct)
        {
            try
            {
                await executeSql(BuildRefreshSql(viewName, concurrently: true), ct);
                return new MisViewRefreshResult(MisViewRefreshOutcome.Concurrent, null);
            }
            catch (Exception ex) when (IsUnpopulatedViewError(ex))
            {
                // First population only. Isolated like every other failure so one bad
                // view never blocks the rest of the nightly run.
                try
                {
                    await executeSql(BuildRefreshSql(viewName, concurrently: false), ct);
                    return new MisViewRefreshResult(MisViewRefreshOutcome.InitiallyPopulated, null);
                }
                catch (Exception fallbackEx)
                {
                    return new MisViewRefreshResult(MisViewRefreshOutcome.Failed, fallbackEx);
                }
            }
            catch (Exception ex)
            {
                return new MisViewRefreshResult(MisViewRefreshOutcome.Failed, ex);
            }
        }
    }
}
