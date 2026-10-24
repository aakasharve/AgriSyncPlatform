// spec: 2026-08-28-labour-v2-release-1 (Task 2b)
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-28-labour-v2-release-1 (Task 2b) — ONE ENGAGEMENT, ONE ROW, on the
/// MANUAL path, proved against a REAL database, in a test CI actually runs.
///
/// <para><b>The defect (Task 2, <c>cc818abe</c>).</b> The manual client builds both
/// labour arrays from ONE list: <c>buildManualDraft</c> sets
/// <c>draft.labour = log.labour</c> and <c>buildLabourPayloads</c> maps that same
/// <c>log.labour</c> onto the structured <c>labour[]</c>. So every hand-typed day with
/// labour arrived carrying the same engagement twice. <c>CreateDailyLogHandler</c>
/// staged the canonical Phase-1 row from <c>command.Labour</c>, and the manual derive
/// branch — which hardcoded <c>deriveLabour: true</c> — derived the draft's copy as
/// well. Two rows in <c>ssf.labour_assignments</c> for one morning's work.</para>
///
/// <para>The twin was worse than a duplicate. <c>ManualDraftNormalizer.LabourFields</c>
/// carries no <c>durationHours</c> at all, so the derived row could not structurally
/// hold the farmer's stated hours: it was minted with a server id and
/// <c>LabourTime.ServerAssumed()</c>'s EIGHT hours, sitting beside the SIX he had
/// actually typed, with no note. A fabricated number next to the real one (doctrine
/// P4), and indistinguishable to any reader who does not know which producer wrote
/// which (P8). Every production log has a NULL <c>SourceAiJobId</c>, so this is the
/// branch production actually takes — the guarded voice branch was the dead one.</para>
///
/// <para><b>Why this file exists at all, given Task 2 was already tested.</b> Task 2's
/// proof is <c>DerivedLabourIsSuppressedTests</c> (Domain, in-memory repository) — it
/// runs in CI but never touches a database. The one integration-level test that covers
/// this branch, <c>LedgerDerivationLabourTests</c>, is
/// <c>[Trait("Category","RequiresDocker")]</c>, and EVERY CI workflow filters it out
/// (<c>ci-gate.yml:74</c>, <c>dotnet-ci.yml:112</c>: <c>Category!=RequiresDocker</c>);
/// its own doc comment admits "No CI workflow runs it". And the real-Postgres file that
/// looks like it would cover this —
/// <c>LabourPhaseOneDurabilityRealPostgresTests</c> — stubs
/// <c>ILedgerDerivationService</c> with a fake that THROWS, so it never exercises real
/// derivation on the manual path at all. The highest-consequence behaviour in this
/// phase therefore had no continuously-running proof against an actual database. This
/// is that proof.</para>
///
/// <para><b><c>RequiresPostgres</c>, deliberately — never <c>RequiresDocker</c>.</b>
/// This category IS included by CI's filter and connects to the CI service container;
/// locally it is native Postgres on :5433 (this project does not use Docker for local
/// dev). Filing this proof under <c>RequiresDocker</c> would recreate the exact gap it
/// exists to close and would look like coverage while providing none. If Postgres is
/// unreachable,
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact]s report FAILED, never a
/// silent skip.</para>
///
/// <para><b>Every assertion is a query against persisted rows.</b> Nothing here asserts
/// on an in-memory return value or a mock's call count; the whole point is proving what
/// actually landed in <c>ssf.labour_assignments</c>. Each [Fact] creates its OWN scratch
/// database, applies the full migration chain and drops it on dispose — fixture,
/// connection and cleanup shape copied from
/// <c>LabourPhaseOneDurabilityRealPostgresTests</c> and
/// <c>LabourMoneyInvariantsRealPostgresTests</c>. The handler runs as the non-superuser
/// <c>agrisync_app</c> role under an ambient transaction with the tenant GUCs set, so
/// FORCE-RLS genuinely applies and <c>PersistSideCarAsync</c> takes its SAVEPOINT
/// branch, exactly as in production.</para>
///
/// <para><b>Failure was demonstrated, not assumed.</b> With Task 2's one-line change
/// reverted (<c>deriveLabour</c> → <c>deriveLabour: true</c> in
/// <c>LedgerDerivationService.DeriveFromManualDraftAsync</c>) all three facts here go
/// RED — the count reads 2, the surviving-row query finds two rows, and the scalpel
/// fact fails on the same count. Restored, all three are GREEN.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ManualDraftSingleLabourRowRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("2b000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerAccountId = Guid.Parse("2b000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerUserId = Guid.Parse("2b000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("2b000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("2b000000-0000-0000-0000-000000000005");

    /// <summary>
    /// The client owns this id. ONLY the Phase-1 writer can produce it — the derivation
    /// mints its own via <c>ids.New()</c>. This is what makes assertion 2 a statement
    /// about WHICH producer won, not merely about how many rows there are.
    /// </summary>
    private static readonly Guid ClientLabourRowId = Guid.Parse("2bbb1111-1111-1111-1111-111111111111");

    /// <summary>The hours the farmer actually typed. The server assumption is 8.</summary>
    private const decimal StatedDurationHours = 6m;

    /// <summary>Rides only on the structured item; the derived row has nowhere to carry it.</summary>
    private const string StatedNotes = "सकाळी लवकर सुरुवात";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        // Throws (never skips) when Postgres is unconfigured/unreachable — a proof that
        // silently no-ops is the defect class this whole release exists to remove.
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_manual_single_labour_{Guid.NewGuid():N}";
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
            await SeedFarmMembershipAsync(raw);
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

        // The REAL derivation service, the REAL richness derivation, the REAL id
        // generator and clock. A stub here would prove nothing: the whole gap this
        // file closes is that the existing real-Postgres suite replaces
        // ILedgerDerivationService with a fake that throws, so the manual derive
        // branch is never actually executed against a database anywhere in CI.
        // Doubles ONLY for the two collaborators orthogonal to this proof.
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<ILedgerDerivationService, LedgerDerivationService>();
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

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
    // 1 — THE CORE PROOF. One engagement is one row in the real table.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A manual-draft confirm carrying structured <c>labour[]</c> — the shape every
    /// hand-typed day with labour actually has on the wire — must leave EXACTLY ONE
    /// <c>ssf.labour_assignments</c> row for that log. Before Task 2 this read 2.
    /// </summary>
    [Fact]
    public async Task A_manual_confirm_carrying_both_structured_labour_and_a_draft_persists_exactly_one_row()
    {
        var logId = Guid.Parse("2bbb2222-2222-2222-2222-222222222222");

        var run = await RunHandlerAsync(logId, "req-2b-core-proof", labour: [StructuredLabour()], draft: DraftWithLabour());

        run.Exception.Should().BeNull("the handler must not throw on the ordinary manual path");
        run.Result!.IsSuccess.Should().BeTrue("the farmer's day must commit");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var logRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId));
        var labourRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId));

        logRows.Should().Be(1, "the log itself must be durable");
        labourRows.Should().Be(1,
            "one morning's work is ONE engagement. The client sends it in labour[] AND in "
            + "manualDraft.labour because both are built from the same log.labour, and the "
            + "manual derive branch must not record it a second time. This read 2 before Task 2.");

        output.WriteLine("[EVIDENCE] === 2b.1 core proof — manual draft + structured labour (real Npgsql) ===");
        output.WriteLine($"[EVIDENCE] daily_logs for log                   = {logRows} (expect 1)");
        output.WriteLine($"[EVIDENCE] labour_assignments for log           = {labourRows} (expect 1; pre-Task-2 = 2)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2 — THE SURVIVING ROW IS THE RIGHT ONE. Provenance over precision (P8).
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// A count-only assertion would pass with the DERIVED twin as the winner, so this
    /// pins the survivor by PRODUCER SIGNATURE. The Phase-1 writer uses the
    /// client-owned <c>LabourAssignmentId</c>, honours a stated duration as
    /// <c>Explicit</c> and carries <c>notes</c>; the derivation mints a fresh id, always
    /// stamps <c>ServerAssumed</c> (8h — <c>ManualDraftNormalizer.LabourFields</c> has
    /// no <c>durationHours</c> to read, so it could never hold the farmer's six) and has
    /// no notes field at all. This is the assertion that would have caught the original
    /// defect.
    /// </summary>
    [Fact]
    public async Task The_surviving_row_is_the_farmers_own_explicit_hours_not_a_server_assumed_twin()
    {
        var logId = Guid.Parse("2bbb3333-3333-3333-3333-333333333333");

        var run = await RunHandlerAsync(logId, "req-2b-which-row", labour: [StructuredLabour()], draft: DraftWithLabour());

        run.Exception.Should().BeNull();
        run.Result!.IsSuccess.Should().BeTrue();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var rows = await ReadLabourRowsAsync(read, logId);

        // Read EVERY row for the log, not SingleAsync — when the twin comes back this
        // must fail with both rows printed as evidence, not with an opaque
        // sequence-length error.
        foreach (var r in rows)
        {
            output.WriteLine($"[EVIDENCE] persisted labour row = {r}");
        }

        rows.Should().ContainSingle(
            "the derived twin must not exist alongside the canonical row");

        var row = rows[0];

        row.Id.Should().Be(ClientLabourRowId,
            "the client OWNS this row id and it is the row's retry identity. The derivation "
            + "mints its own via ids.New(), so a server-generated id here means the twin won "
            + "and the farmer's own record was replaced by an inferred one.");
        row.TimeBasis.Should().Be("Explicit",
            "he STATED six hours. P8 — a hand-typed figure must stay distinguishable from an "
            + "inferred one, forever; 'Assumed' here would be the server relabelling his own "
            + "statement as its guess.");
        row.DurationHours.Should().Be(StatedDurationHours,
            "P4 — the eight-hour server default is a number the farmer never said, and it must "
            + "not appear over a duration he stated outright");
        row.Notes.Should().Be(StatedNotes,
            "notes ride only on the structured item; the derived row has nowhere to carry it, "
            + "so a NULL here is itself proof the twin survived");

        // The twin's exact signature, named and excluded outright: no row for this log
        // may carry the eight-hour assumption.
        var assumedRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id AND time_basis = 'Assumed'",
            ("id", logId));
        assumedRows.Should().Be(0,
            "the fabricated eight-hour 'Assumed' row is the precise artefact Task 2 removed — "
            + "not one may survive for a day whose hours the farmer typed");

        output.WriteLine("[EVIDENCE] === 2b.2 which row survived (producer signature) ===");
        output.WriteLine($"[EVIDENCE] surviving id is client-owned        = {row.Id == ClientLabourRowId} (expect True)");
        output.WriteLine($"[EVIDENCE] time_basis / duration_hours         = {row.TimeBasis} / {row.DurationHours} (expect Explicit / {StatedDurationHours})");
        output.WriteLine($"[EVIDENCE] rows with time_basis='Assumed'      = {assumedRows} (expect 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3 — THE SCALPEL HELD. deriveLabour gates the labour branch and only it.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Suppression must be labour-shaped, never an off-switch for the side-car. If
    /// closing a duplicate silently cost the farmer the rest of his typed day —
    /// inputs, irrigation, machinery, observations — the fix would be a worse defect
    /// than the one it closed, and it would be invisible: <c>PersistSideCarAsync</c>'s
    /// isolation branches catch <c>Exception</c>, log a warning and return normally, and
    /// there is no backfill job or re-derive endpoint anywhere in this system.
    /// </summary>
    [Fact]
    public async Task Suppressing_the_derived_twin_leaves_the_rest_of_the_typed_day_deriving()
    {
        var logId = Guid.Parse("2bbb4444-4444-4444-4444-444444444444");

        var run = await RunHandlerAsync(logId, "req-2b-scalpel", labour: [StructuredLabour()], draft: DraftWithLabour());

        run.Exception.Should().BeNull();
        run.Result!.IsSuccess.Should().BeTrue();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var labourRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId));
        var farmOps = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE source_daily_log_id = @id", ("id", logId));
        var inputItems = await ScalarLongAsync(read, """
            SELECT COUNT(*)
            FROM ssf.application_input_items i
            JOIN ssf.farm_operations o ON o."Id" = i.operation_id
            WHERE o.source_daily_log_id = @id
            """, ("id", logId));
        var irrigation = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.irrigation_entries WHERE daily_log_id = @id", ("id", logId));
        var machinery = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.machinery_usages WHERE daily_log_id = @id", ("id", logId));
        var observations = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.observation_events WHERE daily_log_id = @id", ("id", logId));

        labourRows.Should().Be(1, "the labour branch — and only it — is suppressed");
        farmOps.Should().Be(1, "his application must still derive its FarmOperation");
        inputItems.Should().Be(1, "the product he applied must still derive");
        irrigation.Should().Be(1, "his irrigation must still derive");
        machinery.Should().Be(1, "his machine use must still derive");
        observations.Should().Be(1, "what he noticed must still derive");

        output.WriteLine("[EVIDENCE] === 2b.3 the scalpel held (labour branch only) ===");
        output.WriteLine($"[EVIDENCE] labour_assignments             = {labourRows} (expect 1)");
        output.WriteLine($"[EVIDENCE] farm_operations                = {farmOps} (expect 1)");
        output.WriteLine($"[EVIDENCE] application_input_items        = {inputItems} (expect 1)");
        output.WriteLine($"[EVIDENCE] irrigation_entries             = {irrigation} (expect 1)");
        output.WriteLine($"[EVIDENCE] machinery_usages               = {machinery} (expect 1)");
        output.WriteLine($"[EVIDENCE] observation_events             = {observations} (expect 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The wire shape, as the manual-entry screen actually builds it.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The structured item the client sends in <c>labour[]</c>. Same engagement as
    /// <see cref="DraftWithLabour"/>'s labour row, because on the real client both are
    /// projections of the same <c>log.labour</c> entry — that identity IS the defect.
    /// </summary>
    private static LabourItem StructuredLabour() => new(
        LabourAssignmentId: ClientLabourRowId,
        EngagementType: "HIRED",
        MaleCount: 2,
        FemaleCount: 3,
        WorkerCount: 5,
        WagePerPerson: 350m,
        Notes: StatedNotes,
        DurationHours: StatedDurationHours);

    /// <summary>
    /// The typed day as the manual-entry screen builds it — including the labour bucket,
    /// which <c>ManualDraftNormalizer</c> allow-lists and copies through verbatim. Note
    /// what it CANNOT carry: no <c>durationHours</c> is on
    /// <c>ManualDraftNormalizer.LabourFields</c>, so a row derived from this bucket
    /// could never hold the six hours above even in principle.
    /// </summary>
    private static ManualDraftItem DraftWithLabour() => new(
        Labour: Rows("""
        { "id": "lb-0", "type": "HIRED", "maleCount": 2, "femaleCount": 3, "count": 5, "rate": 350 }
        """),
        Inputs: Rows("""
        {
          "id": "in-0", "type": "fertilizer",
          "mix": [ { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" } ]
        }
        """),
        Irrigation: Rows("""
        { "id": "irr-0", "method": "drip", "source": "borewell", "durationHours": 2.5 }
        """),
        Observations: Rows("""
        { "id": "ob-0", "textRaw": "खोडांवरती काळा डाग दिसतोय", "noteType": "issue" }
        """),
        Machinery: Rows("""
        { "id": "mc-0", "type": "sprayer", "ownership": "owned", "hoursUsed": 3 }
        """));

    /// <summary>
    /// The draft buckets are typed <c>IReadOnlyList&lt;object&gt;</c> and
    /// <c>ManualDraftNormalizer</c> only reads elements that are object-kind
    /// <see cref="JsonElement"/>s — exactly what System.Text.Json materialises on the
    /// real sync path. Anything else is silently skipped, which would make this whole
    /// suite vacuous, so the rows are built as real JsonElements here too.
    /// </summary>
    private static IReadOnlyList<object> Rows(params string[] json)
    {
        var rows = new List<object>(json.Length);
        foreach (var j in json)
        {
            rows.Add(JsonDocument.Parse(j).RootElement.Clone());
        }

        return rows;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocation under the ambient-transaction (SAVEPOINT) posture,
    // as agrisync_app with the tenant GUCs set. Shape copied from
    // LabourPhaseOneDurabilityRealPostgresTests.RunHandlerAsync.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record HandlerOutcome(Result<DailyLogDto>? Result, Exception? Exception);

    private async Task<HandlerOutcome> RunHandlerAsync(
        Guid dailyLogId,
        string clientRequestId,
        IReadOnlyList<LabourItem>? labour,
        ManualDraftItem? draft)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");

        var handler = new CreateDailyLogHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<IEntitlementPolicy>(),
            sp.GetRequiredService<IAnalyticsWriter>(),
            sp.GetRequiredService<IAiJobRepository>(),
            sp.GetRequiredService<ILogger<CreateDailyLogHandler>>(),
            sp.GetRequiredService<ILedgerDerivationService>(),
            sp.GetRequiredService<IDailyRichnessDerivationService>(),
            ctx);

        var command = new CreateDailyLogCommand(
            FarmId: FarmId,
            PlotId: PlotId,
            CropCycleId: CropCycleId,
            RequestedByUserId: OwnerUserId,
            OperatorUserId: OwnerUserId,
            LogDate: new DateOnly(2026, 8, 11),
            Location: null,
            DeviceId: "device-2b-manual-draft",
            ClientRequestId: clientRequestId,
            DailyLogId: dailyLogId,
            ActorRole: "owner",
            // NULL — a true manual save. This is the branch EVERY production log takes:
            // SourceAiJobId is null on all of them, which is why the guarded voice branch
            // was dead code and the unguarded manual one ran every time.
            SourceAiJobId: null,
            ClientAppVersion: "1.2.3",
            Labour: labour,
            ManualDraft: draft);

        try
        {
            var result = await handler.HandleAsync(command);
            await tx.CommitAsync();
            return new HandlerOutcome(result, null);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            return new HandlerOutcome(null, ex);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record LabourRow(
        Guid Id, string EngagementType, int? WorkerCount, decimal DurationHours,
        string TimeBasis, string? Notes, decimal? WagePerPerson);

    private static async Task<IReadOnlyList<LabourRow>> ReadLabourRowsAsync(NpgsqlConnection db, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", engagement_type, worker_count, duration_hours, time_basis, notes, wage_per_person
            FROM ssf.labour_assignments
            WHERE daily_log_id = @id
            ORDER BY "Id"
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);

        var rows = new List<LabourRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new LabourRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetInt32(2),
                reader.GetDecimal(3),
                reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetDecimal(6)));
        }

        return rows;
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

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("name", "Manual-Draft Single-Labour-Row Proof Farm");
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, 'PrimaryOwner', NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("user", OwnerUserId);
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
        cmd.Parameters.AddWithValue("id", PlotId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", CropCycleId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("plot", PlotId);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
