// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;
using ShramSafal.Domain.Labour;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the prior state every reseed proof starts
/// from, built ONCE per test class into an <c>ssf_reseed_tpl_*</c> database and cloned per test
/// (<c>CREATE DATABASE … TEMPLATE …</c>), so each test gets a pristine copy without paying for the
/// migration chain again.
/// </summary>
/// <remarks>
/// <para>The template holds:</para>
/// <list type="bullet">
/// <item>the demo farm exactly as the v2 startup seeder leaves it (the v2 rows the reseed must
/// replace);</item>
/// <item>a <b>twin farm</b> — a full copy of the demo farm's content under fresh ids, with the SAME
/// owner login and the SAME name, plus its own labour layer (operator, engagement, attribution,
/// mark, corrections). It is the adversarial "other farm": a reseed that selected its farm by
/// owner or by name, or deleted seed rows by key instead of by farm, would touch it;</item>
/// <item>a <b>stranger farm</b> with a different owner and its own labour rows;</item>
/// <item>optionally, a NON-SEED field operator on the demo farm and his हजेरी mark, written through
/// the product handlers by the owner (what the founder adding a worker in the app produces).</item>
/// </list>
/// </remarks>
public sealed class PurveshDemoReseedTemplate
{
    /// <summary>When the owner adds the non-seed worker: fixed, and far from the real clock, like every run instant here.</summary>
    public static readonly DateTime NonSeedActionUtc = new(2026, 3, 7, 5, 0, 0, DateTimeKind.Utc);

    public string MaintenanceConn { get; private set; } = string.Empty;
    public string TemplateName { get; private set; } = string.Empty;
    public Guid OwnerUserId { get; private set; }
    public Guid TwinFarmId { get; private set; }
    public Guid StrangerFarmId { get; } = Guid.Parse("5e000000-0000-0000-0000-0000000000f1");
    public Guid StrangerOwnerId { get; } = Guid.Parse("5e000000-0000-0000-0000-0000000000e1");
    public Guid? NonSeedOperatorId { get; private set; }
    public Guid? NonSeedMarkId { get; private set; }
    public DateOnly NonSeedMarkDate { get; } = new(2026, 3, 6);

    public static async Task<PurveshDemoReseedTemplate> BuildAsync(bool withNonSeedWorker)
    {
        var t = new PurveshDemoReseedTemplate
        {
            MaintenanceConn = await PurveshDemoReseedHarness.MaintenanceConnectionAsync(),
            TemplateName = PurveshDemoReseedHarness.NewDatabaseName("tpl"),
        };

        try
        {
            await PurveshDemoReseedHarness.CreateDatabaseAsync(t.MaintenanceConn, t.TemplateName);
            var su = PurveshDemoReseedHarness.SuperuserConnFor(t.MaintenanceConn, t.TemplateName);
            await PurveshDemoReseedHarness.MigrateLikeProductionAsync(su);
            await PurveshDemoReseedHarness.GrantAppRoleAsync(su);
            await PurveshDemoReseedHarness.SeedV2DemoAsync(su);

            t.OwnerUserId = (Guid)(await PurveshDemoReseedHarness.ScalarAsync(su,
                "SELECT owner_user_id FROM ssf.farms WHERE \"Id\" = @f", ("f", PurveshDemoSeeder.DemoFarmId)))!;

            t.TwinFarmId = await CloneFarmAsync(su, PurveshDemoSeeder.DemoFarmId);
            await AddTwinLabourLayerAsync(su, t.TwinFarmId, t.OwnerUserId);
            await AddStrangerFarmAsync(su, t.StrangerFarmId, t.StrangerOwnerId);

            if (withNonSeedWorker)
            {
                var app = PurveshDemoReseedHarness.AppConnFor(su);
                await using var provider = PurveshDemoReseedHarness.BuildProvider(app, clockUtc: NonSeedActionUtc);
                var opId = Guid.NewGuid();
                var markId = Guid.NewGuid();
                await PurveshDemoReseedHarness.AsCallerAsync(provider, PurveshDemoSeeder.DemoFarmId, t.OwnerUserId, async sp =>
                {
                    var created = await sp.GetRequiredService<AgriSync.BuildingBlocks.Application.IHandler<CreateFieldOperatorCommand,
                            ShramSafal.Application.Contracts.Dtos.FieldOperatorDto>>()
                        .HandleAsync(new CreateFieldOperatorCommand(
                            new FarmId(PurveshDemoSeeder.DemoFarmId), "नवनाथ खरा कामगार", null,
                            new UserId(t.OwnerUserId), opId));
                    Assert.True(created.IsSuccess, "arrange: the owner adds a real worker in the app: " + created.Error);

                    var mark = await sp.GetRequiredService<RecordAttendanceMarkHandler>().HandleAsync(
                        new RecordAttendanceMarkCommand(markId, PurveshDemoSeeder.DemoFarmId, opId, t.NonSeedMarkDate,
                            DayMark.Full, null, null, null, null, t.OwnerUserId));
                    Assert.True(mark.IsSuccess && mark.Value!.Outcome == AttendanceDayOutcome.Recorded,
                        "arrange: the owner marks that worker present: " + mark.Error);
                    return true;
                });

                t.NonSeedOperatorId = opId;
                t.NonSeedMarkId = (Guid?)await PurveshDemoReseedHarness.ScalarAsync(su,
                    "SELECT \"Id\" FROM ssf.attendance_marks WHERE field_operator_id = @op", ("op", opId));
                Assert.NotNull(t.NonSeedMarkId);
            }

            NpgsqlConnection.ClearAllPools();
            return t;
        }
        catch
        {
            await PurveshDemoReseedHarness.DropDatabaseAsync(t.MaintenanceConn, t.TemplateName);
            throw;
        }
    }

