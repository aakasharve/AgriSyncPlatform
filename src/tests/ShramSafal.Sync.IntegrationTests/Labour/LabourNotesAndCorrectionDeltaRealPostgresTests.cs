// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// LABOUR PHASE 2, Phase 3 — the DATABASE-shaped half of labour read-back:
/// migration ③ (<c>ssf.labour_assignments.notes</c>, founder decision O-3) and
/// the delta trap that makes a correction reachable.
/// </summary>
/// <remarks>
/// <para><b>What only real Postgres can prove here.</b> That the new column
/// actually exists after the whole migration chain and holds the farmer's words
/// through a RELOAD, not merely in a tracked entity. That the migration's
/// <c>Down()</c> genuinely refuses rather than merely being written to look like
/// it does — it is EXECUTED here, on both branches. And that a correction moves
/// <c>ssf.daily_logs.modified_at_utc</c> in the row itself, which is the only
/// thing <c>/sync/pull</c>'s delta can see.</para>
///
/// <para>The wire shape of the read-back is proven separately, over real HTTP, in
/// <c>LabourReadBackPullTests</c>.</para>
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact]s report FAILED, never
/// a silent skip. Every fact creates its OWN scratch <c>ssf_labour_notes_*</c>
/// database, applies the full chain, and drops it on dispose; it never touches
/// <c>agrisync_dev</c> / <c>agrisync_dev_v2</c>, and no test here runs
/// <c>dotnet ef database update</c>. The handlers run as the non-superuser
/// <c>agrisync_app</c> role with the tenant GUCs set, so FORCE-RLS genuinely
/// applies.</para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourNotesAndCorrectionDeltaRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    /// <summary>The migration immediately BEFORE ③ — the rollback target.</summary>
    private const string MigrationBeforeNotes = "20260812122505_AddDailyLogPlotIdsAndScope";

    private static readonly Guid FarmGuid = Guid.Parse("bbbb1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountId = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserId = Guid.Parse("bbbb3333-3333-3333-3333-333333333333");
    private static readonly Guid PlotGuid = Guid.Parse("bbbb4444-4444-4444-4444-444444444444");
    private static readonly Guid CycleGuid = Guid.Parse("bbbb5555-5555-5555-5555-555555555555");

    private const string FarmersNote = "बाळू लवकर गेला, अर्धाच दिवस";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_labour_notes_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw);
            await SeedMembershipAsync(raw, OwnerUserId, "PrimaryOwner");
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
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
        services.AddScoped<ILedgerDerivationService, LedgerDerivationService>();
        services.AddSingleton<IEntitlementPolicy, AllowAllPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalytics>();

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
    // 0. E3 — prove the role, do not assume it.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_connection_used_by_this_suite_is_neither_superuser_nor_bypassrls()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();

        var currentUser = (string)(await ScalarAsync(app, "SELECT current_user"))!;
        var canBypass = (bool)(await ScalarAsync(app,
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"))!;

        currentUser.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse(
            "every write in this class goes through FORCE-RLS tables — a session that can bypass row-level "
            + "security would make those writes prove nothing");

        output.WriteLine("[EVIDENCE] === P3/0 E3 role guard ===");
        output.WriteLine($"[EVIDENCE] current_user             = {currentUser} (expect {AppRoleUser})");
        output.WriteLine($"[EVIDENCE] rolsuper OR rolbypassrls = {canBypass} (expect False)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Migration ③ — the column exists after the WHOLE chain.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Migration_three_adds_a_nullable_text_notes_column_and_nothing_else()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var dataType = (string?)await ScalarAsync(db, """
            SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
            """);
        var isNullable = (string?)await ScalarAsync(db, """
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
            """);
        var columnDefault = await ScalarAsync(db, """
            SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
            """);

        dataType.Should().Be("text", "the farmer's own words must not be silently truncated by a length cap");
        isNullable.Should().Be("YES", "no note is a normal, complete record — an optional field never rejects one");
        columnDefault.Should().BeOneOf(null, DBNull.Value,
            "a default would fabricate a note on every pre-existing row; NULL is the honest 'we know of none'");

        // Purely additive: the two policies on this table are EXISTS-joins to
        // ssf.daily_logs and name no column of it, so the migration must not have
        // touched them.
        var policies = await ListAsync(db,
            "SELECT policyname FROM pg_policies WHERE schemaname = 'ssf' AND tablename = 'labour_assignments' ORDER BY policyname");
        policies.Should().BeEquivalentTo(
            ["p_tenant_labour_assignments", "p_user_select_labour_assignments"],
            "migration ③ adds a column and changes no security posture at all");

        output.WriteLine("[EVIDENCE] === P3/1 migration ③ Up (full IntegrationMigrationChain on a scratch DB) ===");
        output.WriteLine($"[EVIDENCE] scratch database                        = {_scratchDbName}");
        output.WriteLine($"[EVIDENCE] labour_assignments.notes data_type      = {dataType} (expect text)");
        output.WriteLine($"[EVIDENCE] labour_assignments.notes is_nullable    = {isNullable} (expect YES)");
        output.WriteLine($"[EVIDENCE] labour_assignments.notes column_default = {columnDefault ?? "NULL"} (expect NULL)");
        output.WriteLine($"[EVIDENCE] policies on labour_assignments          = [{string.Join(", ", policies)}]");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Migration ③ Down() — EXECUTED, both branches.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The rollback is REFUSED once a farmer has written a note. Executed, not
    /// merely written: this rolls the real migrator back to the migration before
    /// ③ and asserts that Postgres raised, the column is still there, and the note
    /// is still in it. Same standard of care as migration ①, whose <c>Down()</c>
    /// refuses rather than fabricating a plot id.
    /// </summary>
    [Fact]
    public async Task Rolling_migration_three_back_REFUSES_while_a_farmers_note_exists()
    {
        var (_, assignmentId) = await PlantEngagementAsync(workerCount: 8, notes: FarmersNote);

        var refusal = await Record.ExceptionAsync(() => MigrateToAsync(MigrationBeforeNotes));

        refusal.Should().NotBeNull(
            "dropping the column deletes every note permanently — there is no backfill job, no re-derive endpoint "
            + "and no second copy anywhere in this system, so a silent DROP is data destruction");
        var pg = FindPostgres(refusal!);
        pg.Should().NotBeNull();
        pg!.SqlState.Should().Be("P0001", "the refusal is an explicit RAISE, not an incidental constraint error");
        pg.MessageText.Should().Contain("Cannot roll back AddLabourAssignmentNotes");
        pg.MessageText.Should().Contain("1 ssf.labour_assignments row(s)",
            "the refusal names HOW MANY notes are at stake so the decision can actually be made");

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var columnStillThere = (long)(await ScalarAsync(db, """
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
            """))!;
        var noteStillThere = (string?)await ScalarAsync(db,
            "SELECT notes FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId));

        columnStillThere.Should().Be(1, "a refused rollback must leave the schema untouched, not half-applied");
        noteStillThere.Should().Be(FarmersNote, "and the farmer's words untouched");

        output.WriteLine("[EVIDENCE] === P3/2a migration ③ Down() EXECUTED — refusal branch ===");
        output.WriteLine($"[EVIDENCE] SQLSTATE            = {pg.SqlState} (expect P0001)");
        output.WriteLine($"[EVIDENCE] message             = {pg.MessageText}");
        output.WriteLine($"[EVIDENCE] notes column exists = {columnStillThere} (expect 1)");
        output.WriteLine($"[EVIDENCE] note preserved      = '{noteStillThere}'");
    }

    /// <summary>
    /// With no note anywhere the rollback is genuinely lossless, so it PROCEEDS —
    /// and re-applying is clean. A guard that refused unconditionally would be a
    /// broken rollback dressed as care.
    /// </summary>
    [Fact]
    public async Task Rolling_migration_three_back_SUCCEEDS_when_no_note_was_ever_written()
    {
        await PlantEngagementAsync(workerCount: 8, notes: null);

        await MigrateToAsync(MigrationBeforeNotes);

        await using (var afterDown = new NpgsqlConnection(_superuserConn))
        {
            await afterDown.OpenAsync();
            var columns = (long)(await ScalarAsync(afterDown, """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
                """))!;
            var engagements = (long)(await ScalarAsync(afterDown, "SELECT count(*) FROM ssf.labour_assignments"))!;

            columns.Should().Be(0, "nothing was at stake, so the column goes cleanly");
            engagements.Should().Be(1, "and the engagement itself survives — only the empty column was removed");

            output.WriteLine("[EVIDENCE] === P3/2b migration ③ Down() EXECUTED — clean branch ===");
            output.WriteLine($"[EVIDENCE] notes column after Down = {columns} (expect 0)");
            output.WriteLine($"[EVIDENCE] engagements after Down  = {engagements} (expect 1)");
        }

        // Re-apply: Up must be replayable on a database that has already carried it.
        await MigrateToAsync(targetMigration: null);

        await using var afterUp = new NpgsqlConnection(_superuserConn);
        await afterUp.OpenAsync();
        var restored = (long)(await ScalarAsync(afterUp, """
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'labour_assignments' AND column_name = 'notes'
            """))!;
        restored.Should().Be(1, "down-then-up must land back on the head, or the rollback is a one-way door");

        output.WriteLine($"[EVIDENCE] notes column after re-Up   = {restored} (expect 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. O-3 — the note survives capture -> write -> read-back.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The whole O-3 journey through the REAL write path, as <c>agrisync_app</c>:
    /// the note rides <c>LabourItem.Notes</c> (where the client has always put it),
    /// reaches the column, and comes back on the read model after a RELOAD — not
    /// from the entity the handler happened to be holding.
    /// </summary>
    [Fact]
    public async Task The_farmers_note_reaches_the_column_and_the_read_model_after_a_reload()
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        var result = await CreateLogWithLabourAsync(logId, assignmentId, FarmersNote);
        result.IsSuccess.Should().BeTrue();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var stored = (string?)await ScalarAsync(db,
            "SELECT notes FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId));
        stored.Should().Be(FarmersNote,
            "before migration ③ this note reached the server on every save and was DISCARDED for want of a column");

        // Read-back through the SAME repository port the pull projection uses, on
        // a FRESH scope and under the real tenant GUCs — a reload subject to
        // FORCE-RLS as agrisync_app, not the entity the handler was holding.
        // (The wire shape that this engagement then becomes is asserted over real
        // HTTP in LabourReadBackPullTests; ShramSafal.Application's ToDto is
        // internal and visible only to ShramSafal.Domain.Tests.)
        var reloaded = await ReadEngagementsAsync(logId);
        var engagement = reloaded.Should().ContainSingle().Subject;

        engagement.Notes.Should().Be(FarmersNote, "a reload is the only proof that matters for durability");
        engagement.Id.Should().Be(assignmentId, "the client-minted id survives as the server primary key");
        engagement.WorkerCount.Should().Be(8);
        engagement.TimeBasis.Should().Be(ShramSafal.Domain.Farms.LabourTimeBasis.Assumed,
            "no duration was stated, and silence is labelled honestly");

        output.WriteLine("[EVIDENCE] === P3/3 O-3 note round trip (real Npgsql :5433, agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] ssf.labour_assignments.notes = '{stored}'");
        output.WriteLine($"[EVIDENCE] reloaded entity .Notes       = '{engagement.Notes}'");
    }

    [Fact]
    public async Task A_labour_entry_with_no_note_stores_null_not_an_empty_string()
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        // "   " is what an empty note box actually sends.
        (await CreateLogWithLabourAsync(logId, assignmentId, "   ")).IsSuccess.Should().BeTrue();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var isNull = (bool)(await ScalarAsync(db,
            "SELECT notes IS NULL FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)))!;

        isNull.Should().BeTrue(
            "an empty string is indistinguishable from a farmer who typed a space, and every reader would then "
            + "render a note that does not exist");

        output.WriteLine("[EVIDENCE] === P3/3b blank note ===");
        output.WriteLine($"[EVIDENCE] notes IS NULL = {isNull} (expect True)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. THE DELTA TRAP, in the database.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <c>ssf.labour_assignments</c> has no <c>modified_at_utc</c> and a correction
    /// mutates the row in place, while <c>/sync/pull</c> is a delta on
    /// <c>ssf.daily_logs.modified_at_utc</c>. Asserted on the RELOADED row: an
    /// in-memory bump that never reached the database would look identical in a
    /// handler test and would still leave the second device on 8 forever.
    /// </summary>
    [Fact]
    public async Task A_correction_moves_the_parent_logs_modified_at_utc_in_the_database()
    {
        var (logId, assignmentId) = await PlantEngagementAsync(workerCount: 8, notes: null);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var before = (DateTime)(await ScalarAsync(read,
            "SELECT modified_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)))!;

        var result = await CorrectAsync(new CorrectLabourCommand(
            new FarmId(FarmGuid), assignmentId, new UserId(OwnerUserId),
            DeviceId: "device-p3", ClientRequestId: "req-p3-8-to-6",
            Reason: "मोजून पाहिलं",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: null, AttributionAdds: null, AttributionRemovals: null));
        result.IsSuccess.Should().BeTrue();

        var after = (DateTime)(await ScalarAsync(read,
            "SELECT modified_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)))!;
        var workerCount = Convert.ToInt32(await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentId)));

        workerCount.Should().Be(6, "the correction itself landed");
        after.Should().BeAfter(before,
            "a delta pull selects logs whose modified_at_utc is past the device's cursor — without this the "
            + "correction persists perfectly, answers 200, and NEVER reaches the farmer's other phone");

        output.WriteLine("[EVIDENCE] === P3/4 delta trap (reloaded row) ===");
        output.WriteLine($"[EVIDENCE] daily_logs.modified_at_utc before = {before:O}");
        output.WriteLine($"[EVIDENCE] daily_logs.modified_at_utc after  = {after:O}");
        output.WriteLine($"[EVIDENCE] labour_assignments.worker_count   = {workerCount} (expect 6)");
    }

    [Fact]
    public async Task A_rejected_correction_leaves_the_parent_logs_clock_untouched()
    {
        var (logId, assignmentId) = await PlantEngagementAsync(workerCount: 8, notes: null);
        var strangerUserId = Guid.NewGuid();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        await SeedMembershipAsync(read, strangerUserId, "Worker");
        var before = (DateTime)(await ScalarAsync(read,
            "SELECT modified_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)))!;

        var result = await CorrectAsync(new CorrectLabourCommand(
            new FarmId(FarmGuid), assignmentId, new UserId(strangerUserId),
            DeviceId: "device-p3-denied", ClientRequestId: "req-p3-denied",
            Reason: "should never land",
            Quantity: new LabourQuantityCorrection(6, null, null),
            DurationHours: null, AttributionAdds: null, AttributionRemovals: null),
            callerUserId: strangerUserId);

        result.IsFailure.Should().BeTrue();

        var after = (DateTime)(await ScalarAsync(read,
            "SELECT modified_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)))!;
        after.Should().Be(before,
            "TenantTransactionMiddleware COMMITS on a 403 — it is not an exception — so a bump staged before the "
            + "authorization check would durably advertise a change that was refused");

        output.WriteLine("[EVIDENCE] === P3/4b rejected correction ===");
        output.WriteLine($"[EVIDENCE] modified_at_utc before/after = {before:O} / {after:O} (expect equal)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocations, as agrisync_app with the tenant GUCs set.
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> CreateLogWithLabourAsync(
        Guid logId, Guid assignmentId, string? notes)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx, OwnerUserId);

        var handler = new CreateDailyLogHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<IEntitlementPolicy>(),
            sp.GetRequiredService<IAnalyticsWriter>(),
            sp.GetRequiredService<IAiJobRepository>(),
            sp.GetRequiredService<ILogger<CreateDailyLogHandler>>(),
            sp.GetRequiredService<ILedgerDerivationService>(),
            // Deliberately inert HERE, and only here. This suite's subject is a
            // migration (ssf.labour_assignments.notes) and a modified_at_utc delta;
            // the daily-richness recompute writes to an unrelated table inside the
            // best-effort side-car, whose failures the handler swallows by contract
            // — so a real one could never make any assertion below fail, while it
            // WOULD add derived rows to the same scratch DB the "and nothing else"
            // migration facts inspect. The durability proof for the real recompute
            // lives in LabourPhaseOneDurabilityRealPostgresTests, which injects it.
            new InertDailyRichnessDerivation(),
            ctx);

        var result = await handler.HandleAsync(new CreateDailyLogCommand(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CycleGuid,
            RequestedByUserId: OwnerUserId,
            OperatorUserId: OwnerUserId,
            LogDate: new DateOnly(2026, 8, 13),
            Location: null,
            DeviceId: "device-p3",
            ClientRequestId: $"req-create-{logId:N}",
            DailyLogId: logId,
            ActorRole: "owner",
            Labour: [new LabourItem(
                LabourAssignmentId: assignmentId,
                EngagementType: "hired_daily",
                WorkerCount: 8,
                Task: "छाटणी",
                Notes: notes)]));

        await tx.CommitAsync();
        return result;
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<CorrectLabourResult>> CorrectAsync(
        CorrectLabourCommand command, Guid? callerUserId = null)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx, callerUserId ?? OwnerUserId);

        var handler = new CorrectLabourHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<ISyncMutationStore>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<ILogger<CorrectLabourHandler>>());

        var result = await handler.HandleAsync(command);

        // The middleware commits whenever the pipeline returns without throwing,
        // INCLUDING on a 403 — which is what makes the untouched-clock assertion a
        // property of the handler's ordering rather than an artefact of a rollback.
        await tx.CommitAsync();
        return result;
    }

    /// <summary>
    /// The pull's labour read, run under the same posture the pull runs in: the
    /// non-superuser <c>agrisync_app</c> role, inside an ambient transaction with
    /// the tenant GUCs set, so <c>p_user_select_labour_assignments</c> genuinely
    /// evaluates.
    /// </summary>
    private async Task<IReadOnlyList<ShramSafal.Domain.Farms.LabourAssignment>> ReadEngagementsAsync(Guid logId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx, OwnerUserId);

        var engagements = await sp.GetRequiredService<IShramSafalRepository>()
            .GetLabourAssignmentsForDailyLogsAsync([logId]);

        await tx.CommitAsync();
        return engagements;
    }

    private static async Task SetGucsAsync(ShramSafalDbContext ctx, Guid userId)
    {
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmGuid.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");
    }

    /// <summary>
    /// Runs the REAL migrator against the scratch database on the SUPERUSER
    /// connection — the same posture <c>IntegrationMigrationChain</c> uses.
    /// <c>null</c> means "up to the head". This is what makes <c>Down()</c>
    /// executed rather than merely written.
    /// </summary>
    private async Task MigrateToAsync(string? targetMigration)
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_superuserConn)
            .Options;

        await using var ctx = new ShramSafalDbContext(options);
        await ctx.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixtures + helpers.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Plants a log + engagement as the SUPERUSER, so a fixture never depends on
    /// the code under test.
    /// </summary>
    private async Task<(Guid LogId, Guid AssignmentId)> PlantEngagementAsync(int workerCount, string? notes)
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var log = db.CreateCommand())
        {
            log.CommandText = """
                INSERT INTO ssf.daily_logs
                    ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date,
                     created_at_utc, modified_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, DATE '2026-08-13',
                        NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour', 'manual', 'unknown', 'unknown');
                """;
            log.Parameters.AddWithValue("id", logId);
            log.Parameters.AddWithValue("fid", FarmGuid);
            log.Parameters.AddWithValue("pid", PlotGuid);
            log.Parameters.AddWithValue("cid", CycleGuid);
            log.Parameters.AddWithValue("uid", OwnerUserId);
            await log.ExecuteNonQueryAsync();
        }

        await using (var assignment = db.CreateCommand())
        {
            assignment.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, worker_names_json,
                     created_at_utc, duration_hours, time_basis, notes)
                VALUES (@id, @dlid, 'Hired', @count, '[]'::jsonb, NOW(), 8, 'Assumed', @notes);
                """;
            assignment.Parameters.AddWithValue("id", assignmentId);
            assignment.Parameters.AddWithValue("dlid", logId);
            assignment.Parameters.AddWithValue("count", workerCount);
            assignment.Parameters.AddWithValue("notes", (object?)notes ?? DBNull.Value);
            await assignment.ExecuteNonQueryAsync();
        }

        return (logId, assignmentId);
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'Phase 3 Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmGuid);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(NpgsqlConnection db, Guid userId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmGuid);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, 'Plot A', 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", PlotGuid);
        cmd.Parameters.AddWithValue("farm", FarmGuid);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", CycleGuid);
        cmd.Parameters.AddWithValue("farm", FarmGuid);
        cmd.Parameters.AddWithValue("plot", PlotGuid);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var value2 = await cmd.ExecuteScalarAsync();
        return value2 is DBNull ? null : value2;
    }

    private static async Task<List<string>> ListAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;

        var values = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            values.Add(reader.GetString(0));
        }

        return values;
    }

    private static PostgresException? FindPostgres(Exception ex)
    {
        for (Exception? current = ex; current is not null; current = current.InnerException)
        {
            if (current is PostgresException pg)
            {
                return pg;
            }
        }

        return null;
    }

    private sealed class AllowAllPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    /// <summary>
    /// Records nothing and asserts nothing — see the comment at the call site for
    /// why the richness recompute is out of scope for THIS suite. It is deliberately
    /// NOT a spy: no fact here interrogates it, and a double no one interrogates must
    /// not be dressed up as evidence.
    /// </summary>
    private sealed class InertDailyRichnessDerivation : IDailyRichnessDerivationService
    {
        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.CompletedTask;
    }
}
