using AgriSync.BuildingBlocks.Analytics;   // AnalyticsDbContext lives here — omitting this is CS0246
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// First coverage for AdminOpsRepository. Both error-listing methods project
/// out of analytics.events' JSON props, and both swallowed every exception, so
/// until now a wrong projection would have shown an empty admin console and
/// nothing anywhere would have said why.
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class AdminOpsErrorProjectionTests(AdminTestFixture fixture)
{
    private async Task SeedApiErrorAsync(string propsJson, Guid? farmId = null)
    {
        await using var scope = fixture.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>();
        var conn = (NpgsqlConnection)ctx.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_role, trigger,
                 schema_version, farm_id, props)
            VALUES
                (@id, 'api.error', NOW(), 'system', 'middleware',
                 'v1', @farm, @props::jsonb)
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", (object?)farmId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("props", propsJson);
        await cmd.ExecuteNonQueryAsync();
    }

    private static AdminOpsRepository Repository(IServiceScope scope)
        => new(scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>(),
               scope.ServiceProvider.GetRequiredService<ILogger<AdminOpsRepository>>());

    [Fact]
    public async Task Ops_errors_carry_the_error_code_and_its_explanation()
    {
        await SeedApiErrorAsync("""
            {"endpoint":"POST /shramsafal/logs","statusCode":409,"latencyMs":42,
             "errorCode":"ShramSafal.CropCycleOverlap","workKept":"unknown",
             "message":"Two crop cycles claim the same plot over the same dates.",
             "appVersion":"1.0.9"}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var page = await Repository(scope).GetErrorsPagedAsync(
            page: 1, pageSize: 20, endpoint: null, since: null, ct: CancellationToken.None);

        var row = page.Items.Single(r => r.ErrorCode == "ShramSafal.CropCycleOverlap");

        row.StatusCode.Should().Be(409,
            "props->>'statusCode' is the key three live queries read; a rename would null this silently");
        row.WorkKept.Should().BeOneOf("kept", "lost", "unknown");
        row.AppVersion.Should().Be("1.0.9");
        row.Meaning.Should().NotBeNullOrWhiteSpace(
            "the console must never show a bare code that the reader has to look up elsewhere");
        row.UsualCause.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task A_row_written_before_this_deploy_reads_back_without_inventing_anything()
    {
        // The old props shape. errorCode is absent, so it must come back null —
        // not "Uncatalogued", not "", not a guess. analytics.events is
        // append-only; there is no backfill and there must be no fabrication.
        await SeedApiErrorAsync("""
            {"endpoint":"GET /shramsafal/legacy-probe","statusCode":500,"latencyMs":11,
             "traceId":"legacy"}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var page = await Repository(scope).GetErrorsPagedAsync(
            1, 20, "legacy-probe", null, CancellationToken.None);

        var row = page.Items.Single();
        row.ErrorCode.Should().BeNull();
        row.WorkKept.Should().BeNull();
        row.Meaning.Should().BeNull();
        row.StatusCode.Should().Be(500);
    }

    [Fact]
    public async Task The_health_snapshot_projects_the_same_fields_as_the_paged_list()
    {
        // Two separate SQL projections build the same record. Drifting apart is
        // exactly the kind of thing nobody notices until an admin reads two
        // screens and gets two answers.
        await SeedApiErrorAsync("""
            {"endpoint":"POST /shramsafal/sync/push","statusCode":200,"latencyMs":900,
             "errorCode":"ShramSafal.LabourAssignment.Conflict","workKept":"lost",
             "message":"This labour entry is already recorded on another daily log.",
             "appVersion":"1.0.9","rejectedWorkItems":3}
            """);

        await using var scope = fixture.Services.CreateAsyncScope();
        var health = await Repository(scope).GetOpsHealthAsync(CancellationToken.None);

        var row = health.RecentErrors.Single(r => r.ErrorCode == "ShramSafal.LabourAssignment.Conflict");
        row.WorkKept.Should().Be("lost");
        row.Meaning.Should().NotBeNullOrWhiteSpace();
        row.AppVersion.Should().Be("1.0.9");
    }
}
