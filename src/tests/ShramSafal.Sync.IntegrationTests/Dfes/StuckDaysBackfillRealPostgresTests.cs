// spec: dfes-companion-2026-07-11 (wave-1.5)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — THE DAYS ALREADY STUCK.
///
/// <para><b>The measurement this suite was written to settle.</b> Wave 1.5 was planned as
/// "a one-time local re-derivation in the Dexie upgrade path". That plan predates wave 1.3,
/// which made the SERVER authoritative over verification.
/// <see cref="A_pre_fix_log_still_comes_back_Draft_with_no_verifier_so_a_device_only_backfill_is_futile"/>
/// exists to answer, in running code rather than in argument, what the server actually says
/// about a log recorded before that fix. It says <c>Draft</c>, with an EMPTY
/// <c>verificationEvents[]</c> — and <c>logsReconciler.ts:136-137</c> replaces the device's
/// whole <c>verification</c> object with the server's ("Verification is a server-side FSM;
/// the device never wins it"), <c>verifiedByOperatorId</c> included, which it reads from the
/// latest event (<c>:264</c>) and therefore sets to <c>undefined</c>. A Dexie backfill would
/// be erased by the next pull carrying that log, re-creating the blank-verifier defect at
/// the same instant. That proof is kept as a permanent regression guard, because the day it
/// starts failing is the day this whole repair could move back to the client.</para>
///
/// <para><b>What a "pre-fix log" is here.</b> Not a hand-written INSERT — a row built by the
/// REAL create path and then stripped of its verification events, which is exactly and only
/// what <c>DailyLog.Create</c> left behind before wave 1.3. Reconstructing it any other way
/// would risk proving something about a fixture instead of about a farmer's history.</para>
///
/// <para><b>The negative is the point, not the garnish.</b> A repair that closed every open
/// day would look like a triumph on the ring and would silently destroy the approval model:
/// a mukadam's work would be marked vouched-for by nobody.
/// <see cref="A_mukadams_pre_fix_day_is_left_alone_by_the_backfill"/> and
/// <see cref="A_day_a_human_deliberately_re_opened_is_left_alone_by_the_backfill"/> are the
/// two boundaries that make the fix safe to ship.</para>
///
/// <para><b>Order independence.</b> The backfill is global and idempotent, so every test
/// here seeds its OWN log inside its own body and asserts only about that log. Running the
/// repair in one test cannot change what another asserts.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its OWN scratch database,
/// applies the full migration chain, drops it on dispose. If Postgres :5433 is genuinely
/// unreachable it SKIPS and says so loudly — a skipped proof is not a passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class StuckDaysBackfillRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("15000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("15000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("15000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("15000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("15000000-0000-0000-0000-000000000005");

    /// <summary>The foreman. Recognised on the farm, trusted to record — not to approve.</summary>
    private static readonly Guid MukadamUserId = Guid.Parse("15000000-0000-0000-0000-000000000006");

    /// <summary>See the seeding call in <see cref="InitializeAsync"/> — keeps every pass non-empty.</summary>
    private static readonly Guid SentinelCandidateLogId = Guid.Parse("15aa9999-9999-9999-9999-999999999999");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();

        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_stuck_days_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await GrantNonSsfSchemasToAppRoleAsync(raw);
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw, OwnerUserId, "PrimaryOwner");
            await SeedFarmMembershipAsync(raw, MukadamUserId, "Mukadam");
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
                // The privileged migration role the admin factory opens the repair's
                // cross-tenant context on — the same posture every hosted service in this
                // codebase runs under, and the reason the repair can see farms it holds no
                // tenant claim for. It does NOT weaken these proofs: every assertion about
                // what the FARMER'S DEVICE ends up seeing is made through PullDailyLogAsync,
                // which runs user-scoped on _appConn with RLS fully in force.
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();

        // A PERMANENT CANDIDATE. Every test asserts that the pass it triggered actually
        // scanned something, so that a boundary is never proven against an empty scan. But
        // a pass's candidate set depends on what earlier tests already repaired, and xUnit
        // does not promise an order. This foreman-recorded day has no verification history
        // and never can acquire one without a human pressing approve, so it keeps the
        // candidate set non-empty for every pass, forever, no matter what ran first.
        await SeedPreFixLogAsync(
            MukadamUserId, "Mukadam", "req-permanent-candidate",
            SentinelCandidateLogId, new DateOnly(2026, 8, 20));
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (!_skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
        {
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
    }

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1 — THE MEASUREMENT. Answers, in running code, the question the plan
    // assumed rather than checked: what does the SERVER say about a day recorded
    // before wave 1.3? If this ever goes green saying "Verified", the client-only
    // route becomes viable again and this suite should be revisited.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_pre_fix_log_still_comes_back_Draft_with_no_verifier_so_a_device_only_backfill_is_futile()
    {
        SkipIfPostgresUnavailable();

        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("15aa1111-1111-1111-1111-111111111111");
        await SeedPreFixOwnerLogAsync(dailyLogId, "req-measure", new DateOnly(2026, 8, 1));

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[MEASUREMENT] === an owner's PRE-FIX day, as the server reports it ===");
        output.WriteLine($"[MEASUREMENT] lastVerificationStatus = '{pulled.LastVerificationStatus}'");
        output.WriteLine($"[MEASUREMENT] verificationEvents     = {pulled.VerificationEvents.Count}");

        pulled.LastVerificationStatus.Should().Be("Draft",
            "verification has no column — CurrentVerificationStatus folds the events and defaults to Draft — " +
            "so a log created before wave 1.3 is reported unapproved by the server on EVERY pull");

        pulled.VerificationEvents.Should().BeEmpty(
            "this is the whole finding: with no events there is no verifiedByUserId on the wire, so " +
            "logsReconciler.ts:264 writes verifiedByOperatorId = undefined over whatever the device had");

        // The two consequences, executed rather than asserted in prose.
        var localStatus = ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus);
        localStatus.Should().Be("DRAFT");
        ClientRingContractMirror.TheRingCountsIt(localStatus).Should().BeFalse(
            "this is the 70%-forever day the pilot farmer opens the app to");

        output.WriteLine(
            "[MEASUREMENT] CONCLUSION: the server's answer is Draft with no verifier, and logsReconciler.ts:136-137 " +
            "takes it verbatim over the device's own row. A Dexie-only backfill is overwritten on the next pull " +
            "that carries this log. The repair must be server-side.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE FIX — the same day, after the server-side repair.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task The_backfill_closes_an_owners_pre_fix_day_and_names_him_as_the_verifier()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("15aa2222-2222-2222-2222-222222222222");
        await SeedPreFixOwnerLogAsync(dailyLogId, "req-backfill-owner", new DateOnly(2026, 8, 2));

        var result = await RunBackfillAsync();
        result.Attested.Should().BeGreaterThan(0, "this farm has at least one stuck owner-recorded day");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === the same day, after the server-side repair ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}'");
        foreach (var e in pulled.VerificationEvents)
        {
            output.WriteLine($"[EVIDENCE]   event status='{e.Status}' reason='{e.Reason}' by={e.VerifiedByUserId}");
        }

        pulled.LastVerificationStatus.Should().Be("Verified",
            "the owner recorded the day AND holds the authority to vouch for it; Confirmed is the trap — " +
            "the ring counts neither Draft nor Confirmed");

        pulled.VerificationEvents.Should().HaveCount(2,
            "there is no Draft->Verified edge for any role, so the repair must WALK Draft->Confirmed->Verified " +
            "exactly as the live path does");
        pulled.VerificationEvents.Select(e => e.Status).Should().ContainInOrder("confirmed", "verified");

        // THE verifiedByOperatorId HALF. Without this the day closes but the attribution
        // reads blank at dayWorkSummary.ts:121 and LogAttribution.tsx:61-62.
        pulled.VerificationEvents.Should().OnlyContain(e => e.VerifiedByUserId == OwnerUserId,
            "the client reads verifiedByOperatorId off the latest verification event; a repair that fixed the " +
            "status but left no verifier would show the pilot a closed day approved by nobody");

        // REVERSIBILITY. A backfilled attestation must never be mistaken for a live one.
        pulled.VerificationEvents.Should().OnlyContain(
            e => e.Reason == DailyLog.BackfilledAttestationReason,
            "a bulk repair of history is a weaker claim than an attestation made at the moment of saving, and " +
            "'undo exactly what the backfill wrote' must stay a one-line predicate");
        pulled.VerificationEvents.Should().NotContain(e => e.Reason == DailyLog.SelfAttestationReason,
            "the create-time marker would make the reconstructed rows indistinguishable from real ones");

        var localStatus = ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus);
        localStatus.Should().Be("VERIFIED");
        ClientRingContractMirror.TheRingCountsIt(localStatus).Should().BeTrue(
            "this is the assertion that turns the pilot's stuck history from 70% into a closed day");

        // wave-1.3's I1 ruling: an attestation with no audit row can never be reconstructed later.
        var auditRows = await ReadBackfillAuditPayloadsAsync(dailyLogId);
        auditRows.Should().ContainSingle(
            "the server claimed authority over this farmer's day; that act must leave exactly one trace");
        auditRows[0].Should().Contain("\"backfilled\":true");
        auditRows[0].Should().Contain(DailyLog.BackfilledAttestationReason);
        auditRows[0].Should().Contain("\"role\":\"PrimaryOwner\"",
            "the audit row records the SERVER-DERIVED authority the attestation actually rested on");

        output.WriteLine($"[EVIDENCE] audit row = {auditRows[0]}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOUNDARY 1 — a foreman's stuck day must STAY stuck. Proving the negative.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_mukadams_pre_fix_day_is_left_alone_by_the_backfill()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("15aa3333-3333-3333-3333-333333333333");
        await SeedPreFixLogAsync(
            MukadamUserId, "PrimaryOwner", "req-backfill-mukadam", dailyLogId, new DateOnly(2026, 8, 3));

        await RunBackfillAsync();

        var pulled = await PullDailyLogAsync(MukadamUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === a foreman's pre-fix day, after the repair ran ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}' (expect Draft)");
        output.WriteLine($"[EVIDENCE] verificationEvents     = {pulled.VerificationEvents.Count} (expect 0)");

        pulled.LastVerificationStatus.Should().Be("Draft",
            "the repair attests only for a log's OWN creator, and only when THAT person holds owner authority. " +
            "Borrowing the farm owner's authority to bulk-close work somebody else recorded would look like " +
            "success and silently destroy the approval model");
        pulled.VerificationEvents.Should().BeEmpty(
            "an event here would be the server inventing an approval nobody gave");

        (await ReadBackfillAuditPayloadsAsync(dailyLogId)).Should().BeEmpty(
            "nothing happened to this log, so nothing may be recorded as having happened to it");

        var localStatus = ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus);
        ClientRingContractMirror.TheRingCountsIt(localStatus).Should().BeFalse(
            "this day must stay open until an owner actually approves it");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOUNDARY 2 — a day a HUMAN re-opened reads Draft too. It must not be
    // re-closed behind his back. This is the proof that separates the candidate
    // predicate ("no verification history at all") from the naive one
    // ("status reads Draft"), which would have stamped over a deliberate act.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_day_a_human_deliberately_re_opened_is_left_alone_by_the_backfill()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("15aa4444-4444-4444-4444-444444444444");

        // Real create path: the owner's log self-attests, landing on Verified with 2 events.
        var push = await RunSyncPushAsync(OwnerUserId, "PrimaryOwner", "req-reopened", dailyLogId, new DateOnly(2026, 8, 4));
        Assert.Single(push.Value!.Results).Status.Should().Be("applied");

        // Then a human re-opens it — exactly what DailyLog.Edit writes.
        await InsertVerificationEventAsync(dailyLogId, "Draft", "Edited", OwnerUserId, DateTime.UtcNow.AddMinutes(5));

        var beforeStatus = (await PullDailyLogAsync(OwnerUserId, dailyLogId)).LastVerificationStatus;
        beforeStatus.Should().Be("Draft", "the re-opening is what the farmer asked for");

        await RunBackfillAsync();

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === a day the owner deliberately re-opened, after the repair ran ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}' (expect Draft)");
        output.WriteLine($"[EVIDENCE] verificationEvents     = {pulled.VerificationEvents.Count} (expect 3)");

        pulled.LastVerificationStatus.Should().Be("Draft",
            "'reads Draft' is ambiguous — it covers a day nobody ever assessed AND a day somebody re-opened on " +
            "purpose. The repair keys on having NO verification history at all, which can only mean the former");
        pulled.VerificationEvents.Should().HaveCount(3,
            "the two original attestations plus the re-opening; the repair added nothing");
        pulled.VerificationEvents.Should().NotContain(e => e.Reason == DailyLog.BackfilledAttestationReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IDEMPOTENCY — the repair runs at every startup. It must be a no-op after
    // the first, with no marker table to drift out of sync with reality.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Running_the_backfill_twice_does_not_stack_a_second_attestation()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("15aa5555-5555-5555-5555-555555555555");
        await SeedPreFixOwnerLogAsync(dailyLogId, "req-backfill-twice", new DateOnly(2026, 8, 5));

        await RunBackfillAsync();
        var second = await RunBackfillAsync();

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine($"[EVIDENCE] second pass: scanned={second.Scanned} attested={second.Attested}");
        output.WriteLine($"[EVIDENCE] events after two passes = {pulled.VerificationEvents.Count} (expect 2)");

        pulled.VerificationEvents.Should().HaveCount(2,
            "a log the repair has attested to now HAS verification history, so it can never be a candidate " +
            "again — that is what makes this idempotent without a marker row");
        pulled.LastVerificationStatus.Should().Be("Verified");

        (await ReadBackfillAuditPayloadsAsync(dailyLogId)).Should().ContainSingle(
            "one act, one audit row — a second row would claim the server attested twice");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a log EXACTLY as it existed before wave 1.3: created by the real handler, then
    /// stripped of the verification events that wave 1.3 added. Hand-writing the row instead
    /// would risk proving something about a fixture rather than about a farmer's history.
    /// </summary>
    private async Task SeedPreFixOwnerLogAsync(Guid dailyLogId, string clientRequestId, DateOnly logDate)
        => await SeedPreFixLogAsync(OwnerUserId, "PrimaryOwner", clientRequestId, dailyLogId, logDate);

    private async Task SeedPreFixLogAsync(
        Guid operatorUserId, string actorRole, string clientRequestId, Guid dailyLogId, DateOnly logDate)
    {
        var push = await RunSyncPushAsync(operatorUserId, actorRole, clientRequestId, dailyLogId, logDate);
        push.IsSuccess.Should().BeTrue("the fixture's own create must succeed");
        Assert.Single(push.Value!.Results).Status.Should().Be("applied");

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = "DELETE FROM ssf.verification_events WHERE daily_log_id = @id";
        cmd.Parameters.AddWithValue("id", dailyLogId);
        await cmd.ExecuteNonQueryAsync();

        // Also clear the create-time audit rows, so an assertion about what the BACKFILL
        // recorded can never be satisfied by a row the create path left behind.
        await using var audit = raw.CreateCommand();
        audit.CommandText =
            "DELETE FROM ssf.audit_events WHERE entity_id = @id AND action = 'VerificationChanged'";
        audit.Parameters.AddWithValue("id", dailyLogId);
        await audit.ExecuteNonQueryAsync();
    }

    private async Task InsertVerificationEventAsync(
        Guid dailyLogId, string status, string reason, Guid byUserId, DateTime occurredAtUtc)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, reason, verified_by_user_id, occurred_at_utc)
            VALUES (@id, @log, @status, @reason, @by, @at);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("log", dailyLogId);
        cmd.Parameters.AddWithValue("status", status);
        cmd.Parameters.AddWithValue("reason", reason);
        cmd.Parameters.AddWithValue("by", byUserId);
        cmd.Parameters.AddWithValue("at", occurredAtUtc);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Drives the REAL production entry point — the same
    /// <see cref="OwnerAttestationBackfillRunner"/> the startup hosted service resolves,
    /// which opens (and audits) its own admin cross-tenant context.
    ///
    /// <para>Every caller asserts <c>Scanned &gt; 0</c>. That guard is not decoration: the
    /// first version of this repair elevated <c>TenantContext</c> instead of using the admin
    /// factory, RLS handed it zero rows, and BOTH negative proofs below passed while
    /// examining nothing at all. A boundary proven against an empty scan proves nothing.</para>
    /// </summary>
    private async Task<BackfillOwnerAttestationsResult> RunBackfillAsync()
    {
        await using var scope = _rootProvider!.CreateAsyncScope();

        var result = await scope.ServiceProvider
            .GetRequiredService<OwnerAttestationBackfillRunner>()
            .RunPassAsync(batchSize: 500, CancellationToken.None);

        result.Scanned.Should().BeGreaterThan(0,
            "the repair must actually have LOOKED at this farm's history — a pass that scanned " +
            "nothing would make every assertion in this suite vacuous");
        return result;
    }

    private async Task<List<string>> ReadBackfillAuditPayloadsAsync(Guid dailyLogId)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            SELECT payload FROM ssf.audit_events
            WHERE entity_id = @id AND action = 'VerificationChanged' AND payload LIKE '%backfilled%'
            ORDER BY occurred_at_utc;
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);

        var payloads = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            payloads.Add(reader.GetString(0));
        }
        return payloads;
    }

    private async Task WriteProvisioningEvidenceAsync()
    {
        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var tables = Convert.ToInt64(await ScalarAsync(scratch,
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ssf'"));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created    = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] ssf tables after migrations = {tables} (0 would mean no chain ran)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        tables.Should().BeGreaterThan(10, "the migration chain must genuinely have been applied");
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        Guid actorUserId, string actorRole, string clientRequestId, Guid dailyLogId, DateOnly logDate)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmId,
            ["plotId"] = PlotId,
            ["cropCycleId"] = CropCycleId,
            ["operatorUserId"] = actorUserId,
            ["logDate"] = logDate.ToString("yyyy-MM-dd"),
        };

        var command = new PushSyncBatchCommand(
            DeviceId: "device-stuck-days",
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.5.0");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid userId, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // ADR 0019 — GET /sync/pull runs user-scoped, exactly as the endpoint does.
        sp.GetRequiredService<TenantContext>().SetUserScoped(userId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, userId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId,
            "the log must come back down on the next pull").Subject;
    }

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

    /// <summary>See the twin helper in OwnerLogSurvivesSyncRoundTripRealPostgresTests —
    /// the migration chain grants only the ssf schema; the pull also reads public.users.</summary>
    private static async Task GrantNonSsfSchemasToAppRoleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'Stuck Days Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>status 3 = <c>MembershipStatus.Active</c>.</summary>
    private static async Task SeedFarmMembershipAsync(NpgsqlConnection db, Guid userId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
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
