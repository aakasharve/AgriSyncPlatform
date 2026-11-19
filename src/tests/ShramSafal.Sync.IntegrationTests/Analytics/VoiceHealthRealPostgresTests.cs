// spec: company-mis-real-numbers-2026-11-15 (plan CR-2d, amendments D15 and D20 (1))
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2d D15, D20 (1)). Written by the test-writer from the plan.
///
/// <para>
/// D15: on the practice stack Live Health (<c>/shramsafal/admin/ops/health</c>) answered 500 on every call once
/// the database held a voice row: <c>AdminOpsRepository.GetVoiceHealthAsync</c> read a column the query returns as
/// <c>double precision</c> with <c>GetDecimal</c>. The old swallowing catch had hidden it as zeros, D4 removed the
/// catch, and no real-database test seeded an <c>ai.invocation</c> row for that query, so none saw it. This class is
/// that test: real <c>ai.invocation</c> rows from the last 24 hours (with the two props the query reads, <c>outcome</c>
/// and <c>latencyMs</c>, beside the vocabulary's required <c>farmId</c>), read through the REAL repository as
/// <c>agrisync_app</c> (doctrine E3 first), and every voice figure checked against the numbers the rows make.
/// </para>
///
/// <para>
/// The arithmetic, by hand. In the window: four calls, latencies 1000, 2000, 3000 and 4000 ms, the last one failed.
/// Count 4; failures 1; failure rate ROUND(1 * 100.0 / 4, 1) = 25.0; average ROUND(2500) = 2500; p95 by
/// PERCENTILE_CONT(0.95) = 3000 + 0.85 * (4000 - 3000) = 3850 (position 0.95 * 3 = 2.85, linear between the third
/// and fourth). Outside it, and never counted: a failed call 25 hours ago with a huge latency, and an
/// <c>api.error</c> row. Every row sits at least an hour from the 24-hour edge. Made-up GUIDs, names and numbers.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class VoiceHealthRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private static readonly Guid Owner = G("d1501");
    private static readonly Guid Account = G("d15a1");
    private static readonly Guid Farm = G("d15f1");

    protected override string ScratchPrefix => "ssf_cr2d_voice";

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await EnsurePreviousMonthPartitionAsync(db);
        await SeedFarmAsync(db, Farm, "Fake Voice Farm", Owner, Account, DateTime.UtcNow.AddDays(-30));
        await SeedMembershipAsync(db, Farm, Owner, Account, "PrimaryOwner");
        await SeedUserAsync(db, Owner, "9000001501", "Fake Voice Owner", DateTime.UtcNow.AddDays(-30), DateTime.UtcNow.AddDays(-30));
    }

    [SkippableFact]
    public async Task Live_health_reads_the_voice_numbers_of_real_ai_invocation_rows()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await InvocationAsync(db, Now.AddMinutes(-10), "success", 1000);
            await InvocationAsync(db, Now.AddMinutes(-70), "success", 2000);
            await InvocationAsync(db, Now.AddHours(-5), "success", 3000);
            await InvocationAsync(db, Now.AddHours(-23), "failure", 4000);
            // Outside the 24-hour window: never counted.
            await InvocationAsync(db, Now.AddHours(-25), "failure", 999_000);
            // Not a voice call: never counted.
            await EventAsync(db, ApiError, Now.AddMinutes(-15), farmId: Farm,
                props: Props(("endpoint", "/fake/endpoint"), ("statusCode", 500)));
        }

        // The same read /shramsafal/admin/ops/health makes (GetOpsHealthHandler -> IAdminOpsRepository), on the
        // production connection shape as agrisync_app. Before 65b09649 this threw InvalidCastException.
        AdminOpsHealthDto health;
        await using (var scope = AdminScope(BuildProvider()))
        {
            health = await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync();
        }

        Output.WriteLine(
            $"[EVIDENCE] invocations={health.VoiceInvocations24h} failures={health.VoiceFailures24h} " +
            $"failureRate={health.VoiceFailureRatePct} avg={health.VoiceAvgLatencyMs} p95={health.VoiceP95LatencyMs}");

        health.VoiceInvocations24h.Should().Be(4, "four ai.invocation rows lie inside the last 24 hours");
        health.VoiceFailures24h.Should().Be(1, "one of the four failed; the failure 25 hours ago is outside the window");
        health.VoiceFailureRatePct.Should().Be(25.0m, "1 of 4 is 25.0 percent, rounded to one place");
        health.VoiceAvgLatencyMs.Should().Be(2500m, "the mean of 1000, 2000, 3000 and 4000 ms");
        health.VoiceP95LatencyMs.Should().Be(3850m, "PERCENTILE_CONT(0.95) of 1000..4000 ms is 3850, rounded");
    }

    [SkippableFact]
    public async Task With_no_voice_row_the_voice_numbers_are_measured_zeros()
    {
        await GuardAsync();

        AdminOpsHealthDto health;
        await using (var scope = AdminScope(BuildProvider()))
        {
            health = await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync();
        }

        // An aggregate with no GROUP BY answers one row: with no recordings its counts are real zeros, and the
        // read does not fail on the NULL percentile.
        health.VoiceInvocations24h.Should().Be(0);
        health.VoiceFailures24h.Should().Be(0);
        health.VoiceFailureRatePct.Should().Be(0m);
        health.VoiceAvgLatencyMs.Should().Be(0m);
        health.VoiceP95LatencyMs.Should().Be(0m);
    }

    /// <summary>One <c>ai.invocation</c> row: the vocabulary's required props plus the latency the query reads.</summary>
    private static Task InvocationAsync(NpgsqlConnection db, DateTime at, string outcome, int latencyMs) =>
        EventAsync(db, AiInvocation, at, farmId: Farm,
            props: Props(("farmId", Farm.ToString("D")), ("outcome", outcome), ("latencyMs", latencyMs),
                ("model", "fake-model")));
}
