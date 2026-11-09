// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT-S1 (register item F150; founder D-92: an answer is append-only).
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 lane IT-S1 (F150) - <c>ssf.input_identity_assertions</c> keeps a RESTRICT key to
/// <c>ssf.farms</c> and the app role holds SELECT + INSERT on it only (append-only by privilege; migration
/// <c>AddInputIdentityAssertions</c>). So once the demo farm holds an answer, <c>CLEAR_PURVESH_DEMO=true</c> must remove the
/// answers FIRST, through the admin path (the migration connection), exactly as it removes a bill's stamps - and then the farm,
/// with no 23503 - and nobody else's answers.
/// </summary>
/// <remarks>
/// <para><b>Path exercised.</b> The clear refuses a farm that holds <c>ssf.daily_log_contents</c> rows with its own message
/// (the details of records made in the app), and an answer normally needs such a content item, so in real use the refusal
/// stops the clear first and the answers are reached only on a farm whose content rows are gone. The table has NO foreign key to
/// <c>ssf.daily_logs</c> (migration remarks), so these tests plant answer rows with no content row behind them: the farm state
/// the clear's content guard lets through, with answers on it. The refusal is not weakened or bypassed - the demo farm here
/// holds no content rows, and the arrange step asserts that.</para>
/// <para>Run (needs the throwaway cluster the other RealPostgres suites use):
/// <c>dotnet test src/tests/ShramSafal.Sync.IntegrationTests --filter "FullyQualifiedName~PurveshDemoClearRemovesInputAnswersRealPostgresTests"</c></para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoClearRemovesInputAnswersRealPostgresTests(
    PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture>
{
    private static readonly DateTime RunUtc = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);

    [Fact]
    public async Task PurveshDemoClear_RemovesInputAnswers_ThenTheFarm_RealPostgres()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        await AssertAppRoleIsNotSuperOrBypassAsync(s);
        await ReseedAsync(s);

        var demoAnswers = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var strangerAnswer = Guid.NewGuid();
        await PlantAnswerAsync(s.SuperuserConn, demoAnswers[0], PurveshDemoSeeder.DemoFarmId, "its1-demo-1");
        await PlantAnswerAsync(s.SuperuserConn, demoAnswers[1], PurveshDemoSeeder.DemoFarmId, "its1-demo-2");
        await PlantAnswerAsync(s.SuperuserConn, strangerAnswer, fixture.Template.StrangerFarmId, "its1-other-1");
        (await AnswersOfAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId)).Should().Be(2, "arrange: the demo farm holds two answers");
        (await ContentRowsOfAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId)).Should().Be(0,
            "arrange: no content row, so the clear's content guard lets this farm through to the answers");

        var provider = s.AppProvider(environmentName: "Development", migrationConn: s.SuperuserConn);
        await using (var scope = provider.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            var summary = await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().ClearPurveshDemoAsync();
            output.WriteLine($"[EVIDENCE] clear with two answers on the demo farm: {summary}");
            summary.Should().Contain("inputAnswers=2").And.Contain("farms=1");
        }

        (await AnswersOfAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId)).Should().Be(0, "the answers go first");
        (await H.CountAsync(s.SuperuserConn, """SELECT count(*) FROM ssf.farms WHERE "Id" = @f""", ("f", PurveshDemoSeeder.DemoFarmId)))
            .Should().Be(0, "then the farm, with no 23503");
        (await AnswersOfAsync(s.SuperuserConn, fixture.Template.StrangerFarmId)).Should().Be(1, "another farm's answer is not the demo's");
        (await H.CountAsync(s.SuperuserConn, """SELECT count(*) FROM ssf.input_identity_assertions WHERE "Id" = @id""", ("id", strangerAnswer)))
            .Should().Be(1, "and it is the very same row");
    }

    [Fact]
    public async Task PurveshDemoClear_WithoutTheAdminPath_RefusesAndDeletesNothing_RealPostgres()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        await AssertAppRoleIsNotSuperOrBypassAsync(s);
        await ReseedAsync(s);
        await PlantAnswerAsync(s.SuperuserConn, Guid.NewGuid(), PurveshDemoSeeder.DemoFarmId, "its1-refuse-1");

        var before = await s.SnapshotAsync();
        var provider = s.AppProvider(environmentName: "Development"); // no migration connection: no admin path
        await using var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var act = async () => await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().ClearPurveshDemoAsync();

        // Real Postgres (run 2026-11-09, own cluster): with no migration connection the harness still registers an admin
        // factory, but its context runs as the APP role, which holds no DELETE on the append-only table. So the refusal that
        // actually fires is Postgres' own 42501, not the seeder's "no admin path" message (that branch is for a host with no
        // factory at all). Either way the clear stops, loudly, with nothing deleted: that is what this fact pins.
        var thrown = await act.Should().ThrowAsync<Exception>();
        var refusedByTheSeeder = thrown.Which is InvalidOperationException
            && thrown.Which.Message.Contains("ssf.input_identity_assertions", StringComparison.Ordinal)
            && thrown.Which.Message.Contains("Nothing was deleted", StringComparison.Ordinal);
        var refusedByThePrivilege = thrown.Which is PostgresException { SqlState: PostgresErrorCodes.InsufficientPrivilege } privilege
            && privilege.MessageText.Contains("input_identity_assertions", StringComparison.Ordinal);
        (refusedByTheSeeder || refusedByThePrivilege).Should().BeTrue(
            "the clear must refuse - by its own message or by the append-only privilege - not succeed or fail some other way: "
            + thrown.Which);

        (await AnswersOfAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId)).Should().Be(1, "the answer is still there");
        (await H.CountAsync(s.SuperuserConn, """SELECT count(*) FROM ssf.farms WHERE "Id" = @f""", ("f", PurveshDemoSeeder.DemoFarmId)))
            .Should().Be(1, "the farm is still there");
        // The audit trail and the delivery queue are append-only and written on their own connections, so an attempt leaves its
        // trace there (the neighbouring clear tests leave these two out of the same comparison); every other table is unchanged.
        H.Diff(before, await s.SnapshotAsync()).Select(d => d.Table)
            .Where(t => t is not "ssf.outbox_messages" and not "ssf.audit_events")
            .Should().BeEmpty("the whole clear rolled back");
    }

    private static async Task ReseedAsync(PurveshDemoReseedScratch s)
    {
        var reseed = await H.RunReseedAsync(s.AppProvider(), RunUtc, dryRun: false);
        reseed.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, reseed.Output);
    }

    /// <summary>Doctrine E3: the proof is about the app role, so the app role must be neither superuser nor BYPASSRLS.</summary>
    private static async Task AssertAppRoleIsNotSuperOrBypassAsync(PurveshDemoReseedScratch s)
    {
        await using var db = new NpgsqlConnection(s.SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'agrisync_app'";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("agrisync_app exists in the scratch cluster");
        reader.GetBoolean(0).Should().BeFalse("agrisync_app must not be a superuser");
        reader.GetBoolean(1).Should().BeFalse("agrisync_app must not bypass row security");
    }

    private static Task PlantAnswerAsync(string superuserConn, Guid id, Guid farm, string mutationId)
        => H.ExecAsync(superuserConn, """
            INSERT INTO ssf.input_identity_assertions
                ("Id", farm_id, plot_id, daily_log_id, input_event_id, mix_index, spoken_name, catalog_product_id, verdict,
                 attachment_id, catalog_version, asserted_by_user_id, asserted_at_utc, client_mutation_id, is_check)
            VALUES (@id, @farm, NULL, @log, 'e1', 0, 'test product', 'p-test', 'confirmed', NULL, 'inputs-test', @by, NOW(), @mutation, FALSE)
            """, ("id", id), ("farm", farm), ("log", Guid.NewGuid()), ("by", AnswererId), ("mutation", mutationId));

    /// <summary>An opaque person id: the table keeps no foreign key to a user.</summary>
    private static readonly Guid AnswererId = Guid.Parse("5e000000-0000-0000-0000-0000000000aa");

    private static async Task<long> AnswersOfAsync(string superuserConn, Guid farm)
        => await H.CountAsync(superuserConn, "SELECT count(*) FROM ssf.input_identity_assertions WHERE farm_id = @f", ("f", farm));

    private static async Task<long> ContentRowsOfAsync(string superuserConn, Guid farm)
        => await H.CountAsync(superuserConn, "SELECT count(*) FROM ssf.daily_log_contents WHERE farm_id = @f", ("f", farm));
}
