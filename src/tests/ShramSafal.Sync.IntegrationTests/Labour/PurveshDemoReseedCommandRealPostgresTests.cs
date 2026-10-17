// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the one-shot
/// <c>--reseed-purvesh-demo [--dry-run]</c> command, end to end against real Postgres, run the way
/// a human runs it in production: <see cref="PurveshDemoReseedCommand.RunAsync"/> over a
/// production-shaped DI graph connected as the non-superuser, non-BYPASSRLS <c>agrisync_app</c>
/// role, in a Production host environment, on a database migrated with the app's own history
/// tables.
/// </summary>
/// <remarks>
/// Every test starts from a private clone of the same prior state
/// (<see cref="PurveshDemoReseedTemplate"/>): the demo farm as v2 left it, a same-owner same-name
/// TWIN farm, a STRANGER farm, and a non-seed worker + his mark on the demo farm. Ground truth is
/// read as superuser (RLS-bypassing on purpose — these assertions are about what is STORED).
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoReseedCommandRealPostgresTests(
    PurveshDemoReseedTemplateFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateFixture>
{
    /// <summary>12:00 IST on 2026-03-10 — far from the real clock, so any real-clock leak shows.</summary>
    private static readonly DateTime T1 = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);

    /// <summary>17:45 IST, the same farm-local day.</summary>
    private static readonly DateTime T2 = new(2026, 3, 10, 12, 15, 0, DateTimeKind.Utc);

    /// <summary>00:30 IST on 2026-03-10 — whose UTC date is still 2026-03-09.</summary>
    private static readonly DateTime T3 = new(2026, 3, 9, 19, 0, 0, DateTimeKind.Utc);

    private static readonly DateOnly Today = new(2026, 3, 10);

    /// <summary>The spec: the command never creates or alters these.</summary>
    private static readonly string[] SpecForbiddenTables =
    [
        "public.users", "public.memberships", "public.otp_challenges", "public.refresh_tokens",
        "accounts.owner_accounts", "accounts.owner_account_memberships", "accounts.subscriptions",
        "accounts.referral_codes", "accounts.referral_relationships", "accounts.growth_events",
        "accounts.benefit_ledger_entries", "accounts.subscription_webhook_events",
        "ssf.farms", "ssf.plots", "ssf.farm_memberships", "ssf.farm_invitations", "ssf.farm_join_tokens",
        "ssf.schedule_templates", "ssf.template_activities", "ssf.crop_schedule_templates",
        "ssf.crop_schedule_prescribed_tasks", "ssf.price_configs", "ssf.cost_categories",
        "public.__ef_migrations", "ssf.__ef_migrations",
    ];

    /// <summary>
    /// The command's documented contract (ReseedDemoContentAsync remarks, "No side effects"): no
    /// outbox messages, no audit rows, no correction rows, no analytics.
    /// </summary>
    private static readonly string[] SideEffectTables =
    [
        "ssf.outbox_messages", "ssf.audit_events", "ssf.correction_events", "ssf.labour_corrections",
        "ssf.attendance_mark_corrections", "analytics.events", "ssf.workers",
    ];

    private PurveshDemoReseedTemplate Template => fixture.Template;

    [Fact]
    public async Task The_app_role_the_command_runs_as_cannot_bypass_rls()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse(
            "the command must be proven as agrisync_app (no superuser, no BYPASSRLS), or FORCE-RLS proves nothing");
    }

    [Fact]
    public async Task Commit_rewrites_only_the_demo_farms_seed_rows_keeps_and_reports_non_seed_rows_and_leaves_other_farms_identical()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse();

        var before = await s.SnapshotAsync();
        var run = await H.RunReseedAsync(s.AppProvider(), T1, dryRun: false);
        output.WriteLine(run.Output);

        run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, "a valid demo farm reseeds: " + run.Output);
        var report = run.RequireReport();
        report.Prop("DryRun").GetBoolean().Should().BeFalse();
        report.Prop("FarmId").GetGuid().Should().Be(PurveshDemoSeeder.DemoFarmId);
        report.Prop("OwnerUserId").GetGuid().Should().Be(Template.OwnerUserId);

        var after = await s.SnapshotAsync();
        var diffs = H.Diff(before, after);
        output.WriteLine("[EVIDENCE] changed tables: " + string.Join(", ",
            diffs.Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})")));
        diffs.Should().NotBeEmpty("a commit run must actually write the demo content");

        // 1 — the spec's never-touch tables, and the documented no-side-effect tables.
        diffs.Where(d => SpecForbiddenTables.Contains(d.Table)).Select(d => d.Table).Should().BeEmpty(
            "the reseed never creates or alters users, memberships, accounts, the farm row, plots, "
            + "invitations, templates or price configs");
        diffs.Where(d => SideEffectTables.Contains(d.Table)).Select(d => d.Table).Should().BeEmpty(
            "the reseed queues no outbox message and writes no audit, correction or analytics row");

        // 2 — every row that changed belongs to the demo farm.
        var demoOwned = await H.OwnedIdsAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId, before, after);
        var strays = diffs
            .SelectMany(d => d.Removed.Select(r => $"- {d.Table} {r}").Concat(d.Added.Select(r => $"+ {d.Table} {r}")))
            .Where(line => !H.Mentions(line, demoOwned))
            .ToList();
        strays.Should().BeEmpty("only the demo farm's rows may change; these rows are not the demo farm's");

        // 3 — other farms are hash-identical (the twin has the demo's OWNER and NAME).
        foreach (var (label, farmId) in new[] { ("twin", Template.TwinFarmId), ("stranger", Template.StrangerFarmId) })
        {
            var owned = await H.OwnedIdsAsync(s.SuperuserConn, farmId, before, after);
            var b = H.Footprint(before, owned);
            var a = H.Footprint(after, owned);
            b.Count.Should().BeGreaterThan(5, $"the {label} farm must hold real content for this to prove anything");
            H.Sha256(a).Should().Be(H.Sha256(b), $"the {label} farm must be byte-identical after the reseed");
        }

        // 4 — the non-seed worker and his mark survive untouched, and are reported.
        var opId = Template.NonSeedOperatorId!.Value;
        var markId = Template.NonSeedMarkId!.Value;
        RowById(after, "ssf.field_operators", opId).Should().Be(RowById(before, "ssf.field_operators", opId),
            "a worker the founder added in the app is not seed data: never deleted, never rewritten");
        RowById(after, "ssf.attendance_marks", markId).Should().Be(RowById(before, "ssf.attendance_marks", markId),
            "nor is the हजेरी mark he was given");
        RowById(after, "ssf.attendance_marks", markId).Should().NotBeNull();

        var tables = report.Prop("Tables");
        tables.Prop("field_operators").Prop("NonSeedUntouched").GetInt32().Should().Be(1,
            "the report must say the non-seed worker was kept");
        tables.Prop("attendance_marks").Prop("NonSeedUntouched").GetInt32().Should().Be(1,
            "and his mark");

        // 5 — rewritten rows carry ModifiedAtUtc = the run instant (so installed apps pull them).
        foreach (var (table, sql) in ModifiedAtProbes())
        {
            var rows = await H.RowsAsync(s.SuperuserConn, sql,
                ("farm", PurveshDemoSeeder.DemoFarmId), ("run", T1), ("keep", markId));
            var total = Convert.ToInt64(rows[0][0]);
            var stale = Convert.ToInt64(rows[0][1]);
            output.WriteLine($"[EVIDENCE] {table}: seed rows={total} modified_at != run instant: {stale}");
            total.Should().BeGreaterThan(0, $"{table} must hold re-seeded demo rows");
            stale.Should().Be(0, $"every re-written {table} row must carry ModifiedAtUtc = the run instant");
        }
    }

    [Fact]
    public async Task Every_rewritten_date_is_anchored_to_the_farm_local_run_day_and_the_data_has_the_specified_shape()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        var before = await s.SnapshotAsync();
        var run = await H.RunReseedAsync(s.AppProvider(), T1, dryRun: false);
        run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, run.Output);
        var report = run.RequireReport();

        report.Prop("AnchorFarmLocalDate").GetString().Should().Be("2026-03-10");
        report.Prop("LabourWindowFrom").GetString().Should().Be("2026-02-04", "the labour window is today-34..today");
        report.Prop("LabourWindowTo").GetString().Should().Be("2026-03-10");
        report.Prop("RunUtc").GetDateTime().ToUniversalTime().Should().Be(T1);

        var farm = ("farm", (object)PurveshDemoSeeder.DemoFarmId);
        var keepOp = ("keepOp", (object)Template.NonSeedOperatorId!.Value);

        // Diary: today-90..today; anything older than a week is approved.
        var logRange = (await H.RowsAsync(s.SuperuserConn,
            "SELECT min(log_date), max(log_date), count(*) FROM ssf.daily_logs WHERE farm_id = @farm", farm))[0];
        output.WriteLine($"[EVIDENCE] diary {logRange[0]}..{logRange[1]} ({logRange[2]} logs)");
        H.AsDate(logRange[0]).Should().Be(Today.AddDays(-90));
        H.AsDate(logRange[1]).Should().Be(Today);

        var olderNotApproved = await H.CountAsync(s.SuperuserConn, """
            WITH latest AS (
                SELECT DISTINCT ON (l."Id") l."Id", l.log_date, v.status
                FROM ssf.daily_logs l
                LEFT JOIN ssf.verification_events v ON v.daily_log_id = l."Id"
                WHERE l.farm_id = @farm
                ORDER BY l."Id", v.occurred_at_utc DESC NULLS LAST)
            SELECT count(*) FROM latest WHERE log_date < @weekAgo AND status IS DISTINCT FROM 'Verified'
            """, farm, ("weekAgo", Today.AddDays(-7)));
        olderNotApproved.Should().Be(0, "diary older than a week is approved");
        (await H.CountAsync(s.SuperuserConn, """
            WITH latest AS (
                SELECT DISTINCT ON (l."Id") l."Id", l.log_date, v.status
                FROM ssf.daily_logs l
                LEFT JOIN ssf.verification_events v ON v.daily_log_id = l."Id"
                WHERE l.farm_id = @farm
                ORDER BY l."Id", v.occurred_at_utc DESC NULLS LAST)
            SELECT count(*) FROM latest WHERE log_date >= @weekAgo AND status IS DISTINCT FROM 'Verified'
            """, farm, ("weekAgo", Today.AddDays(-7)))).Should().BeGreaterThan(0,
            "the last week waits for the owner, so the review queue has work in it");

        (await H.CountAsync(s.SuperuserConn, """
            SELECT count(*) FROM ssf.planned_activities p JOIN ssf.crop_cycles c ON c."Id" = p.crop_cycle_id
            WHERE c.farm_id = @farm
            """, farm)).Should().BeGreaterThan(0, "the demo carries planned items");

        // Labour: 7 demo workers, 50 engagements over today-34..today, 133 marks of every kind.
        (await H.CountAsync(s.SuperuserConn,
            "SELECT count(*) FROM ssf.field_operators WHERE originating_farm_id = @farm AND \"Id\" <> @keepOp", farm, keepOp))
            .Should().Be(7, "the demo has 7 workers");

        var engagements = await H.RowsAsync(s.SuperuserConn, """
            SELECT a.engagement_type, a.shift, a.engaged_through_field_operator_id IS NOT NULL, l.log_date
            FROM ssf.labour_assignments a JOIN ssf.daily_logs l ON l."Id" = a.daily_log_id
            WHERE l.farm_id = @farm
            """, farm);
        engagements.Should().HaveCount(50, "the demo has 50 engagements");
        engagements.Select(e => H.AsDate(e[3])).Should()
            .OnlyContain(d => d >= Today.AddDays(-34) && d <= Today, "engagements lie in today-34..today");
        engagements.Should().Contain(e => (string)e[0]! == "Hired" && !(bool)e[2]! && (string?)e[1] != "Night",
            "a day-rate engagement");
        engagements.Should().Contain(e => (bool)e[2]!, "a Mukadam crew engagement (engaged through him)");
        engagements.Should().Contain(e => (string)e[0]! == "Contract", "an उक्ते (contract) engagement");
        engagements.Should().Contain(e => (string?)e[1] == "Night", "a night (irrigation) engagement");

        var marks = await H.RowsAsync(s.SuperuserConn, """
            SELECT day_mark, night_mark, hours_worked, extra_hours, work_date
            FROM ssf.attendance_marks WHERE farm_id = @farm AND field_operator_id <> @keepOp
            """, farm, keepOp);
        marks.Should().HaveCount(133, "the demo has 133 attendance marks");
        marks.Select(m => H.AsDate(m[4])).Should()
            .OnlyContain(d => d >= Today.AddDays(-34) && d <= Today, "marks lie in today-34..today");
        marks.Should().Contain(m => (int)m[0]! == 1, "a पूर्ण (Full) day");
        marks.Should().Contain(m => (int)m[0]! == 2, "an अर्धा (Half) day");
        marks.Should().Contain(m => (int)m[0]! == 3, "an absent day");
        marks.Should().Contain(m => (int)m[1]! == 1, "a night worked");
        marks.Should().Contain(m => m[2] != null, "stated hours");
        marks.Should().Contain(m => m[3] != null, "stated extra hours");

        (await H.CountAsync(s.SuperuserConn, """
            SELECT count(*) FROM ssf.cost_entries
            WHERE farm_id = @farm AND category_id LIKE 'labour%' AND entry_date BETWEEN @from AND @to
            """, farm, ("from", Today.AddDays(-34)), ("to", Today))).Should().BeGreaterThan(0,
            "labour payouts are recorded in the labour window");

        // No re-written row is stamped on a farm-local day after the run day — so none carries the
        // real clock (2026-10 here) either. Time-of-day within the run day is NOT checked: the spec's
        // same-day idempotency means a 00:30 IST run and a 17:45 IST run write identical content.
        var after = await s.SnapshotAsync();
        var demoOwned = await H.OwnedIdsAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId, before, after);
        var added = H.Diff(before, after)
            .SelectMany(d => d.Added.Where(r => H.Mentions(r, demoOwned)).Select(r => (d.Table, Row: r)))
            .ToList();
        added.Should().NotBeEmpty();
        var future = added
            .SelectMany(x => Timestamps(x.Row).Where(ts => H.FarmLocalDate(ts) > Today)
                .Select(ts => $"{x.Table}: {ts:O} in {x.Row}"))
            .ToList();
        future.Should().BeEmpty("every timestamp is anchored to the run's farm-local day or before it");

        (await H.CountAsync(s.SuperuserConn, """
            SELECT count(*) FROM ssf.cost_entries WHERE farm_id = @farm AND entry_date > @today
            """, farm, ("today", Today))).Should().Be(0, "no cost is dated after today");
    }

    [Fact]
    public async Task Rerunning_on_the_same_farm_local_day_produces_the_same_content()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        var provider = s.AppProvider();

        var first = await H.RunReseedAsync(provider, T1, dryRun: false);
        first.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, first.Output);
        var s1 = await s.SnapshotAsync();

        // Same instant again: byte-identical database.
        var again = await H.RunReseedAsync(provider, T1, dryRun: false);
        again.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, again.Output);
        var s1Again = await s.SnapshotAsync();
        H.Diff(s1, s1Again).Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})").Should().BeEmpty(
            "a second run at the same instant must leave the database exactly as the first left it");

        // Later the same IST day, and in the IST small hours (UTC date still the day before).
        foreach (var t in new[] { T2, T3 })
        {
            var rerun = await H.RunReseedAsync(provider, t, dryRun: false);
            rerun.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, rerun.Output);
            rerun.RequireReport().Prop("AnchorFarmLocalDate").GetString().Should().Be("2026-03-10",
                $"{t:O} is 2026-03-10 on the farm's (IST) calendar");
            var sN = await s.SnapshotAsync();

            var diffs = H.Diff(Normalize(s1, T1), Normalize(sN, t));
            foreach (var d in diffs)
            {
                output.WriteLine($"[EVIDENCE] {t:O} differs in {d.Table}: -{d.Removed.Count}/+{d.Added.Count}; "
                    + $"e.g. - {d.Removed.FirstOrDefault()} | + {d.Added.FirstOrDefault()}");
            }

            diffs.Select(d => d.Table).Should().BeEmpty(
                $"a rerun at {t:O} (same farm-local day) must produce the same content; only the "
                + "run-instant sync stamp may differ");
        }
    }

    [Fact]
    public async Task Dry_run_writes_nothing_and_rehearses_exactly_what_the_commit_then_does()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        var provider = s.AppProvider();
        var before = await s.SnapshotAsync();

        var dry = await H.RunReseedAsync(provider, T1, dryRun: true);
        output.WriteLine(dry.Output);
        dry.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, dry.Output);
        var dryReport = dry.RequireReport();
        dryReport.Prop("DryRun").GetBoolean().Should().BeTrue();

        var afterDry = await s.SnapshotAsync();
        H.Diff(before, afterDry).Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})").Should().BeEmpty(
            "a dry run rolls everything back — not one row anywhere may change");

        var commit = await H.RunReseedAsync(provider, T1, dryRun: false);
        commit.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, commit.Output);
        commit.RequireReport().Prop("Tables").GetRawText().Should().Be(dryReport.Prop("Tables").GetRawText(),
            "the rehearsal must report exactly the per-table outcome the commit then produces");
    }

    /// <summary>
    /// Exit 1 = "failed and rolled back". A fault injected late in the run (the database refuses
    /// the first demo हजेरी mark — written after the diary, engagements and attributions) must
    /// leave NOTHING behind: one transaction, all or nothing.
    /// </summary>
    [Fact]
    public async Task A_failure_part_way_through_exits_1_and_rolls_every_write_back()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        await H.ExecAsync(s.SuperuserConn, $"""
            CREATE FUNCTION public.zz_reseed_test_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $f$
            BEGIN RAISE EXCEPTION 'injected failure (test)'; END $f$;
            CREATE TRIGGER zz_reseed_test_injected_failure BEFORE INSERT ON ssf.attendance_marks
            FOR EACH ROW WHEN (NEW.farm_id = '{PurveshDemoSeeder.DemoFarmId}'::uuid)
            EXECUTE FUNCTION public.zz_reseed_test_injected_failure();
            """);

        var before = await s.SnapshotAsync();
        var run = await H.RunReseedAsync(s.AppProvider(), T1, dryRun: false);
        output.WriteLine(run.Output);

        run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitFailed, "a failure mid-run is exit 1");
        H.Diff(before, await s.SnapshotAsync()).Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})")
            .Should().BeEmpty("the run is one transaction: a failure rolls back every delete and every write");
    }

    [Fact]
    public async Task The_demo_owners_labour_page_reads_a_populated_ledger_crew_row_review_queue_and_dashboard()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(Template);
        var run = await H.RunReseedAsync(s.AppProvider(), T1, dryRun: false);
        run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, run.Output);

        var reader = s.AppProvider(clockUtc: T1);
        foreach (var window in new[] { "week", "month" })
        {
            var data = await H.AsCallerAsync(reader, PurveshDemoSeeder.DemoFarmId, Template.OwnerUserId, async sp =>
            {
                var result = await new GetLabourDataHandler(
                        sp.GetRequiredService<IShramSafalRepository>(), new H.FixedClock(T1))
                    .HandleAsync(new GetLabourDataQuery(
                        new FarmId(PurveshDemoSeeder.DemoFarmId), new UserId(Template.OwnerUserId), window));
                result.IsSuccess.Should().BeTrue("the owner reads his own labour page: {0}", result.Error);
                return result.Value!;
            });

            output.WriteLine($"[EVIDENCE] window={window} view={data.View} rows={data.Ledger.Rows.Count} "
                + $"crew={data.Ledger.CrewRows.Count} review={data.Review.Count} manDays={data.Dashboard.ManDays} "
                + $"logs={data.Dashboard.Logs} pending={data.Dashboard.Pending} paid={data.Dashboard.Money?.Paid}");

            data.View.Should().Be("owner");
            data.Ledger.Rows.Should().NotBeEmpty($"the {window} register lists the demo workers");
            data.Ledger.Rows.SelectMany(r => r.Cells).Should().Contain(c => c != null && c.Day != null,
                "and their marks fill the register");
            data.Ledger.CrewRows.Should().NotBeEmpty("the Mukadam's crew has its own row");
            data.Ledger.CrewRows.SelectMany(c => c.Counts).Should().Contain(n => n > 0,
                "with a stated headcount on at least one day");
            data.Review.Should().NotBeEmpty("this week's work waits in the review queue");
            data.Dashboard.ManDays.Should().BeGreaterThan(0m);
            data.Dashboard.Logs.Should().BeGreaterThan(0);
            data.Dashboard.Pending.Should().BeGreaterThan(0);
            data.Dashboard.Money.Should().NotBeNull();
            data.Dashboard.Money!.Paid.Should().BeGreaterThan(0m, "labour payouts are on the books");
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static string? RowById(H.DbSnapshot snapshot, string table, Guid id)
    {
        var prefix = "(" + id.ToString("D") + ",";
        return snapshot.Rows(table).SingleOrDefault(r => r.StartsWith(prefix, StringComparison.Ordinal));
    }

    private static IEnumerable<(string Table, string Sql)> ModifiedAtProbes()
    {
        const string Count = "SELECT count(*), count(*) FILTER (WHERE t.modified_at_utc <> @run)";
        yield return ("daily_logs", $"{Count} FROM ssf.daily_logs t WHERE t.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("crop_cycles", $"{Count} FROM ssf.crop_cycles t WHERE t.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("planned_activities",
            $"{Count} FROM ssf.planned_activities t JOIN ssf.crop_cycles c ON c.\"Id\" = t.crop_cycle_id WHERE c.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("cost_entries", $"{Count} FROM ssf.cost_entries t WHERE t.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("finance_corrections",
            $"{Count} FROM ssf.finance_corrections t JOIN ssf.cost_entries ce ON ce.\"Id\" = t.cost_entry_id WHERE ce.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("day_ledgers", $"{Count} FROM ssf.day_ledgers t WHERE t.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("attachments", $"{Count} FROM ssf.attachments t WHERE t.farm_id = @farm AND @keep IS NOT NULL");
        yield return ("attendance_marks", $"{Count} FROM ssf.attendance_marks t WHERE t.farm_id = @farm AND t.\"Id\" <> @keep");
    }

    private static readonly Regex TimestampPattern = new(
        @"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?\+00", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static IEnumerable<DateTime> Timestamps(string row) =>
        TimestampPattern.Matches(row).Select(m => DateTime.SpecifyKind(
            DateTime.ParseExact(m.Value[..^3], ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm:ss.FFFFFFF"],
                CultureInfo.InvariantCulture, DateTimeStyles.None),
            DateTimeKind.Utc));

    /// <summary>Replaces the run instant's rendering (the sync stamp) with a placeholder.</summary>
    private static H.DbSnapshot Normalize(H.DbSnapshot snapshot, DateTime runUtc)
    {
        var stamp = runUtc.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "+00";
        return new H.DbSnapshot(snapshot.Tables.ToDictionary(
            kv => kv.Key,
            kv => kv.Value.Select(r => r.Replace(stamp, "<RUN>", StringComparison.Ordinal))
                .OrderBy(r => r, StringComparer.Ordinal).ToList(),
            StringComparer.Ordinal));
    }
}
