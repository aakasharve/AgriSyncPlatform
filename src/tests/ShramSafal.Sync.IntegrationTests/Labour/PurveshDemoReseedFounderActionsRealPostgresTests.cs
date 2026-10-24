// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Labour.DeactivateFieldOperator;
using ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;
using ShramSafal.Application.UseCases.Labour.RenameFieldOperator;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — seed rows the founder ACTED ON survive every
/// refresh. After a first reseed the owner performs ONE action through the product's own handler,
/// under his own RLS scope as <c>agrisync_app</c>: he approves a demo log, corrects a demo
/// engagement (labour), corrects a demo cost (money), marks a demo worker, renames a demo worker,
/// or retires one. A reseed on the NEXT farm-local day must keep the seed row he acted on — and
/// every row his action wrote — exactly as he left it (never deleted, never re-anchored), and name
/// it in the report, while the rest of the demo still moves to the new day.
/// </summary>
/// <remarks>
/// One action per case, on purpose: retentions cascade (a kept engagement keeps its attributed
/// workers), so a combined scenario can pass for the wrong reason. Each case asserts the report
/// names THE row the founder touched.
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoReseedFounderActionsRealPostgresTests(
    PurveshDemoReseedTemplateFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateFixture>
{
    private static readonly DateTime Day1 = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime FounderActsUtc = new(2026, 3, 10, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Day2 = new(2026, 3, 11, 6, 30, 0, DateTimeKind.Utc);

    private static readonly Guid Farm = PurveshDemoSeeder.DemoFarmId;

    [Theory]
    [InlineData("approval")]
    [InlineData("labour-correction")]
    [InlineData("money-correction")]
    [InlineData("mark-on-a-demo-worker")]
    [InlineData("rename-a-demo-worker")]
    [InlineData("retire-a-demo-worker")]
    public async Task A_seed_row_the_founder_acted_on_is_kept_as_he_left_it_and_reported_while_the_rest_reanchors(string action)
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse();

        var first = await H.RunReseedAsync(s.AppProvider(), Day1, dryRun: false);
        first.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, first.Output);

        var founder = s.AppProvider(clockUtc: FounderActsUtc);
        var (seedTable, seedId, keep) = await ActAsync(s, founder, action);
        output.WriteLine($"[EVIDENCE] {action}: founder acted on {seedTable} {seedId}");

        var acted = await s.SnapshotAsync();
        var keptRows = keep.SelectMany(k =>
        {
            var rows = acted.Rows(k.Table).Where(k.Match).ToList();
            rows.Should().NotBeEmpty($"arrange: {k.Table} must hold the row the founder's action left");
            return rows.Select(r => (k.Table, Row: r));
        }).ToList();

        var second = await H.RunReseedAsync(s.AppProvider(), Day2, dryRun: false);
        output.WriteLine(second.Output);
        second.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk,
            "a demo the founder has used must still be refreshable: " + second.Output);
        var after = await s.SnapshotAsync();

        foreach (var (table, row) in keptRows)
        {
            after.Rows(table).Should().Contain(row,
                $"{table}: what the founder did ({action}) must survive the refresh exactly — never deleted, never re-anchored");
        }

        var report = second.RequireReport();
        report.Prop("Retained").EnumerateArray().Select(e => e.GetString()).Should().Contain(
            line => line!.Contains(seedId.ToString("D"), StringComparison.OrdinalIgnoreCase),
            $"the report must name the seed row the founder acted on ({seedTable} {seedId})");
        report.Prop("Tables").Prop(seedTable).Prop("SeedRetained").GetInt32().Should().BeGreaterThan(0,
            $"{seedTable}: the kept seed row is counted as retained");

        H.AsDate(await H.ScalarAsync(s.SuperuserConn,
                "SELECT max(log_date) FROM ssf.daily_logs WHERE farm_id = @farm", ("farm", Farm)))
            .Should().Be(new DateOnly(2026, 3, 11), "the rest of the demo re-anchors to the new run day");
    }

    private sealed record Keep(string Table, Func<string, bool> Match);

    private sealed record Acted(string SeedTable, Guid SeedId, List<Keep> Keep);

    private Task<Acted> ActAsync(PurveshDemoReseedScratch s, IServiceProvider founder, string action) => action switch
    {
        "approval" => ApproveAsync(s, founder),
        "labour-correction" => CorrectLabourAsync(s, founder),
        "money-correction" => CorrectMoneyAsync(s, founder),
        "mark-on-a-demo-worker" => MarkDemoWorkerAsync(s, founder),
        "rename-a-demo-worker" => RenameOrRetireAsync(s, founder, rename: true),
        "retire-a-demo-worker" => RenameOrRetireAsync(s, founder, rename: false),
        _ => throw new ArgumentOutOfRangeException(nameof(action), action, null),
    };

    private Guid Owner => fixture.Template.OwnerUserId;

    private static (string, object) FarmParam => ("farm", Farm);

    private (string, object) NonSeedOperatorParam => ("keep", fixture.Template.NonSeedOperatorId!.Value);

    private async Task<Acted> ApproveAsync(PurveshDemoReseedScratch s, IServiceProvider founder)
    {
        var log = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            WITH latest AS (
                SELECT DISTINCT ON (l."Id") l."Id", l.log_date, v.status
                FROM ssf.daily_logs l LEFT JOIN ssf.verification_events v ON v.daily_log_id = l."Id"
                WHERE l.farm_id = @farm
                ORDER BY l."Id", v.occurred_at_utc DESC NULLS LAST)
            SELECT latest."Id" FROM latest
            WHERE status = 'Confirmed'
              AND NOT EXISTS (SELECT 1 FROM ssf.labour_assignments a WHERE a.daily_log_id = latest."Id")
            ORDER BY log_date DESC, "Id" LIMIT 1
            """, FarmParam))!;
        await H.AsCallerAsync(founder, Farm, Owner, async sp =>
        {
            var r = await sp.GetRequiredService<VerifyLogHandler>().HandleAsync(
                new VerifyLogCommand(log, VerificationStatus.Verified, null, Owner));
            r.IsSuccess.Should().BeTrue("the owner approves a demo log: {0}", r.Error);
            return true;
        });

        return new Acted("daily_logs", log, new List<Keep>
        {
            new("ssf.daily_logs", r => StartsWithId(r, log)),
            new("ssf.verification_events", r => r.Contains(log.ToString("D"), StringComparison.Ordinal)),
        });
    }

    private async Task<Acted> CorrectLabourAsync(PurveshDemoReseedScratch s, IServiceProvider founder)
    {
        var assignment = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT a."Id" FROM ssf.labour_assignments a JOIN ssf.daily_logs l ON l."Id" = a.daily_log_id
            WHERE l.farm_id = @farm AND a.engagement_type = 'Hired' AND a.engaged_through_field_operator_id IS NULL
            ORDER BY l.log_date DESC, a."Id" LIMIT 1
            """, FarmParam))!;
        var log = (Guid)(await H.ScalarAsync(s.SuperuserConn,
            """SELECT daily_log_id FROM ssf.labour_assignments WHERE "Id" = @a""", ("a", assignment)))!;
        await H.AsCallerAsync(founder, Farm, Owner, async sp =>
        {
            var r = await sp.GetRequiredService<IHandler<CorrectLabourCommand, CorrectLabourResult>>().HandleAsync(
                new CorrectLabourCommand(new FarmId(Farm), assignment, new UserId(Owner), "founder-phone",
                    "founder-labour-correction-1", "तास चुकले", null, 5.5m, null, null));
            r.IsSuccess.Should().BeTrue("the owner corrects a demo engagement: {0}", r.Error);
            return true;
        });

        return new Acted("labour_assignments", assignment, new List<Keep>
        {
            new("ssf.labour_assignments", r => StartsWithId(r, assignment)),
            new("ssf.labour_corrections", r => r.Contains(assignment.ToString("D"), StringComparison.Ordinal)),
            new("ssf.daily_logs", r => StartsWithId(r, log)),
        });
    }

    private async Task<Acted> CorrectMoneyAsync(PurveshDemoReseedScratch s, IServiceProvider founder)
    {
        var cost = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT "Id" FROM ssf.cost_entries
            WHERE farm_id = @farm AND NOT is_corrected AND category_id NOT LIKE 'labour%'
            ORDER BY entry_date DESC, "Id" LIMIT 1
            """, FarmParam))!;
        await H.AsCallerAsync(founder, Farm, Owner, async sp =>
        {
            var r = await sp.GetRequiredService<CorrectCostEntryHandler>().HandleAsync(
                new CorrectCostEntryCommand(cost, 1234m, "INR", "रक्कम चुकली", Owner));
            r.IsSuccess.Should().BeTrue("the owner corrects a demo cost: {0}", r.Error);
            return true;
        });

        return new Acted("cost_entries", cost, new List<Keep>
        {
            new("ssf.cost_entries", r => StartsWithId(r, cost)),
            new("ssf.finance_corrections", r => r.Contains(cost.ToString("D"), StringComparison.Ordinal)),
        });
    }

    /// <summary>
    /// A demo worker with NO crew role and the fewest attributions, marked on a day with no seed row
    /// of his nearby — so the founder's mark is the only reason to keep him.
    /// </summary>
    private async Task<Acted> MarkDemoWorkerAsync(PurveshDemoReseedScratch s, IServiceProvider founder)
    {
        var op = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT o."Id" FROM ssf.field_operators o
            WHERE o.originating_farm_id = @farm AND o."Id" <> @keep
              AND NOT EXISTS (SELECT 1 FROM ssf.labour_assignments a WHERE a.engaged_through_field_operator_id = o."Id")
            ORDER BY (SELECT count(*) FROM ssf.field_operator_work_rows w WHERE w.field_operator_id = o."Id"), o."Id"
            LIMIT 1
            """, FarmParam, NonSeedOperatorParam))!;
        var date = H.AsDate(await H.ScalarAsync(s.SuperuserConn, """
            SELECT d::date FROM generate_series(DATE '2026-02-06', DATE '2026-03-09', INTERVAL '1 day') d
            WHERE NOT EXISTS (SELECT 1 FROM ssf.attendance_marks m
                              WHERE m.farm_id = @farm AND m.field_operator_id = @op
                                AND m.work_date BETWEEN d::date - 1 AND d::date + 1)
              AND NOT EXISTS (SELECT 1 FROM ssf.field_operator_work_rows w
                              WHERE w.farm_id = @farm AND w.field_operator_id = @op
                                AND w.work_date BETWEEN d::date - 1 AND d::date + 1)
            ORDER BY d DESC LIMIT 1
            """, FarmParam, ("op", op)));
        var markId = Guid.NewGuid();
        await H.AsCallerAsync(founder, Farm, Owner, async sp =>
        {
            var r = await sp.GetRequiredService<RecordAttendanceMarkHandler>().HandleAsync(
                new RecordAttendanceMarkCommand(markId, Farm, op, date, DayMark.Half, null, null, null, null, Owner));
            (r.IsSuccess && r.Value!.Outcome == AttendanceDayOutcome.Recorded).Should().BeTrue(
                "the owner marks a demo worker: {0}", r.Error);
            return true;
        });

        return new Acted("field_operators", op, new List<Keep>
        {
            new("ssf.attendance_marks", r => StartsWithId(r, markId)),
            new("ssf.field_operators", r => StartsWithId(r, op)),
        });
    }

    /// <summary>The busiest non-crew demo worker: his work rows are re-written around him.</summary>
    private async Task<Acted> RenameOrRetireAsync(PurveshDemoReseedScratch s, IServiceProvider founder, bool rename)
    {
        var op = (Guid)(await H.ScalarAsync(s.SuperuserConn, """
            SELECT o."Id" FROM ssf.field_operators o
            WHERE o.originating_farm_id = @farm AND o."Id" <> @keep
              AND NOT EXISTS (SELECT 1 FROM ssf.labour_assignments a WHERE a.engaged_through_field_operator_id = o."Id")
            ORDER BY (SELECT count(*) FROM ssf.field_operator_work_rows w WHERE w.field_operator_id = o."Id") DESC, o."Id"
            LIMIT 1
            """, FarmParam, NonSeedOperatorParam))!;
        await H.AsCallerAsync(founder, Farm, Owner, async sp =>
        {
            if (rename)
            {
                var r = await sp.GetRequiredService<IHandler<RenameFieldOperatorCommand, FieldOperatorDto>>()
                    .HandleAsync(new RenameFieldOperatorCommand(new FarmId(Farm), op, "नवीन नाव", new UserId(Owner)));
                r.IsSuccess.Should().BeTrue("the owner renames a demo worker: {0}", r.Error);
            }
            else
            {
                var r = await sp.GetRequiredService<IHandler<DeactivateFieldOperatorCommand, FieldOperatorDto>>()
                    .HandleAsync(new DeactivateFieldOperatorCommand(new FarmId(Farm), op, new UserId(Owner)));
                r.IsSuccess.Should().BeTrue("the owner retires a demo worker: {0}", r.Error);
            }

            return true;
        });

        // field_operators renders is_active last: ",f)" is a retired worker.
        var keep = rename
            ? new Keep("ssf.field_operators", r => StartsWithId(r, op) && r.Contains("नवीन नाव", StringComparison.Ordinal))
            : new Keep("ssf.field_operators", r => StartsWithId(r, op) && r.EndsWith(",f)", StringComparison.Ordinal));
        return new Acted("field_operators", op, new List<Keep> { keep });
    }

    private static bool StartsWithId(string row, Guid id) =>
        row.StartsWith("(" + id.ToString("D") + ",", StringComparison.Ordinal);
}
