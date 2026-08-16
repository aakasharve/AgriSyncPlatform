// spec: dfes-companion-2026-07-11 (wave-1.4)
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
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.4) — AN OWNER MUST BE ABLE TO APPROVE A
/// MUKADAM'S LOG, AND NOBODY ELSE MAY.
///
/// <para><b>The blocker.</b> Wave-1.3 made an owner's OWN log self-attest to
/// <c>Verified</c>. The other half of the pilot — a foreman records the day, the owner
/// approves it — had no working path at all. <c>PushSyncBatchHandler</c> answered
/// <c>verify_log_v2</c> (the only mutation the approve button emits) with
/// <c>MUTATION_TYPE_UNIMPLEMENTED</c>, which the client's <c>RejectionPolicy.ts</c>
/// classifies PERMANENT, which parks the queue row in <c>REJECTED_USER_REVIEW</c> — a
/// state <c>pendingMutations.ts</c> does NOT shield — so the next pull overwrote the
/// farmer's local approval with the server's <c>Draft</c>. Every manual verification in
/// the pilot would have been silently undone.</para>
///
/// <para><b>Why the negatives are the important half.</b> Approval can be "made to work"
/// in a way that is far worse than the bug: widen the FSM, or trust the role the client
/// puts on the wire, and every mukadam can approve his own day. Then the ring reads 100%,
/// the inbox is empty, and nothing anybody sees is true. Proofs 2 and 3 push the IDENTICAL
/// mutation as a mukadam — over his own log and over another mukadam's — and require it to
/// be refused. Proof 4 pushes it as the owner while NAMING the mukadam in the payload, and
/// requires the ledger to record the owner.</para>
///
/// <para><b>Two hops, not a new edge.</b> <see cref="ShramSafal.Domain.Logs.VerificationStateMachine"/>
/// has no <c>Draft → Verified</c> edge for any role, and adding one is exactly the change
/// that would destroy the trust model. The reachable path is <c>Draft → Confirmed</c> (all
/// roles) then <c>Confirmed → Verified</c> (owner-tier only) — the same walk
/// <c>DailyLog.TrySelfVerifyAsCreator</c> makes for the self case. Proof 1 asserts BOTH
/// events, in order, so a future "simplification" that adds the shortcut edge fails here.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its OWN scratch database per
/// test, applies the full migration chain, drops it on dispose. If Postgres :5433 is
/// genuinely unreachable it skips and SAYS SO — a skipped proof is not a passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OwnerCanApproveAMukadamsLogRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("1d000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("1d000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("1d000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("1d000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("1d000000-0000-0000-0000-000000000005");

    /// <summary>The foreman who records the day. Trusted to record; never to approve.</summary>
    private static readonly Guid MukadamUserId = Guid.Parse("1d000000-0000-0000-0000-000000000006");

    /// <summary>A SECOND foreman. Proof 3: peers do not approve each other either.</summary>
    private static readonly Guid OtherMukadamUserId = Guid.Parse("1d000000-0000-0000-0000-000000000007");

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
        _scratchDbName = $"ssf_owner_approves_{Guid.NewGuid():N}";
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
            await SeedFarmMembershipAsync(raw, OtherMukadamUserId, "Mukadam");
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
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
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

    private bool SkippedForMissingPostgres()
    {
        if (!_skip)
        {
            return false;
        }

        output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        Assert.True(true, _skipReason);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — THE BLOCKER. The owner taps approve on the foreman's day and it
    // survives the round trip as a day that counts.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_owner_approving_a_mukadams_log_is_applied_and_comes_back_verified()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("1ddd1111-1111-1111-1111-111111111111");

        // The foreman records the day. It must land needing an owner.
        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-1",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 10)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        var beforeApproval = await PullDailyLogAsync(OwnerUserId, dailyLogId);
        beforeApproval.LastVerificationStatus.Should().Be("Draft",
            "the whole point of the approval flow is that a foreman's day starts unapproved");

        // The owner taps approve. THIS is the mutation that returned
        // MUTATION_TYPE_UNIMPLEMENTED before wave-1.4.
        var approve = await PushAsync(
            OwnerUserId, "Worker", // deliberately UNDER-stated: the wire must not be believed.
            "req-owner-approves-1",
            "verify_log_v2", ApprovePayload(dailyLogId, verifierUserIdInPayload: OwnerUserId));

        var approveResult = Assert.Single(approve.Value!.Results);
        output.WriteLine($"[EVIDENCE] approve mutation → status='{approveResult.Status}' " +
                         $"errorCode='{approveResult.ErrorCode}' message='{approveResult.ErrorMessage}'");

        approveResult.Status.Should().Be("applied",
            "an 'applied' result is what keeps the queue row out of REJECTED_USER_REVIEW — the state " +
            "pendingMutations.ts does not shield, and therefore the state in which the next pull silently " +
            "reverts the farmer's approval");

        // ── The pull. The half that used to undo everything. ──────────────────
        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === the foreman's log, after the owner approved it ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}'");
        foreach (var e in pulled.VerificationEvents)
        {
            output.WriteLine($"[EVIDENCE]   event status='{e.Status}' reason='{e.Reason}' by={e.VerifiedByUserId}");
        }

        pulled.LastVerificationStatus.Should().Be("Verified",
            "the owner vouched for the day; Draft is the bug and Confirmed is the trap (the ring counts neither)");

        pulled.VerificationEvents.Should().HaveCount(2,
            "the FSM has NO Draft->Verified edge for any role. The server must WALK Draft->Confirmed->Verified. " +
            "One event here would mean somebody added the shortcut edge, which lets every role self-approve");
        pulled.VerificationEvents.Select(e => e.Status).Should().ContainInOrder("confirmed", "verified");

        // The last two client hops, executed rather than asserted in prose.
        var localStatus = ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus);
        localStatus.Should().Be("VERIFIED");
        ClientRingContractMirror.TheRingCountsIt(localStatus).Should().BeTrue(
            "dayState.ts counts VERIFIED — this is what makes the approved day read as closed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — THE CHECK THAT MATTERS MOST. A mukadam cannot approve his OWN log.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_mukadam_cannot_approve_his_own_log()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ddd2222-2222-2222-2222-222222222222");

        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-2",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 11)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        // He claims to be the owner on the wire. Authority is not his to declare.
        var approve = await PushAsync(
            MukadamUserId, "PrimaryOwner",
            "req-mukadam-selfapproves",
            "verify_log_v2", ApprovePayload(dailyLogId, verifierUserIdInPayload: MukadamUserId));

        var result = Assert.Single(approve.Value!.Results);
        output.WriteLine($"[EVIDENCE] mukadam self-approve → status='{result.Status}' errorCode='{result.ErrorCode}'");

        result.Status.Should().Be("failed",
            "a foreman approving his own work is the single thing the approval model exists to prevent");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden",
            "the refusal must be a PERMANENT code (RejectionPolicy.ts normalizes the tail to FORBIDDEN) so the " +
            "device parks it for review instead of retrying it every 15 seconds forever");

        var pulled = await PullDailyLogAsync(MukadamUserId, dailyLogId);
        pulled.LastVerificationStatus.Should().Be("Draft",
            "his day must still be waiting for an owner");
        pulled.VerificationEvents.Should().BeEmpty(
            "a refused approval must leave NO trace of an approval — a Confirmed event here would be the server " +
            "half-crediting an act it just denied");

        ClientRingContractMirror.TheRingCountsIt(
            ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus)).Should().BeFalse();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — nor another mukadam's. Peers do not approve each other.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_mukadam_cannot_approve_another_mukadams_log()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ddd3333-3333-3333-3333-333333333333");

        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-3",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 12)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        var approve = await PushAsync(
            OtherMukadamUserId, "Mukadam",
            "req-peer-approves",
            "verify_log_v2", ApprovePayload(dailyLogId, verifierUserIdInPayload: OtherMukadamUserId));

        var result = Assert.Single(approve.Value!.Results);
        output.WriteLine($"[EVIDENCE] peer approve → status='{result.Status}' errorCode='{result.ErrorCode}'");

        result.Status.Should().Be("failed",
            "'a second pair of eyes' is not the rule — the rule is owner-tier eyes. Two foremen covering for " +
            "each other is the failure mode this farm hires an owner to prevent");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);
        pulled.LastVerificationStatus.Should().Be("Draft");
        pulled.VerificationEvents.Should().BeEmpty();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4 — the ledger records who actually acted, not who the payload named.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_approval_is_credited_to_the_authenticated_user_not_the_one_named_in_the_payload()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ddd4444-4444-4444-4444-444444444444");

        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-4",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 13)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        // The owner approves, but the payload names the MUKADAM as the verifier.
        var approve = await PushAsync(
            OwnerUserId, "PrimaryOwner",
            "req-owner-approves-spoofed-verifier",
            "verify_log_v2", ApprovePayload(dailyLogId, verifierUserIdInPayload: MukadamUserId));

        Assert.Single(approve.Value!.Results).Status.Should().Be("applied");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);
        pulled.LastVerificationStatus.Should().Be("Verified");
        pulled.VerificationEvents.Should().OnlyContain(e => e.VerifiedByUserId == OwnerUserId,
            "the payload said the mukadam approved it. The JWT said the owner did. A ledger that believes the " +
            "payload can be made to say anything, and 'who approved this day' is the only question it answers");

        output.WriteLine("[EVIDENCE] payload named " + MukadamUserId + "; ledger recorded " +
                         string.Join(", ", pulled.VerificationEvents.Select(e => e.VerifiedByUserId)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 5 — a payload that declares its own authority is refused outright.
    //
    // The client's VerifyLog.ts builds `callerRole` into the payload it enqueues.
    // The server must never see that as an input it could act on: the whole
    // mutation is rejected, loudly, rather than silently ignoring the field.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_payload_that_declares_its_own_authority_is_refused()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ddd5555-5555-5555-5555-555555555555");

        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-5",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 14)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        var payload = ApprovePayload(dailyLogId, verifierUserIdInPayload: OwnerUserId);
        payload["callerRole"] = "PrimaryOwner";

        var approve = await PushAsync(
            OwnerUserId, "PrimaryOwner", "req-owner-approves-with-role", "verify_log_v2", payload);

        var result = Assert.Single(approve.Value!.Results);
        output.WriteLine($"[EVIDENCE] payload carrying callerRole → status='{result.Status}' errorCode='{result.ErrorCode}'");

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload",
            "an unrecognised field must fail the mutation, not be quietly dropped: a client that believes it is " +
            "sending its own authority and gets back 'applied' has been told a lie");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 6 — the same two-hop walk carries a REJECTION, and a rejection
    // without a reason is refused.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_owner_can_send_a_mukadams_log_back_but_only_with_a_reason()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ddd6666-6666-6666-6666-666666666666");

        var created = await PushAsync(
            MukadamUserId, "Mukadam", "req-mukadam-log-6",
            "create_daily_log", CreateLogPayload(dailyLogId, MukadamUserId, new DateOnly(2026, 8, 15)));
        Assert.Single(created.Value!.Results).Status.Should().Be("applied");

        var noReason = ApprovePayload(dailyLogId, OwnerUserId);
        noReason["decision"] = "dispute";
        var refused = await PushAsync(OwnerUserId, "PrimaryOwner", "req-dispute-no-reason", "verify_log_v2", noReason);
        Assert.Single(refused.Value!.Results).Status.Should().Be("failed",
            "the machine must never invent a reason a human did not give — P4, no fabricated content");

        var withReason = ApprovePayload(dailyLogId, OwnerUserId);
        withReason["decision"] = "dispute";
        withReason["reason"] = "Sprayer was in the workshop all day.";
        var disputed = await PushAsync(OwnerUserId, "PrimaryOwner", "req-dispute-with-reason", "verify_log_v2", withReason);
        Assert.Single(disputed.Value!.Results).Status.Should().Be("applied");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);
        pulled.LastVerificationStatus.Should().Be("Disputed");
        pulled.VerificationEvents.Should().HaveCount(2,
            "Draft->Disputed is also a two-hop walk through Confirmed; no edge was added for this either");
        pulled.VerificationEvents.Last().Reason.Should().Be("Sprayer was in the workshop all day.");

        output.WriteLine($"[EVIDENCE] disputed log events: " +
                         string.Join(" -> ", pulled.VerificationEvents.Select(e => $"{e.Status}('{e.Reason}')")));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wire helpers — the canonical verify_log_v2 payload
    // (sync-contract/schemas/payloads/verify_log_v2.zod.ts).
    // ─────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> ApprovePayload(Guid dailyLogId, Guid verifierUserIdInPayload) =>
        new()
        {
            ["logId"] = dailyLogId,
            ["verifierUserId"] = verifierUserIdInPayload,
            ["decision"] = "verify",
            ["decidedAt"] = new DateTime(2026, 8, 16, 9, 0, 0, DateTimeKind.Utc).ToString("O"),
        };

    private static Dictionary<string, object?> CreateLogPayload(Guid dailyLogId, Guid operatorUserId, DateOnly logDate) =>
        new()
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmId,
            ["plotId"] = PlotId,
            ["cropCycleId"] = CropCycleId,
            ["operatorUserId"] = operatorUserId,
            ["logDate"] = logDate.ToString("yyyy-MM-dd"),
        };

    // ─────────────────────────────────────────────────────────────────────────
    // Drives the ACTUAL handlers under the production posture: /sync/push is
    // admin-elevated (TenantTransactionMiddleware skip-list) and establishes its
    // own farm GUC; /sync/pull runs USER-SCOPED (ADR 0019).
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        Guid actorUserId,
        string actorRole,
        string clientRequestId,
        string mutationType,
        Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: "device-owner-approves",
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.3.0");

        var result = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
        result.IsSuccess.Should().BeTrue("the /sync/push batch call itself must succeed: {0}",
            result.Error?.ToString() ?? "-");
        return result;
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid userId, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().SetUserScoped(userId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, userId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId,
            "the log must come back down on the next pull").Subject;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Provisioning evidence — a suite that reports Passed! in ~1s having created
    // ZERO databases has happened here before. Print what was actually built.
    // ─────────────────────────────────────────────────────────────────────────
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

        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        var isSuper = Convert.ToBoolean(await ScalarAsync(appCheck,
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
        isSuper.Should().BeFalse("the write path must not be a superuser-vacuous pass");
        output.WriteLine($"[PROVISIONING] handler role superuser_or_bypassrls = {isSuper} (expect False)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────

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

    /// <summary>
    /// <c>20260515090000_BootstrapDbRoles</c> grants <c>agrisync_app</c> privileges on the
    /// <c>ssf</c> schema ONLY; the pull path also reads <c>public.users</c>. Fixture gap,
    /// not a product one — see the same helper in
    /// <see cref="OwnerLogSurvivesSyncRoundTripRealPostgresTests"/>.
    /// </summary>
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
            VALUES (@id, 'Owner Approves Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
