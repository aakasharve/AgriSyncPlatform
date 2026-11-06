using AgriSync.Bootstrapper.Jobs;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace Analytics.IntegrationTests;

/// <summary>
/// Decision logic of the nightly MIS refresh, no database needed.
/// spec: mis-refresh-unpopulated-matviews-2026-11-01
/// </summary>
public sealed class MisViewRefresherTests
{
    private const string View = "mis.dwc_score_per_farm_week";

    private static PostgresException Pg(string sqlState) =>
        new("boom", "ERROR", "ERROR", sqlState);

    [Fact]
    public void Concurrent_sql_is_used_by_default_and_plain_sql_has_no_keyword()
    {
        MisViewRefresher.BuildRefreshSql(View, concurrently: true)
            .Should().Be("REFRESH MATERIALIZED VIEW CONCURRENTLY mis.dwc_score_per_farm_week;");
        MisViewRefresher.BuildRefreshSql(View, concurrently: false)
            .Should().Be("REFRESH MATERIALIZED VIEW mis.dwc_score_per_farm_week;");
    }

    [Fact]
    public async Task Populated_view_is_refreshed_concurrently_only()
    {
        var sent = new List<string>();

        var result = await MisViewRefresher.RefreshAsync(
            View, (sql, _) => { sent.Add(sql); return Task.CompletedTask; }, CancellationToken.None);

        result.Outcome.Should().Be(MisViewRefreshOutcome.Concurrent);
        result.Error.Should().BeNull();
        sent.Should().ContainSingle().Which.Should().Contain("CONCURRENTLY");
    }

    [Fact]
    public async Task Unpopulated_view_0A000_falls_back_to_one_plain_refresh()
    {
        var sent = new List<string>();

        var result = await MisViewRefresher.RefreshAsync(
            View,
            (sql, _) =>
            {
                sent.Add(sql);
                return sql.Contains("CONCURRENTLY")
                    ? throw Pg("0A000")
                    : Task.CompletedTask;
            },
            CancellationToken.None);

        result.Outcome.Should().Be(MisViewRefreshOutcome.InitiallyPopulated);
        result.Error.Should().BeNull();
        sent.Should().HaveCount(2);
        sent[0].Should().Contain("CONCURRENTLY");
        sent[1].Should().Be("REFRESH MATERIALIZED VIEW mis.dwc_score_per_farm_week;");
    }

    [Theory]
    [InlineData("42P01")] // relation does not exist
    [InlineData("55000")] // object_not_in_prerequisite_state (e.g. no unique index)
    [InlineData("57014")] // query_canceled
    public async Task Other_postgres_errors_get_no_plain_retry(string sqlState)
    {
        var sent = new List<string>();

        var result = await MisViewRefresher.RefreshAsync(
            View, (sql, _) => { sent.Add(sql); throw Pg(sqlState); }, CancellationToken.None);

        result.Outcome.Should().Be(MisViewRefreshOutcome.Failed);
        result.Error.Should().BeOfType<PostgresException>();
        sent.Should().ContainSingle("a blocking plain refresh must not be tried for unrelated errors");
    }

    [Fact]
    public async Task Non_postgres_exception_is_reported_as_failed_without_retry()
    {
        var sent = new List<string>();

        var result = await MisViewRefresher.RefreshAsync(
            View, (sql, _) => { sent.Add(sql); throw new InvalidOperationException("conn closed"); }, CancellationToken.None);

        result.Outcome.Should().Be(MisViewRefreshOutcome.Failed);
        result.Error.Should().BeOfType<InvalidOperationException>();
        sent.Should().ContainSingle();
    }

    [Fact]
    public async Task Failure_of_the_fallback_is_isolated_and_reported()
    {
        var calls = 0;

        var result = await MisViewRefresher.RefreshAsync(
            View,
            (sql, _) =>
            {
                calls++;
                throw sql.Contains("CONCURRENTLY") ? Pg("0A000") : Pg("42501"); // permission denied
            },
            CancellationToken.None);

        result.Outcome.Should().Be(MisViewRefreshOutcome.Failed);
        result.Error.Should().BeOfType<PostgresException>().Which.SqlState.Should().Be("42501");
        calls.Should().Be(2);
    }

    [Fact]
    public void Only_feature_not_supported_counts_as_unpopulated()
    {
        MisViewRefresher.IsUnpopulatedViewError(Pg("0A000")).Should().BeTrue();
        MisViewRefresher.IsUnpopulatedViewError(Pg("42P01")).Should().BeFalse();
        MisViewRefresher.IsUnpopulatedViewError(new InvalidOperationException()).Should().BeFalse();
    }
}