    public Task DropAsync() => PurveshDemoReseedHarness.DropDatabaseAsync(MaintenanceConn, TemplateName);

    // ── the twin: the demo farm's content under fresh ids ───────────────────

    private static readonly string[] TwinTables =
    [
        "ssf.farms", "ssf.plots", "ssf.farm_memberships", "ssf.crop_cycles", "ssf.planned_activities",
        "ssf.daily_logs", "ssf.log_tasks", "ssf.verification_events", "ssf.cost_entries",
        "ssf.finance_corrections", "ssf.day_ledgers", "ssf.day_ledger_allocations", "ssf.attachments",
    ];

    private static readonly Regex Uuid = new(
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", RegexOptions.CultureInvariant);

    public static Guid TwinOf(Guid id) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes("reseed-test-twin:" + id.ToString("D"))));

    private static async Task<Guid> CloneFarmAsync(string su, Guid sourceFarmId)
    {
        var snapshot = await PurveshDemoReseedHarness.SnapshotAsync(su);
        var owned = await PurveshDemoReseedHarness.OwnedIdsAsync(su, sourceFarmId, snapshot);

        await using var db = new NpgsqlConnection(su);
        await db.OpenAsync();
        await using (var replica = db.CreateCommand())
        {
            // Superuser-only: a passive copy of already-consistent rows, inserted without FK ordering.
            replica.CommandText = "SET session_replication_role = replica";
            await replica.ExecuteNonQueryAsync();
        }

        var cloned = 0;
        foreach (var table in TwinTables)
        {
            var parts = table.Split('.');
            var rows = new List<string>();
            await using (var read = db.CreateCommand())
            {
                read.CommandText = $"SELECT to_jsonb(t)::text FROM \"{parts[0]}\".\"{parts[1]}\" t";
                await using var reader = await read.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    rows.Add(reader.GetString(0));
                }
            }

            foreach (var json in rows.Where(r => PurveshDemoReseedHarness.Mentions(r, owned)))
            {
                var mapped = Uuid.Replace(json, m =>
                {
                    var g = Guid.Parse(m.Value);
                    return owned.Contains(g) ? TwinOf(g).ToString("D") : m.Value;
                });
                var node = System.Text.Json.Nodes.JsonNode.Parse(mapped)!.AsObject();
                if (table == "ssf.farms")
                {
                    node["farm_code"] = null; // globally unique; the twin keeps the demo NAME on purpose
                }

                if (table == "ssf.daily_logs" && node["idempotency_key"]?.GetValue<string>() is { } key)
                {
                    node["idempotency_key"] = "twin:" + key; // globally unique index
                }

                await using var insert = db.CreateCommand();
                insert.CommandText =
                    $"INSERT INTO \"{parts[0]}\".\"{parts[1]}\" SELECT * FROM jsonb_populate_record(NULL::\"{parts[0]}\".\"{parts[1]}\", @j::jsonb)";
                insert.Parameters.AddWithValue("j", node.ToJsonString());
                await insert.ExecuteNonQueryAsync();
                cloned++;
            }
        }

        Assert.True(cloned > 300, $"arrange: the twin must be a substantial copy of the demo farm (cloned {cloned} rows)");
        return TwinOf(sourceFarmId);
    }

    private static async Task AddTwinLabourLayerAsync(string su, Guid twinFarmId, Guid ownerUserId)
    {
        var logId = (Guid)(await PurveshDemoReseedHarness.ScalarAsync(su,
            "SELECT \"Id\" FROM ssf.daily_logs WHERE farm_id = @f ORDER BY log_date DESC, \"Id\" LIMIT 1", ("f", twinFarmId)))!;
        var opId = Guid.Parse("7a000000-0000-0000-0000-0000000000a1");
        var assignmentId = Guid.Parse("7a000000-0000-0000-0000-0000000000b1");
        var markId = Guid.Parse("7a000000-0000-0000-0000-0000000000c1");
        await PurveshDemoReseedHarness.ExecAsync(su, """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@op, 'शंकर मुकादम', 'शंकर मुकादम', NULL, @farm, @owner, TIMESTAMPTZ '2026-01-02 05:00:00+00', TRUE);
            INSERT INTO ssf.labour_assignments
                ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json,
                 created_at_utc, duration_hours, time_basis, engaged_through_field_operator_id)
            VALUES (@la, @log, 'Hired', 6, 400, 2400, '[]'::jsonb, TIMESTAMPTZ '2026-01-03 05:00:00+00', 8, 'Assumed', @op);
            INSERT INTO ssf.field_operator_work_rows
                ("Id", field_operator_id, labour_assignment_id, farm_id, work_date, display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES ('7a000000-0000-0000-0000-0000000000d1', @op, @la, @farm, DATE '2026-01-03', 'शंकर मुकादम', @owner, TIMESTAMPTZ '2026-01-03 05:00:00+00');
            INSERT INTO ssf.attendance_marks
                ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark, hours_worked, extra_hours, hours_basis,
                 recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (@mark, @farm, @op, DATE '2026-01-03', 1, 0, NULL, NULL, 0, @owner,
                    TIMESTAMPTZ '2026-01-03 06:00:00+00', TIMESTAMPTZ '2026-01-03 06:00:00+00');
            INSERT INTO ssf.labour_corrections
                ("Id", labour_assignment_id, farm_id, changed_field, original_value, new_value, reason, corrected_by_user_id, corrected_at_utc)
            VALUES ('7a000000-0000-0000-0000-0000000000e1', @la, @farm, 'worker_count', '5', '6', 'twin', @owner, TIMESTAMPTZ '2026-01-04 05:00:00+00');
            INSERT INTO ssf.attendance_mark_corrections
                ("Id", attendance_mark_id, farm_id, changed_field, original_value, new_value, corrected_by_user_id, corrected_at_utc)
            VALUES ('7a000000-0000-0000-0000-0000000000f1', @mark, @farm, 'day_mark', 'Half', 'Full', @owner, TIMESTAMPTZ '2026-01-04 05:00:00+00');
            """,
            ("op", opId), ("la", assignmentId), ("log", logId), ("farm", twinFarmId), ("owner", ownerUserId), ("mark", markId));
    }

    private static async Task AddStrangerFarmAsync(string su, Guid farmId, Guid ownerId)
    {
        var plotId = Guid.Parse("5e000000-0000-0000-0000-0000000000a1");
        var cycleId = Guid.Parse("5e000000-0000-0000-0000-0000000000a2");
        var logId = Guid.Parse("5e000000-0000-0000-0000-0000000000b1");
        var laId = Guid.Parse("5e000000-0000-0000-0000-0000000000b2");
        var opId = Guid.Parse("5e000000-0000-0000-0000-0000000000c1");
        await PurveshDemoReseedHarness.ExecAsync(su, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@farm, 'Someone Else''s Farm', @owner, @owner, TIMESTAMPTZ '2025-11-01 05:00:00+00', TIMESTAMPTZ '2025-11-01 05:00:00+00', 3.0, 'Unchecked');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via, can_manage_labour_records)
            VALUES ('5e000000-0000-0000-0000-0000000000d1', @farm, @owner, 'PrimaryOwner', TIMESTAMPTZ '2025-11-01 05:00:00+00', TIMESTAMPTZ '2025-11-01 05:00:00+00', @owner, 3, 1, FALSE);
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot, @farm, 'Stranger Plot', 2.5, TIMESTAMPTZ '2025-11-01 05:00:00+00', TIMESTAMPTZ '2025-11-01 05:00:00+00');
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
            VALUES (@log, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @owner, DATE '2026-03-09', TIMESTAMPTZ '2026-03-09 05:00:00+00', 'voice', 'unknown', 'unknown');
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@op, 'गणपत', 'गणपत', NULL, @farm, @owner, TIMESTAMPTZ '2026-03-01 05:00:00+00', TRUE);
            INSERT INTO ssf.labour_assignments
                ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
            VALUES (@la, @log, 'Hired', 3, 350, NULL, '[]'::jsonb, TIMESTAMPTZ '2026-03-09 05:00:00+00', 8, 'Assumed');
            INSERT INTO ssf.field_operator_work_rows
                ("Id", field_operator_id, labour_assignment_id, farm_id, work_date, display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES ('5e000000-0000-0000-0000-0000000000c2', @op, @la, @farm, DATE '2026-03-09', 'गणपत', @owner, TIMESTAMPTZ '2026-03-09 05:00:00+00');
            INSERT INTO ssf.attendance_marks
                ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark, hours_worked, extra_hours, hours_basis,
                 recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES ('5e000000-0000-0000-0000-0000000000c3', @farm, @op, DATE '2026-03-09', 2, 0, NULL, NULL, 0, @owner,
                    TIMESTAMPTZ '2026-03-09 06:00:00+00', TIMESTAMPTZ '2026-03-09 06:00:00+00');
            INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                          created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
            VALUES ('5e000000-0000-0000-0000-0000000000e1', @farm, @plot, 'मजुरी', 1050, 'INR', DATE '2026-03-09', @owner,
                    TIMESTAMPTZ '2026-03-09 07:00:00+00', TIMESTAMPTZ '2026-03-09 07:00:00+00', 'manual', 'unknown', 'unknown', 'labour_misc');
            """,
            ("farm", farmId), ("owner", ownerId), ("plot", plotId), ("cycle", cycleId), ("log", logId), ("la", laId), ("op", opId));
    }
}

/// <summary>Class fixture: one template per test class, dropped when the class finishes.</summary>
public abstract class PurveshDemoReseedTemplateFixtureBase : IAsyncLifetime
{
    protected abstract bool WithNonSeedWorker { get; }

    public PurveshDemoReseedTemplate Template { get; private set; } = default!;

    public async Task InitializeAsync() => Template = await PurveshDemoReseedTemplate.BuildAsync(WithNonSeedWorker);

    public async Task DisposeAsync()
    {
        if (Template is not null)
        {
            await Template.DropAsync();
        }
    }
}

public sealed class PurveshDemoReseedTemplateFixture : PurveshDemoReseedTemplateFixtureBase
{
    protected override bool WithNonSeedWorker => true;
}

public sealed class PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture : PurveshDemoReseedTemplateFixtureBase
{
    protected override bool WithNonSeedWorker => false;
}

/// <summary>One test's private clone of the template. Dropped on dispose.</summary>
public sealed class PurveshDemoReseedScratch : IAsyncDisposable
{
    private readonly List<ServiceProvider> _providers = [];

    private PurveshDemoReseedScratch(PurveshDemoReseedTemplate template, string name)
    {
        Template = template;
        Name = name;
        SuperuserConn = PurveshDemoReseedHarness.SuperuserConnFor(template.MaintenanceConn, name);
        AppConn = PurveshDemoReseedHarness.AppConnFor(SuperuserConn);
    }

    public PurveshDemoReseedTemplate Template { get; }
    public string Name { get; }
    public string SuperuserConn { get; }
    public string AppConn { get; }

    public static async Task<PurveshDemoReseedScratch> CloneAsync(PurveshDemoReseedTemplate template)
    {
        var name = PurveshDemoReseedHarness.NewDatabaseName("t");
        NpgsqlConnection.ClearAllPools();
        await PurveshDemoReseedHarness.CreateDatabaseAsync(template.MaintenanceConn, name, template.TemplateName);
        return new PurveshDemoReseedScratch(template, name);
    }

    /// <summary>The production-shaped DI graph as <c>agrisync_app</c> (Production environment).</summary>
    public ServiceProvider AppProvider(DateTime? clockUtc = null, string environmentName = "Production")
    {
        var p = PurveshDemoReseedHarness.BuildProvider(AppConn, environmentName, clockUtc);
        _providers.Add(p);
        return p;
    }

    /// <summary>The same graph on the SUPERUSER connection (RLS bypassed).</summary>
    public ServiceProvider SuperuserProvider(DateTime? clockUtc = null, string environmentName = "Production")
    {
        var p = PurveshDemoReseedHarness.BuildProvider(SuperuserConn, environmentName, clockUtc);
        _providers.Add(p);
        return p;
    }

    public Task<PurveshDemoReseedHarness.DbSnapshot> SnapshotAsync() => PurveshDemoReseedHarness.SnapshotAsync(SuperuserConn);

    public async ValueTask DisposeAsync()
    {
        foreach (var p in _providers)
        {
            await p.DisposeAsync();
        }

        await PurveshDemoReseedHarness.DropDatabaseAsync(Template.MaintenanceConn, Name);
    }
}
