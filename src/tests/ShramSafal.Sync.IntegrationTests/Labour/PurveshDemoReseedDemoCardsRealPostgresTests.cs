// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 2 (L5, the orchestrator's ruling) and fix pass 3 (R3). Demo
// workers' ShramSafal cards:
//   - OUTSIDE Production the re-seed issues each new demo worker's card through the product's own create path and the
//     identity store, inside its one transaction; a later re-seed KEEPS a seed worker whose only identity event is that
//     one CardIssued (proof None) — never deleted (his card is permanent), never re-made — and reports "KeptWithCard";
//   - a worker the founder gave a phone or PIN (PhoneAdded / PinSet) is never taken for the seeder's: he is retained
//     and reported as the founder's action;
//   - IN Production the re-seed issues no card at all, so demo workers never become permanent ShramSafal identities.
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using Npgsql;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoReseedDemoCardsRealPostgresTests(
    PurveshDemoReseedTemplateFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateFixture>
{
    private static readonly DateTime Day1 = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime FounderActsUtc = new(2026, 3, 10, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Day2 = new(2026, 3, 11, 6, 30, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = PurveshDemoSeeder.DemoFarmId;

    [Fact]
    public async Task Outside_Production_demo_workers_get_cards_and_the_next_reseed_keeps_them_with_their_cards()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse("proven as agrisync_app, never past RLS");

        var first = await H.RunReseedAsync(s.AppProvider(environmentName: "Staging"), Day1, dryRun: false);
        output.WriteLine(first.Output);
        first.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, first.Output);
        first.Output.Should().Contain("demo workers get their ShramSafal card (not Production)");

        var carded = await CardsOfDemoWorkersAsync(s);
        carded.Should().NotBeEmpty("every new demo worker got his card");
        var seedWorkers = await SeedWorkerCountAsync(s, first.RequireReport());
        carded.Count.Should().Be(seedWorkers, "each seed worker has exactly one working card");
        (await CardOnlyWorkersAsync(s)).Should().Be(seedWorkers, "each has exactly one identity event: CardIssued, proof None");

        var second = await H.RunReseedAsync(s.AppProvider(environmentName: "Staging"), Day2, dryRun: false);
        output.WriteLine(second.Output);
        second.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, "a carded demo stays refreshable: " + second.Output);
        var report = second.RequireReport();
        report.Prop("KeptWithCard").GetInt32().Should().Be(seedWorkers, "the report says how many were kept with their card");
        report.Prop("Tables").Prop("field_operators").Prop("SeedRetained").GetInt32().Should().Be(0,
            "kept with a card is not 'retained' for anything the founder did");
        report.Prop("Retained").EnumerateArray().Select(e => e.GetString())
            .Should().NotContain(line => line!.StartsWith("field_operators", StringComparison.Ordinal));
        (await CardsOfDemoWorkersAsync(s)).Should().BeEquivalentTo(carded, "same workers, same cards: nothing re-made");
        (await CardOnlyWorkersAsync(s)).Should().Be(seedWorkers, "no second card, no new identity event");
    }

    [Fact]
    public async Task A_demo_worker_the_founder_gave_a_phone_and_PIN_is_never_taken_for_the_seeders_card()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var first = await H.RunReseedAsync(s.AppProvider(environmentName: "Staging"), Day1, dryRun: false);
        first.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, first.Output);
        var seedWorkers = await SeedWorkerCountAsync(s, first.RequireReport());

        var op = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT o."Id" FROM ssf.field_operators o
            WHERE o.originating_farm_id = @farm AND o.person_id IS NOT NULL AND o.is_active AND o."Id" <> @keep
            ORDER BY o."Id" LIMIT 1
            """, ("farm", Farm), ("keep", NonSeedOperator)))!;
        await H.AsCallerAsync(s.AppProvider(clockUtc: FounderActsUtc), Farm, fixture.Template.OwnerUserId, async sp =>
        {
            var r = await sp.GetRequiredService<WorkerIdentityService>()
                .RecordContactAsync(Farm, fixture.Template.OwnerUserId, op, "6000000202", "Own", "413304", default);
            r.IsSuccess.Should().BeTrue("the founder records a demo worker's phone and PIN: {0}", r.Error);
            return true;
        });

        var second = await H.RunReseedAsync(s.AppProvider(environmentName: "Staging"), Day2, dryRun: false);
        second.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, second.Output);
        var report = second.RequireReport();
        report.Prop("Retained").EnumerateArray().Select(e => e.GetString()).Should().Contain(
            line => line!.Contains(op.ToString("D"), StringComparison.OrdinalIgnoreCase),
            "a phone or a PIN is the founder's action: reported as retained");
        report.Prop("KeptWithCard").GetInt32().Should().Be(seedWorkers - 1, "he is not one of the seeder's own");
    }

    [Fact]
    public async Task In_Production_the_reseed_issues_no_card_at_all()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var cardsBefore = (long)(await H.ScalarAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.shram_cards"))!;
        var personsBefore = (long)(await H.ScalarAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.shram_persons"))!;

        var run = await H.RunReseedAsync(s.AppProvider(environmentName: "Production"), Day1, dryRun: false);
        output.WriteLine(run.Output);
        run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, run.Output);
        run.Output.Should().Contain("demo workers get NO ShramSafal card (Production)");
        run.RequireReport().Prop("KeptWithCard").GetInt32().Should().Be(0);

        ((long)(await H.ScalarAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.shram_cards"))!).Should().Be(cardsBefore,
            "no card row is written in Production");
        ((long)(await H.ScalarAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.shram_persons"))!).Should().Be(personsBefore,
            "no ShramSafal person either");
        (await CardsOfDemoWorkersAsync(s)).Should().BeEmpty("demo workers show without a card");
        (await H.ScalarAsync(s.SuperuserConn, """
            SELECT count(*) FROM ssf.field_operators WHERE originating_farm_id = @farm AND person_id IS NOT NULL AND "Id" <> @keep
            """, ("farm", Farm), ("keep", NonSeedOperator))).Should().Be(0L, "no demo worker is a ShramSafal person");
        PurveshDemoReseedCommand.DemoCardsAllowed(null).Should().BeFalse("no environment counts as Production");
    }

    /// <summary>
    /// Fix pass 3 (review R3) — in Production the re-seed issues no card, so a card the APP made on a demo worker (the
    /// founder taps "फोन पडताळा" on one with no phone: his card is issued and kept, the code is refused) is the founder's
    /// action: that worker is retained and reported, never counted as "kept with card".
    /// </summary>
    [Fact]
    public async Task In_Production_a_card_the_app_made_on_a_demo_worker_is_reported_as_retained_not_kept_with_card()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var first = await H.RunReseedAsync(s.AppProvider(environmentName: "Production"), Day1, dryRun: false);
        first.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, first.Output);

        var op = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT o."Id" FROM ssf.field_operators o
            WHERE o.originating_farm_id = @farm AND o.person_id IS NULL AND o.is_active AND o."Id" <> @keep
            ORDER BY o."Id" LIMIT 1
            """, ("farm", Farm), ("keep", NonSeedOperator)))!;
        await H.AsCallerAsync(s.AppProvider(clockUtc: FounderActsUtc), Farm, fixture.Template.OwnerUserId, async sp =>
        {
            var r = await sp.GetRequiredService<WorkerIdentityService>()
                .SendRecordCodeAsync(Farm, fixture.Template.OwnerUserId, op, "Verify", null, default);
            r.IsSuccess.Should().BeFalse("he has no phone on record, so no code is sent");
            return true;
        });
        (await H.ScalarAsync(s.SuperuserConn, """
            SELECT count(*) FROM ssf.shram_identity_events WHERE farm_id = @farm AND field_operator_id = @op AND kind = 'CardIssued'
            """, ("farm", Farm), ("op", op))).Should().Be(1L, "arrange: the app issued his card");

        var second = await H.RunReseedAsync(s.AppProvider(environmentName: "Production"), Day2, dryRun: false);
        second.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, second.Output);
        var report = second.RequireReport();
        report.Prop("KeptWithCard").GetInt32().Should().Be(0, "the re-seed issued no card in Production");
        report.Prop("Retained").EnumerateArray().Select(e => e.GetString()).Should().Contain(
            line => line!.Contains(op.ToString("D"), StringComparison.OrdinalIgnoreCase),
            "a card the founder's app made is his action: retained and reported");
    }

    /// <summary>"worker:card" for every SEED worker on the demo farm holding a working card (the template's own non-seed worker excluded).</summary>
    private async Task<System.Collections.Generic.List<string>> CardsOfDemoWorkersAsync(PurveshDemoReseedScratch s)
    {
        await using var db = new NpgsqlConnection(s.SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT f."Id"::text || ':' || c.code FROM ssf.field_operators f
              JOIN ssf.shram_cards c ON c.person_id = f.person_id AND c.retired_at_utc IS NULL
             WHERE f.originating_farm_id = @farm AND f."Id" <> @keep
             ORDER BY 1
            """;
        cmd.Parameters.AddWithValue("farm", Farm);
        cmd.Parameters.AddWithValue("keep", NonSeedOperator);
        var rows = new System.Collections.Generic.List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private Guid NonSeedOperator => fixture.Template.NonSeedOperatorId ?? Guid.Empty;

    private async Task<long> CardOnlyWorkersAsync(PurveshDemoReseedScratch s)
        => (long)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT count(*) FROM (
              SELECT e.field_operator_id FROM ssf.shram_identity_events e
               WHERE e.farm_id = @farm AND e.field_operator_id IS NOT NULL AND e.field_operator_id <> @keep
               GROUP BY e.field_operator_id
              HAVING count(*) = 1 AND bool_and(e.kind = 'CardIssued' AND e.proof = 'None')) x
            """, ("farm", Farm), ("keep", NonSeedOperator)))!;

    /// <summary>Seed workers on the demo farm = every worker there minus the ones the seeder did not make.</summary>
    private static async Task<int> SeedWorkerCountAsync(PurveshDemoReseedScratch s, System.Text.Json.JsonElement report)
    {
        var all = (long)(await H.ScalarAsync(s.SuperuserConn,
            "SELECT count(*) FROM ssf.field_operators WHERE originating_farm_id = @farm", ("farm", Farm)))!;
        var nonSeed = report.Prop("Tables").Prop("field_operators").Prop("NonSeedUntouched").GetInt32();
        return (int)all - nonSeed;
    }
}
