// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Labour V1 Task 12b.8 (spec 2026-07-13-labour-attendance-approval-design) —
/// <b>GATE B acceptance.</b> Doctrine P2: <i>record now, inspect later, correct,
/// trust the final record</i>; doctrine P3: <i>a correction is never a silent
/// mutation.</i>
///
/// <para><b>What only a real-Postgres suite can prove here.</b> Three of these
/// six facts are database facts, not handler facts: that the corrected value is
/// what a RELOAD returns (not merely what an in-memory entity holds); that the
/// history row is durable and carries who/when; and that a rejected correction
/// leaves the tables byte-for-byte unchanged even though
/// <c>TenantTransactionMiddleware</c> COMMITS whenever the pipeline returns
/// without throwing — a 403 body is not an exception, so "Forbidden writes
/// nothing" is a property of the handler's ordering, verified here against real
/// rows.</para>
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact]s report FAILED,
/// never a silent skip. The suite creates its OWN scratch database, applies the
/// full migration chain, and drops it on dispose; it never touches
/// <c>agrisync_dev</c> / <c>agrisync_dev_v2</c>. The handler runs as the
/// non-superuser <c>agrisync_app</c> role under an ambient transaction with the
/// tenant GUCs set, so FORCE-RLS and the new
/// <c>p_tenant_labour_corrections</c> WITH CHECK genuinely apply.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourCorrectionGateBRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Farm A — where the reviewer works.
    private static readonly Guid FarmA = Guid.Parse("cbcb1111-1111-1111-1111-111111111111");
    private static readonly Guid FarmAAccount = Guid.Parse("cbcb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserId = Guid.Parse("cbcb3333-3333-3333-3333-333333333333");
    private static readonly Guid MukadamUserId = Guid.Parse("cbcb4444-4444-4444-4444-444444444444");
    private static readonly Guid WorkerUserId = Guid.Parse("cbcb5555-5555-5555-5555-555555555555");
    private static readonly Guid PlotA = Guid.Parse("cbcb6666-6666-6666-6666-666666666666");
    private static readonly Guid CycleA = Guid.Parse("cbcb7777-7777-7777-7777-777777777777");

    // Farm B — a DIFFERENT farm the reviewer is ALSO a member of, so its rows
    // are genuinely readable through the permissive, OR-ed
    // p_user_select_labour_assignments policy. That is what makes the
    // cross-farm test a real test rather than a test of RLS visibility.
    private static readonly Guid FarmB = Guid.Parse("cbcb8888-8888-8888-8888-888888888888");
    private static readonly Guid FarmBAccount = Guid.Parse("cbcb9999-9999-9999-9999-999999999999");
    private static readonly Guid FarmBOwnerUserId = Guid.Parse("cbcbaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid PlotB = Guid.Parse("cbcbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CycleB = Guid.Parse("cbcbcccc-cccc-cccc-cccc-cccccccccccc");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_labour_correct_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            await SeedFarmAsync(raw, FarmA, OwnerUserId, FarmAAccount, "Gate B Farm A");
            await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
            await SeedCropCycleAsync(raw, CycleA, FarmA, PlotA);
            // status 3 = Active. Role strings match AppRole names.
            await SeedMembershipAsync(raw, FarmA, OwnerUserId, FarmAAccount, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmA, MukadamUserId, FarmAAccount, "Mukadam");
            await SeedMembershipAsync(raw, FarmA, WorkerUserId, FarmAAccount, "Worker");

            await SeedFarmAsync(raw, FarmB, FarmBOwnerUserId, FarmBAccount, "Gate B Farm B");
            await SeedPlotAsync(raw, PlotB, FarmB, "Plot B");
            await SeedCropCycleAsync(raw, CycleB, FarmB, PlotB);
            await SeedMembershipAsync(raw, FarmB, FarmBOwnerUserId, FarmBAccount, "PrimaryOwner");
            // The Mukadam is ALSO on Farm B — see the FarmB comment above.
            await SeedMembershipAsync(raw, FarmB, MukadamUserId, FarmBAccount, "Mukadam");
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. COUNT — record 8, correct to 6, reload -> 6; history still shows 8 -> 6,
    //    by whom, when. THIS test's history row is the Gate B evidence.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Count_corrected_from_eight_to_six_reloads_as_six_with_history_intact()
    {
        var (logId, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        var result = await RunAsync(FarmA, MukadamUserId, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(MukadamUserId),
            DeviceId: "device-gateb", ClientRequestId: "req-count-8-to-6",
            Reason: "मोजून पाहिलं — सहा होते",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: null, AttributionAdds: null, AttributionRemovals: null));

        result.IsSuccess.Should().BeTrue("an owner/Mukadam correction must be accepted");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var reloaded = await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId));
        Convert.ToInt32(reloaded).Should().Be(6,
            "a RELOAD must return the corrected value — every reader sees corrected truth without "
            + "knowing corrections exist");

        var history = await ReadHistoryAsync(read, assignmentId);
        history.Should().ContainSingle("one changed field means exactly one history row");

        var row = history[0];
        row.ChangedField.Should().Be("WorkerCount");
        row.OriginalValue.Should().Be("8");
        row.NewValue.Should().Be("6");
        row.CorrectedByUserId.Should().Be(MukadamUserId, "history must name WHO");
        row.CorrectedAtUtc.Should().BeAfter(DateTime.UnixEpoch, "history must record WHEN");
        row.FarmId.Should().Be(FarmA);
        row.Reason.Should().Be("मोजून पाहिलं — सहा होते");

        output.WriteLine("[EVIDENCE] === 12b.8/1 count 8 -> 6 (real Npgsql :5433, agrisync_app role) ===");
        output.WriteLine($"[EVIDENCE] ssf.labour_assignments.worker_count reloaded = {reloaded} (expect 6)");
        output.WriteLine("[EVIDENCE] ssf.labour_corrections row:");
        output.WriteLine($"[EVIDENCE]   {row}");
        output.WriteLine($"[EVIDENCE] daily_log = {logId}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ATTRIBUTION — बाळू attached, removed, गणेश added. गणेश is current, the
    //    record explains बाळू's removal, and WorkerCount is UNCHANGED.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Attribution_swap_leaves_worker_count_unchanged_and_explains_the_removal()
    {
        var (_, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var balu = Guid.NewGuid();
        var ganesh = Guid.NewGuid();

        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedFieldOperatorAsync(seed, balu, FarmA, "बाळू");
            await SeedFieldOperatorAsync(seed, ganesh, FarmA, "गणेश");
            await SeedWorkRowAsync(seed, Guid.NewGuid(), balu, assignmentId, FarmA, "बाळू");
        }

        var result = await RunAsync(FarmA, MukadamUserId, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(MukadamUserId),
            DeviceId: "device-gateb", ClientRequestId: "req-attribution-swap",
            Reason: "बाळू नव्हता, गणेश होता",
            Quantity: null, DurationHours: null,
            AttributionAdds: [ganesh], AttributionRemovals: [balu]));

        result.IsSuccess.Should().BeTrue();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var workerCount = Convert.ToInt32(await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)));
        workerCount.Should().Be(8,
            "attribution NEVER changes reported quantity (Constraint 3) — removing बाळू and adding "
            + "गणेश on an 8-worker engagement leaves it at 8");

        var live = await ReadAttributedOperatorsAsync(read, assignmentId);
        live.Should().BeEquivalentTo([ganesh], "गणेश is the current attribution; बाळू's row is gone");

        var history = await ReadHistoryAsync(read, assignmentId);
        history.Should().HaveCount(2, "one row for the removal, one for the addition");
        history.Should().Contain(h =>
            h.ChangedField == "Attribution" && h.OriginalValue == balu.ToString() && h.NewValue == null);
        history.Should().Contain(h =>
            h.ChangedField == "Attribution" && h.OriginalValue == null && h.NewValue == ganesh.ToString());

        output.WriteLine("[EVIDENCE] === 12b.8/2 attribution swap ===");
        output.WriteLine($"[EVIDENCE] worker_count after swap = {workerCount} (expect 8, UNCHANGED)");
        output.WriteLine($"[EVIDENCE] live attribution        = [{string.Join(", ", live)}] (expect गणेश {ganesh})");
        foreach (var h in history)
        {
            output.WriteLine($"[EVIDENCE]   {h}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. HOURS — 8 / Assumed -> reviewer enters 4 -> 4 / Explicit.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Stated_hours_move_the_engagement_from_eight_assumed_to_four_explicit()
    {
        var (_, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        var result = await RunAsync(FarmA, OwnerUserId, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(OwnerUserId),
            DeviceId: "device-gateb", ClientRequestId: "req-hours-4",
            Reason: null,
            Quantity: null, DurationHours: 4m,
            AttributionAdds: null, AttributionRemovals: null));

        result.IsSuccess.Should().BeTrue();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var hours = Convert.ToDecimal(await ScalarAsync(read,
            "SELECT duration_hours FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)));
        var basis = (string)(await ScalarAsync(read,
            "SELECT time_basis FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)))!;

        hours.Should().Be(4m);
        basis.Should().Be("Explicit", "hours never move without their basis — a stated duration is Explicit");

        var history = await ReadHistoryAsync(read, assignmentId);
        history.Should().ContainSingle();
        history[0].ChangedField.Should().Be("DurationHours");
        history[0].OriginalValue.Should().Be("8|Assumed");
        history[0].NewValue.Should().Be("4|Explicit");

        output.WriteLine("[EVIDENCE] === 12b.8/3 hours 8|Assumed -> 4|Explicit ===");
        output.WriteLine($"[EVIDENCE] duration_hours / time_basis = {hours} / {basis}");
        output.WriteLine($"[EVIDENCE]   {history[0]}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. RETRY — one logical correction, not two.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_retried_correction_yields_one_correction_not_two()
    {
        var (_, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        CorrectLabourCommand Build() => new(
            new FarmId(FarmA), assignmentId, new UserId(MukadamUserId),
            DeviceId: "device-retry", ClientRequestId: "req-retry-once",
            Reason: "retry proof",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: null, AttributionAdds: null, AttributionRemovals: null);

        var first = await RunAsync(FarmA, MukadamUserId, Build());
        var retry = await RunAsync(FarmA, MukadamUserId, Build());

        first.IsSuccess.Should().BeTrue();
        retry.IsSuccess.Should().BeTrue("a retry is a SUCCESS outcome, not an error");
        retry.Value!.AlreadyApplied.Should().BeTrue();
        retry.Value!.WorkerCount.Should().Be(6, "the replay reports the corrected truth");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var history = await ReadHistoryAsync(read, assignmentId);
        history.Should().ContainSingle(
            "one real review action must leave ONE labour_corrections row, however many times it is sent");

        var mutations = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.sync_mutations WHERE device_id = 'device-retry' AND client_request_id = 'req-retry-once'");
        mutations.Should().Be(1, "the dedupe row is the mechanism, and it is written exactly once");

        output.WriteLine("[EVIDENCE] === 12b.8/4 retry idempotency ===");
        output.WriteLine($"[EVIDENCE] labour_corrections rows      = {history.Count} (expect 1)");
        output.WriteLine($"[EVIDENCE] sync_mutations rows for key  = {mutations} (expect 1)");
        output.WriteLine($"[EVIDENCE] retry.AlreadyApplied         = {retry.Value!.AlreadyApplied} (expect True)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. AUTHORIZATION — a farm Worker is Forbidden, with ZERO mutation.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_unauthorised_farm_worker_is_Forbidden_and_writes_nothing()
    {
        var (_, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        var result = await RunAsync(FarmA, WorkerUserId, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(WorkerUserId),
            DeviceId: "device-worker", ClientRequestId: "req-worker-denied",
            Reason: "should never land",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: 4m, AttributionAdds: null, AttributionRemovals: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var workerCount = Convert.ToInt32(await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)));
        var hours = Convert.ToDecimal(await ScalarAsync(read,
            "SELECT duration_hours FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)));
        var history = await ReadHistoryAsync(read, assignmentId);
        var mutations = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.sync_mutations WHERE device_id = 'device-worker'");

        workerCount.Should().Be(8, "a Worker must not rewrite labour truth");
        hours.Should().Be(8m);
        history.Should().BeEmpty();
        mutations.Should().Be(0,
            "the ambient transaction COMMITS on a 403 (it is not an exception), so zero-mutation "
            + "must come from the handler validating before it stages anything");

        output.WriteLine("[EVIDENCE] === 12b.8/5 Worker denied ===");
        output.WriteLine($"[EVIDENCE] error                   = {result.Error.Code}");
        output.WriteLine($"[EVIDENCE] worker_count / hours    = {workerCount} / {hours} (expect 8 / 8)");
        output.WriteLine($"[EVIDENCE] labour_corrections rows = {history.Count} (expect 0)");
        output.WriteLine($"[EVIDENCE] sync_mutations rows     = {mutations} (expect 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CROSS-FARM — a Farm A reviewer correcting Farm B labour is Forbidden,
    //    with ZERO mutation. The row IS loadable (the caller is a member of both
    //    farms and p_user_select_labour_assignments is permissive) — so this
    //    tests the HANDLER's defence, not RLS visibility.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Correcting_another_farms_labour_is_Forbidden_and_writes_nothing()
    {
        var (_, farmBAssignmentId) = await PlantEngagementAsync(FarmB, PlotB, CycleB, workerCount: 8);

        var result = await RunAsync(FarmA, MukadamUserId, new CorrectLabourCommand(
            // The caller established FARM A for this request, but points at
            // Farm B's engagement.
            new FarmId(FarmA), farmBAssignmentId, new UserId(MukadamUserId),
            DeviceId: "device-crossfarm", ClientRequestId: "req-crossfarm-denied",
            Reason: "should never land",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: null, AttributionAdds: null, AttributionRemovals: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        result.Error.Code.Should().NotContain("NotFound",
            "a distinct NotFound would let a forged id from another farm probe existence");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var workerCount = Convert.ToInt32(await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", farmBAssignmentId)));
        var history = await ReadHistoryAsync(read, farmBAssignmentId);
        var mutations = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.sync_mutations WHERE device_id = 'device-crossfarm'");

        workerCount.Should().Be(8, "Farm B's record is untouched");
        history.Should().BeEmpty();
        mutations.Should().Be(0);

        output.WriteLine("[EVIDENCE] === 12b.8/6 cross-farm denied ===");
        output.WriteLine($"[EVIDENCE] error                       = {result.Error.Code}");
        output.WriteLine($"[EVIDENCE] Farm B worker_count         = {workerCount} (expect 8)");
        output.WriteLine($"[EVIDENCE] Farm B labour_corrections   = {history.Count} (expect 0)");
        output.WriteLine($"[EVIDENCE] sync_mutations rows         = {mutations} (expect 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocation under the ambient-transaction posture, as
    // agrisync_app with the tenant GUCs set — mirrors
    // LabourPhaseOneDurabilityRealPostgresTests.RunHandlerAsync. `farmScopeId`
    // is the farm ICallerFarmTenantScope would have established for the request,
    // which is NOT necessarily the farm the targeted rows belong to (test 6).
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<Result<CorrectLabourResult>> RunAsync(
        Guid farmScopeId, Guid callerUserId, CorrectLabourCommand command)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {callerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmScopeId.ToString()}, true)");

        var handler = new CorrectLabourHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<ISyncMutationStore>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<ILogger<CorrectLabourHandler>>());

        var result = await handler.HandleAsync(command);

        // The middleware commits whenever the pipeline returns without throwing
        // — including on a 403. Committing here too is what makes the
        // zero-mutation assertions in tests 5 and 6 meaningful rather than an
        // artefact of a rollback.
        await tx.CommitAsync();
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record HistoryRow(
        string ChangedField, string? OriginalValue, string? NewValue,
        string? Reason, Guid CorrectedByUserId, DateTime CorrectedAtUtc, Guid FarmId)
    {
        public override string ToString() =>
            $"changed_field='{ChangedField}' original_value={Quote(OriginalValue)} "
            + $"new_value={Quote(NewValue)} corrected_by_user_id={CorrectedByUserId} "
            + $"corrected_at_utc={CorrectedAtUtc:O} farm_id={FarmId} reason={Quote(Reason)}";

        private static string Quote(string? value) => value is null ? "NULL" : $"'{value}'";
    }

    private static async Task<List<HistoryRow>> ReadHistoryAsync(NpgsqlConnection db, Guid assignmentId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT changed_field, original_value, new_value, reason,
                   corrected_by_user_id, corrected_at_utc, farm_id
            FROM ssf.labour_corrections
            WHERE labour_assignment_id = @id
            ORDER BY corrected_at_utc, changed_field, new_value NULLS FIRST
            """;
        cmd.Parameters.AddWithValue("id", assignmentId);

        var rows = new List<HistoryRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new HistoryRow(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetGuid(4),
                reader.GetDateTime(5),
                reader.GetGuid(6)));
        }

        return rows;
    }

    private static async Task<List<Guid>> ReadAttributedOperatorsAsync(NpgsqlConnection db, Guid assignmentId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT field_operator_id FROM ssf.field_operator_work_rows WHERE labour_assignment_id = @id";
        cmd.Parameters.AddWithValue("id", assignmentId);

        var ids = new List<Guid>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    /// <summary>
    /// Plants a real DailyLog + LabourAssignment as the superuser (so the plant
    /// itself never depends on the code under test). Every engagement starts at
    /// <c>8 / Assumed</c> — the shape a farmer's "आज ८ मजूर होते" produces.
    /// </summary>
    private async Task<(Guid LogId, Guid AssignmentId)> PlantEngagementAsync(
        Guid farmId, Guid plotId, Guid cycleId, int workerCount)
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var log = db.CreateCommand())
        {
            log.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, DATE '2026-08-10', NOW(), 'manual', 'unknown', 'unknown');
                """;
            log.Parameters.AddWithValue("id", logId);
            log.Parameters.AddWithValue("fid", farmId);
            log.Parameters.AddWithValue("pid", plotId);
            log.Parameters.AddWithValue("cid", cycleId);
            log.Parameters.AddWithValue("uid", OwnerUserId);
            await log.ExecuteNonQueryAsync();
        }

        await using (var assignment = db.CreateCommand())
        {
            assignment.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES (@id, @dlid, 'Hired', @count, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            assignment.Parameters.AddWithValue("id", assignmentId);
            assignment.Parameters.AddWithValue("dlid", logId);
            assignment.Parameters.AddWithValue("count", workerCount);
            await assignment.ExecuteNonQueryAsync();
        }

        return (logId, assignmentId);
    }

    private static async Task SeedFieldOperatorAsync(
        NpgsqlConnection db, Guid id, Guid farmId, string displayName)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, @name, lower(@name), NULL, @fid, @uid, NOW(), TRUE);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", displayName);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("uid", OwnerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedWorkRowAsync(
        NpgsqlConnection db, Guid id, Guid operatorId, Guid assignmentId, Guid farmId, string nameAtAttach)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.field_operator_work_rows
                ("Id", field_operator_id, labour_assignment_id, farm_id, work_date, display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (@id, @opid, @laid, @fid, DATE '2026-08-10', @name, @uid, NOW());
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("opid", operatorId);
        cmd.Parameters.AddWithValue("laid", assignmentId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("name", nameAtAttach);
        cmd.Parameters.AddWithValue("uid", OwnerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
        => Convert.ToInt64(await ScalarAsync(db, sql, args));

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private static async Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farmId, Guid userId, Guid ownerAccountId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", plotId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("name", name);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }
}
