// spec: 2026-07-13-labour-attendance-approval-design
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
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Tests;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening) — the
/// machine-gate proof that EVERY mutation dispatched by
/// <see cref="PushSyncBatchHandler"/> that reads or writes RLS-protected
/// tables now establishes tenant scope on the admin-elevated
/// <c>/sync/push</c> path, against REAL Npgsql on native Postgres :5433,
/// connected as the non-superuser <c>agrisync_app</c> role so FORCE-RLS
/// genuinely applies.
///
/// <para>
/// <b>Why this test and not the InMemory sync-endpoint suites.</b> Every
/// existing sync-push unit/integration test drives an EF
/// <c>UseInMemoryDatabase</c> harness (RLS-free) — <c>CallerFarmTenantScope</c>
/// (and the analogous logic refactored into
/// <c>PushSyncBatchHandler.EstablishFarmScopeForDerivationAsync</c> /
/// <c>EstablishFarmScopeForOwnedEntityAsync</c>) short-circuits entirely on a
/// non-relational provider, so an InMemory test proves NOTHING about whether
/// the real GUC-setting path works. This suite mirrors
/// <c>SyncPushLedgerDerivationRealPostgresTests</c>: own scratch DB, full
/// migration chain (including this session's new
/// <c>20260719074300_AddUserScopedJobCardComplianceTestReadPolicies</c>),
/// real production DI graph, connected as <c>agrisync_app</c>.
/// </para>
///
/// <para>
/// <b>Two properties proven per fixed mutation family.</b>
/// <list type="number">
/// <item><b>Succeeds with scope.</b> A genuine farm member (owner or an
/// active member) can now perform the mutation end-to-end — this is the
/// regression proof: every one of these mutations returned a fail-closed
/// error under prod's FORCE-RLS before this fix, because /sync/push sets no
/// tenant GUC and the naked membership/entity reads matched zero rows.</item>
/// <item><b>Fails closed without scope.</b> A caller who is NOT a member of
/// the target farm (a genuine owner of a DIFFERENT farm, or a user with no
/// farm membership at all) is still rejected — proving the fix did not
/// loosen isolation while closing the availability bug. One negative test
/// per DISTINCT scope-establishment shape is sufficient: every mutation
/// sharing a shape calls the exact same helper, so the negative proof
/// generalises across the whole shape.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Fresh scratch DB per [Fact].</b> xUnit instantiates a new instance of
/// this class (and re-runs <see cref="IAsyncLifetime.InitializeAsync"/>) per
/// test method by default (no <c>IClassFixture</c> here), so every Fact gets
/// its own independently seeded database — no cross-test ordering
/// dependency, matching the sibling RealPostgres suites.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class SyncPushTenantScopeRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    // agrisync_app is created by migration 20260515090000_BootstrapDbRoles with
    // this literal local-dev password; roles are cluster-global so it already
    // exists on the :5433 cluster.
    private const string AppRoleUser = "agrisync_app";
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Farm A — the genuine-member farm every positive proof targets.
    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid WorkerA = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");

    // Farm B — OwnerB is a genuine owner of a DIFFERENT farm; used as the
    // "non-member" attacker in every fail-closed proof (proves the isolation
    // gate, not just presence-of-any-membership).
    private static readonly Guid FarmB = Guid.Parse("bbbb2221-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountB = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("bbbb2223-2222-2222-2222-222222222222");

    // A user who belongs to NO farm at all — the set_price_config negative case.
    private static readonly Guid NoFarmUser = Guid.Parse("cccc3333-3333-3333-3333-333333333333");

    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _appConn = string.Empty;
    private string _adminConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        // Throws (does not skip) if Postgres is unconfigured/unreachable — see
        // RequiresPostgresConnection's doc comment for the 2026-07-19
        // CI-truthfulness fix this enforces.
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_tenantscope_proof_{Guid.NewGuid():N}";
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
        _adminConn = baseConn;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Seed the common baseline as superuser (bypasses RLS): Farm A (Owner A
        // + an active Worker member) and Farm B (Owner B only). NoFarmUser is
        // deliberately NOT seeded anywhere — "belongs to no farm" IS the fixture.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            await SeedFarmAsync(raw, FarmA, OwnerA, OwnerAccountA, "Tenant-Scope Farm A");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmA, OwnerA, OwnerAccountA, "PrimaryOwner", status: 3);
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmA, WorkerA, OwnerAccountA, "Worker", status: 3);

            await SeedFarmAsync(raw, FarmB, OwnerB, OwnerAccountB, "Tenant-Scope Farm B");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmB, OwnerB, OwnerAccountB, "PrimaryOwner", status: 3);
        }

        // Production DI graph (AddShramSafalApi → AddShramSafalInfrastructure)
        // connected as agrisync_app so FORCE-RLS is real.
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

        if (!string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
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

    // ═════════════════════════════════════════════════════════════════════
    // POSITIVE PROOF 1 — the full happy-path chain, as Farm A's genuine
    // owner + an assigned worker. Covers 16 of the 20 in-scope mutations in
    // one realistic, dependency-ordered sequence (create_daily_log included
    // as an additional Fix-1 regression guard alongside the dedicated
    // SyncPushLedgerDerivationRealPostgresTests suite).
    // ═════════════════════════════════════════════════════════════════════
    [Fact]
    public async Task SyncPush_FullMutationChain_SucceedsForGenuineFarmMember()
    {
        AssertNonSuperuserAppRole();

        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();
        var costEntryId1 = Guid.NewGuid();
        var costEntryId2 = Guid.NewGuid();
        var attachmentId = Guid.NewGuid();

        // 1. create_plot — known-farmId shape (EstablishFarmScopeForDerivationAsync).
        var plotResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-plot", "create_plot", new()
        {
            ["plotId"] = plotId,
            ["farmId"] = FarmA,
            ["name"] = "Plot A",
            ["areaInAcres"] = 2.5m,
        });
        AssertApplied(plotResult, "create_plot");

        // 2. create_crop_cycle — known-farmId shape.
        var cycleResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-cycle", "create_crop_cycle", new()
        {
            ["cropCycleId"] = cropCycleId,
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropName"] = "Grapes",
            ["stage"] = "Vegetative",
            ["startDate"] = new DateOnly(2026, 1, 1).ToString("yyyy-MM-dd"),
        });
        AssertApplied(cycleResult, "create_crop_cycle");

        // 3. create_daily_log — Fix 1's own mutation; additional regression guard.
        var logResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-log", "create_daily_log", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropCycleId"] = cropCycleId,
            ["logDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
        });
        AssertApplied(logResult, "create_daily_log");

        // 4. add_log_task — unknown-farmId-via-daily_log shape.
        var taskResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-task", "add_log_task", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["activityType"] = "Harvesting",
        });
        AssertApplied(taskResult, "add_log_task");

        // 5. jobcard.create — known-farmId shape (payload carries farmId).
        // NOTE: JobCardCreatePayload has no client-suppliable id (unlike
        // plots/cycles/logs/cost-entries/attachments) — CreateJobCardHandler
        // always server-generates via idGenerator.New(). Read the real id
        // back from the applied result's Data (a CreateJobCardResult — the
        // in-process handler return value, not a JSON string, since this test
        // calls PushSyncBatchHandler directly).
        var jobCardCreateResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-jc-create", "jobcard.create", new()
        {
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropCycleId"] = cropCycleId,
            ["plannedDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
            ["lineItems"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["activityType"] = "Harvesting",
                    ["expectedHours"] = 4m,
                    ["ratePerHourAmount"] = 50m,
                    ["ratePerHourCurrencyCode"] = "INR",
                },
            },
        });
        AssertApplied(jobCardCreateResult, "jobcard.create");
        var jobCardId = ((ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult)jobCardCreateResult.Data!).JobCardId;

        // 6. jobcard.assign — unknown-farmId-via-job_card shape (needs this
        // session's new user-scoped read policy on ssf.job_cards).
        var jobCardAssignResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-jc-assign", "jobcard.assign", new()
        {
            ["jobCardId"] = jobCardId,
            ["workerUserId"] = WorkerA,
        });
        AssertApplied(jobCardAssignResult, "jobcard.assign");

        // 7. jobcard.start — same shape; caller is the assigned worker.
        var jobCardStartResult = await RunSyncPushAsync(WorkerA, "worker", "d-A", "req-jc-start", "jobcard.start", new()
        {
            ["jobCardId"] = jobCardId,
        });
        AssertApplied(jobCardStartResult, "jobcard.start");

        // 8. jobcard.complete — same shape; links the job card to DailyLogA
        // (shares farm+plot+ActivityType "Harvesting" with the job card).
        var jobCardCompleteResult = await RunSyncPushAsync(WorkerA, "worker", "d-A", "req-jc-complete", "jobcard.complete", new()
        {
            ["jobCardId"] = jobCardId,
            ["dailyLogId"] = dailyLogId,
        });
        AssertApplied(jobCardCompleteResult, "jobcard.complete");

        // ══ 8b. FOUNDER RULING 2026-08-27 (spec: 2026-08-25-prod-cutover-waves) ══
        //
        //   AN OWNER'S OWN LOG IS VERIFIED ON SAVE. HE WROTE IT; IT IS HIS WORD.
        //
        // This step did not exist, and its absence is what broke this test. Steps 9-10
        // below assumed the log created at step 3 was sitting in Draft. That stopped
        // being true at DFES wave-1.3: CreateDailyLogHandler self-attests an owner's
        // own log (Draft->Confirmed->Verified, both events at creation), and step 4's
        // add_log_task re-attests it because the actor IS the operator. So the log
        // arrived at step 9 already Verified, and `verify_log -> Confirmed` failed with
        // ShramSafal.VerificationTransitionNotAllowedForRole — correctly: the FSM has
        // no Verified->Confirmed edge, for anyone.
        //
        //   [EVIDENCE, before this fix] verify_log (Confirmed): status='failed'
        //                               errorCode='ShramSafal.VerificationTransitionNotAllowedForRole'
        //
        // THE OLD ASSERTION IS NOT COMING BACK. Restoring "the owner's log starts
        // Draft" would re-break the closed-day ring wave-1.3 fixed — the farmer logs
        // his work and his score drops one sync later. It is asserted here, positively,
        // so the invariant this test now depends on is stated rather than assumed.
        var ownersOwnLogStatusBeforeAnyone = await ReadVerificationStatusAsync(dailyLogId);
        output.WriteLine($"[EVIDENCE] owner's own log, straight after create+add_task: " +
                         $"'{ownersOwnLogStatusBeforeAnyone}'");
        ownersOwnLogStatusBeforeAnyone.Should().Be("Verified",
            "founder ruling 2026-08-27 (2B): an owner-tier user's own log is Verified on save, not Draft");

        // 8c. A WORKER appends to the owner's approved day, which RE-OPENS it.
        //
        // This is real wave-1.3 I3 behaviour, not scaffolding: an attestation must
        // cover the content it attests to, so when someone OTHER than the log's own
        // operator adds work to an approved day, AddLogTaskHandler walks the log back
        // to Draft and it lands in the owner's inbox. (Had the owner added it himself,
        // step 4's path applies instead and it would be re-attested, staying Verified.)
        //
        // It is also what puts the log back in the state steps 9-10 need, using only
        // mutations a real device sends — no fixture surgery, and one more genuine
        // hole covered: before I3, a mukadam could append to an approved day and it
        // stayed approved.
        var workerAppendResult = await RunSyncPushAsync(WorkerA, "worker", "d-A", "req-task-worker", "add_log_task", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["activityType"] = "Weeding",
        });
        AssertApplied(workerAppendResult, "add_log_task (worker appends to the owner's approved day)");

        var statusAfterWorkerAppend = await ReadVerificationStatusAsync(dailyLogId);
        output.WriteLine($"[EVIDENCE] after a NON-operator appended a task: '{statusAfterWorkerAppend}'");
        statusAfterWorkerAppend.Should().Be("Draft",
            "an approval must not survive work it never covered — the day re-opens into the owner's inbox");

        // 9-10. verify_log Draft→Confirmed→Verified — THE headline mutation.
        // The Verified transition also exercises OnLogVerifiedAutoVerifyJobCard,
        // which requires the job card to already be Completed (step 8) — auto-
        // promotes it to VerifiedForPayout.
        var verifyConfirmResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-verify-confirm", "verify_log", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["status"] = "Confirmed",
        });
        AssertApplied(verifyConfirmResult, "verify_log (Confirmed)");

        var verifyResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-verify-verified", "verify_log", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["status"] = "Verified",
        });
        AssertApplied(verifyResult, "verify_log (Verified)");

        // 11. jobcard.settle — same shape; job card must now be VerifiedForPayout.
        var jobCardSettleResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-jc-settle", "jobcard.settle", new()
        {
            ["jobCardId"] = jobCardId,
            ["actualPayoutAmount"] = 200m,
            ["actualPayoutCurrencyCode"] = "INR",
        });
        AssertApplied(jobCardSettleResult, "jobcard.settle");

        // 12. jobcard.cancel — a SEPARATE Draft job card (a PaidOut card is
        // terminal and cannot be cancelled).
        var jobCardCancelCreateResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-jc2-create", "jobcard.create", new()
        {
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["plannedDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
            ["lineItems"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["activityType"] = "Spraying",
                    ["expectedHours"] = 2m,
                    ["ratePerHourAmount"] = 40m,
                    ["ratePerHourCurrencyCode"] = "INR",
                },
            },
        });
        AssertApplied(jobCardCancelCreateResult, "jobcard.create (for cancel)");
        var jobCardCancelId = ((ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult)jobCardCancelCreateResult.Data!).JobCardId;

        var jobCardCancelResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-jc-cancel", "jobcard.cancel", new()
        {
            ["jobCardId"] = jobCardCancelId,
            ["reason"] = "Weather changed the plan.",
        });
        AssertApplied(jobCardCancelResult, "jobcard.cancel");

        // 13. add_cost_entry — known-farmId shape. Photo/attachment upload's
        // sibling bug — this exact naked-IsUserMemberOfFarmAsync pattern was
        // the one flagged as "dead in production since May".
        var costEntryResult1 = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-cost-1", "add_cost_entry", new()
        {
            ["costEntryId"] = costEntryId1,
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropCycleId"] = cropCycleId,
            ["categoryId"] = "fertilizer",
            ["description"] = "MKP fertigation",
            ["amount"] = 500m,
            ["currencyCode"] = "INR",
            ["entryDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
        });
        AssertApplied(costEntryResult1, "add_cost_entry (1)");

        // 14. correct_cost_entry — unknown-farmId-via-cost_entry shape.
        var correctResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-correct", "correct_cost_entry", new()
        {
            ["costEntryId"] = costEntryId1,
            ["correctedAmount"] = 550m,
            ["currencyCode"] = "INR",
            ["reason"] = "Vendor invoice revised.",
        });
        AssertApplied(correctResult, "correct_cost_entry");

        // 15. A second, fresh cost entry for allocate_global_expense.
        var costEntryResult2 = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-cost-2", "add_cost_entry", new()
        {
            ["costEntryId"] = costEntryId2,
            ["farmId"] = FarmA,
            ["categoryId"] = "seeds",
            ["description"] = "Grape rootstock",
            ["amount"] = 300m,
            ["currencyCode"] = "INR",
            ["entryDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
        });
        AssertApplied(costEntryResult2, "add_cost_entry (2)");

        // 16. allocate_global_expense — this dispatch case had NO membership
        // check anywhere in the dispatcher before this fix.
        var allocateResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-allocate", "allocate_global_expense", new()
        {
            ["costEntryId"] = costEntryId2,
            ["allocationBasis"] = "equal",
            ["allocations"] = Array.Empty<object>(),
        });
        AssertApplied(allocateResult, "allocate_global_expense");

        // 17. create_attachment — known-farmId shape.
        var attachmentResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-attachment", "create_attachment", new()
        {
            ["attachmentId"] = attachmentId,
            ["farmId"] = FarmA,
            ["linkedEntityId"] = dailyLogId,
            ["linkedEntityType"] = "dailylog",
            ["fileName"] = "receipt.jpg",
            ["mimeType"] = "image/jpeg",
        });
        AssertApplied(attachmentResult, "create_attachment");

        // 18. set_price_config — global lookup; only needs phase (a)
        // (user_id GUC) so GetFarmIdsForUserAsync sees Owner A's own farm.
        var priceConfigResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-price", "set_price_config", new()
        {
            ["itemName"] = $"TenantScopeProof-{Guid.NewGuid():N}",
            ["unitPrice"] = 12.5m,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
            ["version"] = 1,
        });
        AssertApplied(priceConfigResult, "set_price_config");

        // ── DB-level evidence: the job card genuinely reached PaidOut and the
        // cancelled sibling genuinely reached Cancelled — not just "applied".
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var jobCardStatus = await ScalarAsync(read,
            "SELECT status FROM ssf.job_cards WHERE id = @id", ("id", jobCardId));
        Convert.ToString(jobCardStatus).Should().Be("PaidOut",
            "the full jobcard.create→assign→start→complete→(verify_log auto-hook)→settle chain must land PaidOut");

        var jobCardCancelStatus = await ScalarAsync(read,
            "SELECT status FROM ssf.job_cards WHERE id = @id", ("id", jobCardCancelId));
        Convert.ToString(jobCardCancelStatus).Should().Be("Cancelled");

        var costEntryIsCorrected = await ScalarAsync(read,
            "SELECT is_corrected FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", costEntryId1));
        Convert.ToBoolean(costEntryIsCorrected).Should().BeTrue("correct_cost_entry must have flagged the entry");

        var financeCorrectionAmount = await ScalarAsync(read,
            "SELECT corrected_amount FROM ssf.finance_corrections WHERE cost_entry_id = @id", ("id", costEntryId1));
        Convert.ToDecimal(financeCorrectionAmount).Should().Be(550m);

        var dayLedgerCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.day_ledgers WHERE source_cost_entry_id = @id", ("id", costEntryId2));
        dayLedgerCount.Should().Be(1, "allocate_global_expense must have created the day ledger");

        var attachmentCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.attachments WHERE \"Id\" = @id AND farm_id = @farm",
            ("id", attachmentId), ("farm", FarmA));
        attachmentCount.Should().Be(1);

        output.WriteLine("[EVIDENCE] === Phase 1 tenant-scope full-chain proof (real Npgsql :5433, agrisync_app) ===");
        output.WriteLine("[EVIDENCE] All 16 chained mutation types returned 'applied'. job_cards.status(main)=PaidOut, (cancel-sibling)=Cancelled.");
    }

    // ═════════════════════════════════════════════════════════════════════
    // POSITIVE PROOF 2 — compliance.acknowledge / compliance.resolve /
    // testinstance.collected / testinstance.reported. These four have no
    // "create" sync mutation, so the target rows are seeded directly via the
    // domain's own factories on a SEPARATE superuser-connected DbContext
    // (bypasses RLS for the seed only — exactly like the sibling suites seed
    // farms/plots via raw SQL as superuser).
    // ═════════════════════════════════════════════════════════════════════
    [Fact]
    public async Task SyncPush_ComplianceAndTestInstanceMutations_SucceedForGenuineFarmMember()
    {
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();
        var ackSignalId = Guid.NewGuid();
        var resolveSignalId = Guid.NewGuid();
        var testProtocolId = Guid.NewGuid();
        var collectInstanceId = Guid.NewGuid();
        var reportInstanceId = Guid.NewGuid();
        var attachmentIdForReport = Guid.NewGuid();

        await using (var seedDb = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options))
        {
            await using var raw = new NpgsqlConnection(_superuserConn);
            await raw.OpenAsync();
            await SeedPlotAsync(raw, plotId, FarmA, "Plot A2");
            await SeedCropCycleAsync(raw, cropCycleId, FarmA, plotId, "Sugarcane", "Vegetative");

            var farmIdTyped = new FarmId(FarmA);
            var now = DateTime.UtcNow;

            seedDb.Add(ComplianceSignal.Open(
                ackSignalId, farmIdTyped, plotId, cropCycleId,
                ruleCode: "MISSING_TEST", severity: ComplianceSeverity.Watch,
                suggestedAction: ComplianceSuggestedAction.AssignTest,
                titleEn: "Missing test", titleMr: "चाचणी गहाळ",
                descriptionEn: "A scheduled test is overdue.", descriptionMr: "नियोजित चाचणी बाकी आहे.",
                payloadJson: "{}", firstSeenAtUtc: now));

            seedDb.Add(ComplianceSignal.Open(
                resolveSignalId, farmIdTyped, plotId, cropCycleId,
                ruleCode: "SCHEDULE_GAP", severity: ComplianceSeverity.NeedsAttention,
                suggestedAction: ComplianceSuggestedAction.ScheduleMissingActivity,
                titleEn: "Schedule gap", titleMr: "वेळापत्रकातील तफावत",
                descriptionEn: "An expected activity was not scheduled.", descriptionMr: "अपेक्षित काम नियोजित नव्हते.",
                payloadJson: "{}", firstSeenAtUtc: now));

            seedDb.Add(TestProtocol.Create(
                testProtocolId, "Soil NPK", "Sugarcane", TestProtocolKind.Soil,
                TestProtocolPeriodicity.PerStage, new UserId(OwnerA), now));

            var collectInstance = TestInstance.Schedule(
                collectInstanceId, testProtocolId, TestProtocolKind.Soil,
                cropCycleId, farmIdTyped, plotId, "Vegetative",
                DateOnly.FromDateTime(now), now);
            seedDb.Add(collectInstance);

            // Pre-collected so testinstance.reported has a valid Collected→Reported
            // precondition (the domain's own MarkCollected, not the sync path).
            var reportInstance = TestInstance.Schedule(
                reportInstanceId, testProtocolId, TestProtocolKind.Soil,
                cropCycleId, farmIdTyped, plotId, "Vegetative",
                DateOnly.FromDateTime(now), now);
            reportInstance.MarkCollected(new UserId(OwnerA), AppRole.SecondaryOwner, now);
            seedDb.Add(reportInstance);

            await seedDb.SaveChangesAsync();
        }

        // compliance.acknowledge — unknown-farmId-via-compliance_signal shape.
        var ackResult = await RunSyncPushAsync(OwnerA, "PrimaryOwner", "d-A", "req-ack", "compliance.acknowledge", new()
        {
            ["signalId"] = ackSignalId,
        });
        AssertApplied(ackResult, "compliance.acknowledge");

        // compliance.resolve — same shape.
        var resolveResult = await RunSyncPushAsync(OwnerA, "PrimaryOwner", "d-A", "req-resolve", "compliance.resolve", new()
        {
            ["signalId"] = resolveSignalId,
            ["note"] = "Confirmed with the field team.",
        });
        AssertApplied(resolveResult, "compliance.resolve");

        // testinstance.collected — unknown-farmId-via-test_instance shape.
        var collectedResult = await RunSyncPushAsync(OwnerA, "LabOperator", "d-A", "req-collected", "testinstance.collected", new()
        {
            ["testInstanceId"] = collectInstanceId,
        });
        AssertApplied(collectedResult, "testinstance.collected");

        // testinstance.reported — same shape.
        var reportedResult = await RunSyncPushAsync(OwnerA, "LabOperator", "d-A", "req-reported", "testinstance.reported", new()
        {
            ["testInstanceId"] = reportInstanceId,
            ["results"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["parameterCode"] = "pH",
                    ["parameterValue"] = "6.5",
                    ["unit"] = "pH",
                },
            },
            ["attachmentIds"] = new[] { attachmentIdForReport },
        });
        AssertApplied(reportedResult, "testinstance.reported");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var ackAt = await ScalarAsync(read,
            "SELECT acknowledged_at_utc FROM ssf.compliance_signals WHERE \"Id\" = @id", ("id", ackSignalId));
        ackAt.Should().NotBeNull("compliance.acknowledge must have set acknowledged_at_utc");

        var resolvedAt = await ScalarAsync(read,
            "SELECT resolved_at_utc FROM ssf.compliance_signals WHERE \"Id\" = @id", ("id", resolveSignalId));
        resolvedAt.Should().NotBeNull("compliance.resolve must have set resolved_at_utc");

        var collectedStatus = await ScalarAsync(read,
            "SELECT status FROM ssf.test_instances WHERE id = @id", ("id", collectInstanceId));
        Convert.ToInt32(collectedStatus).Should().Be((int)TestInstanceStatus.Collected);

        var reportedStatus = await ScalarAsync(read,
            "SELECT status FROM ssf.test_instances WHERE id = @id", ("id", reportInstanceId));
        Convert.ToInt32(reportedStatus).Should().Be((int)TestInstanceStatus.Reported);

        output.WriteLine("[EVIDENCE] === compliance.* / testinstance.* tenant-scope proof (real Npgsql :5433, agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] compliance_signals.acknowledged_at_utc set = {ackAt is not null}");
        output.WriteLine($"[EVIDENCE] compliance_signals.resolved_at_utc set     = {resolvedAt is not null}");
        output.WriteLine($"[EVIDENCE] test_instances status (collected/reported) = {collectedStatus}/{reportedStatus}");
    }

    // ═════════════════════════════════════════════════════════════════════
    // NEGATIVE PROOFS — one per DISTINCT scope-establishment shape. A caller
    // who is NOT a member of the target farm must still be rejected; proves
    // the fix did not loosen isolation while closing the availability bug.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task SyncPush_CreatePlot_FailsClosedForNonMember_KnownFarmIdShape()
    {
        var result = await RunSyncPushAsync(OwnerB, "owner", "d-B", "req-forged-plot", "create_plot", new()
        {
            ["plotId"] = Guid.NewGuid(),
            ["farmId"] = FarmA, // Owner B does not belong to Farm A.
            ["name"] = "Forged plot",
            ["areaInAcres"] = 1.0m,
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");
        output.WriteLine($"[EVIDENCE] create_plot as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_VerifyLog_FailsClosedForNonMember_DailyLogShape()
    {
        var (plotId, cropCycleId, dailyLogId) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        AssertApplied(await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-neg-plot", "create_plot", new()
        {
            ["plotId"] = plotId,
            ["farmId"] = FarmA,
            ["name"] = "Plot A3",
            ["areaInAcres"] = 1.0m,
        }), "create_plot (fixture)");
        AssertApplied(await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-neg-cycle", "create_crop_cycle", new()
        {
            ["cropCycleId"] = cropCycleId,
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropName"] = "Grapes",
            ["stage"] = "Vegetative",
            ["startDate"] = new DateOnly(2026, 1, 1).ToString("yyyy-MM-dd"),
        }), "create_crop_cycle (fixture)");
        AssertApplied(await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-neg-log", "create_daily_log", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["cropCycleId"] = cropCycleId,
            ["logDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
        }), "create_daily_log (fixture)");

        // Owner B (a genuine owner of a DIFFERENT farm) attempts to approve
        // Farm A's log.
        var result = await RunSyncPushAsync(OwnerB, "owner", "d-B", "req-forged-verify", "verify_log", new()
        {
            ["dailyLogId"] = dailyLogId,
            ["status"] = "Confirmed",
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.DailyLogNotFound",
            "RLS must hide a cross-farm log; conflating not-found with forbidden leaks nothing");
        output.WriteLine($"[EVIDENCE] verify_log as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_CorrectCostEntry_FailsClosedForNonMember_CostEntryShape()
    {
        var costEntryId = Guid.NewGuid();
        AssertApplied(await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-neg-cost", "add_cost_entry", new()
        {
            ["costEntryId"] = costEntryId,
            ["farmId"] = FarmA,
            ["categoryId"] = "seeds",
            ["description"] = "Fixture entry",
            ["amount"] = 100m,
            ["currencyCode"] = "INR",
            ["entryDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
        }), "add_cost_entry (fixture)");

        var result = await RunSyncPushAsync(OwnerB, "owner", "d-B", "req-forged-correct", "correct_cost_entry", new()
        {
            ["costEntryId"] = costEntryId,
            ["correctedAmount"] = 1m,
            ["currencyCode"] = "INR",
            ["reason"] = "Attempted cross-farm correction.",
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.CostEntryNotFound");
        output.WriteLine($"[EVIDENCE] correct_cost_entry as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_JobCardAssign_FailsClosedForNonMember_JobCardShape()
    {
        var plotId = Guid.NewGuid();
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedPlotAsync(raw, plotId, FarmA, "Plot A4");
        }

        var createResult = await RunSyncPushAsync(OwnerA, "owner", "d-A", "req-neg-jc", "jobcard.create", new()
        {
            ["farmId"] = FarmA,
            ["plotId"] = plotId,
            ["plannedDate"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
            ["lineItems"] = new object[]
            {
                new Dictionary<string, object?>
                {
                    ["activityType"] = "Weeding",
                    ["expectedHours"] = 3m,
                    ["ratePerHourAmount"] = 30m,
                    ["ratePerHourCurrencyCode"] = "INR",
                },
            },
        });
        AssertApplied(createResult, "jobcard.create (fixture)");
        var jobCardId = ((ShramSafal.Application.UseCases.Work.CreateJobCard.CreateJobCardResult)createResult.Data!).JobCardId;

        var result = await RunSyncPushAsync(OwnerB, "owner", "d-B", "req-forged-assign", "jobcard.assign", new()
        {
            ["jobCardId"] = jobCardId,
            ["workerUserId"] = OwnerB,
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.JobCardNotFound");
        output.WriteLine($"[EVIDENCE] jobcard.assign as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_ComplianceAcknowledge_FailsClosedForNonMember_ComplianceSignalShape()
    {
        var (plotId, signalId) = (Guid.NewGuid(), Guid.NewGuid());
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedPlotAsync(raw, plotId, FarmA, "Plot A5");
        }

        await using (var seedDb = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options))
        {
            seedDb.Add(ComplianceSignal.Open(
                signalId, new FarmId(FarmA), plotId, null,
                ruleCode: "NEG_TEST", severity: ComplianceSeverity.Info,
                suggestedAction: ComplianceSuggestedAction.AcknowledgeOnly,
                titleEn: "t", titleMr: "t", descriptionEn: "d", descriptionMr: "d",
                payloadJson: "{}", firstSeenAtUtc: DateTime.UtcNow));
            await seedDb.SaveChangesAsync();
        }

        var result = await RunSyncPushAsync(OwnerB, "PrimaryOwner", "d-B", "req-forged-ack", "compliance.acknowledge", new()
        {
            ["signalId"] = signalId,
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.ComplianceSignalNotFound");
        output.WriteLine($"[EVIDENCE] compliance.acknowledge as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_TestInstanceCollected_FailsClosedForNonMember_TestInstanceShape()
    {
        var (plotId, cropCycleId, protocolId, instanceId) =
            (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedPlotAsync(raw, plotId, FarmA, "Plot A6");
            await SeedCropCycleAsync(raw, cropCycleId, FarmA, plotId, "Grapes", "Vegetative");
        }

        await using (var seedDb = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options))
        {
            var now = DateTime.UtcNow;
            seedDb.Add(TestProtocol.Create(
                protocolId, "Soil NPK", "Grapes", TestProtocolKind.Soil,
                TestProtocolPeriodicity.PerStage, new UserId(OwnerA), now));
            seedDb.Add(TestInstance.Schedule(
                instanceId, protocolId, TestProtocolKind.Soil, cropCycleId,
                new FarmId(FarmA), plotId, "Vegetative", DateOnly.FromDateTime(now), now));
            await seedDb.SaveChangesAsync();
        }

        var result = await RunSyncPushAsync(OwnerB, "LabOperator", "d-B", "req-forged-collect", "testinstance.collected", new()
        {
            ["testInstanceId"] = instanceId,
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.TestInstanceNotFound");
        output.WriteLine($"[EVIDENCE] testinstance.collected as non-member: status={result.Status} errorCode={result.ErrorCode}");
    }

    [Fact]
    public async Task SyncPush_SetPriceConfig_FailsClosedForUserWithNoFarmMembership()
    {
        var result = await RunSyncPushAsync(NoFarmUser, "owner", "d-none", "req-noFarm-price", "set_price_config", new()
        {
            ["itemName"] = $"NoFarmProof-{Guid.NewGuid():N}",
            ["unitPrice"] = 1m,
            ["currencyCode"] = "INR",
            ["effectiveFrom"] = new DateOnly(2026, 7, 19).ToString("yyyy-MM-dd"),
            ["version"] = 1,
        });

        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");
        output.WriteLine($"[EVIDENCE] set_price_config for a user with no farm at all: status={result.Status} errorCode={result.ErrorCode}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Drives the ACTUAL PushSyncBatchHandler under the production /sync/push
    // posture: admin-elevate TenantContext (exactly what the /sync/push
    // skip-list in TenantTransactionMiddleware does) and invoke the handler
    // with a SINGLE mutation. The test sets NO farm GUC — the handler is
    // solely responsible for it. Fresh DI scope per call (mirrors the Fix 1
    // sibling suite) so TenantContext's "already elevated" guard never trips.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<SyncMutationResultDto> RunSyncPushAsync(
        Guid actorUserId,
        string actorRole,
        string deviceId,
        string clientRequestId,
        string mutationType,
        Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        var tenant = sp.GetRequiredService<TenantContext>();
        tenant.ElevateToAdminCrossTenant();

        var handler = sp.GetRequiredService<PushSyncBatchHandler>();
        var payloadElement = JsonSerializer.SerializeToElement(payload);

        var command = new PushSyncBatchCommand(
            DeviceId: deviceId,
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, payloadElement),
            },
            AppVersion: "1.2.3");

        var response = await handler.HandleAsync(command);
        response.IsSuccess.Should().BeTrue($"the /sync/push batch call itself must succeed for {mutationType}");
        return Assert.Single(response.Value!.Results);
    }

    /// <summary>
    /// spec: 2026-08-25-prod-cutover-waves — founder ruling 2026-08-27. The verification
    /// status of a log, read as GROUND TRUTH from Postgres rather than from a handler's
    /// return value.
    ///
    /// <para><b>Why it folds instead of reading a column.</b> There IS no column:
    /// <c>DailyLogConfiguration</c> <c>Ignore</c>s both status properties and
    /// <c>DailyLog.CurrentVerificationStatus</c> derives them by
    /// <c>OrderBy(OccurredAtUtc).Last()</c> over <c>ssf.verification_events</c>. That is
    /// exactly why a device can never write its own approval, and why this helper
    /// reproduces the same fold in SQL — asking the server for its opinion of its own
    /// state would prove nothing about what is stored.</para>
    ///
    /// <para>No rows means no verification event was ever emitted, which the domain
    /// reads as <c>Draft</c>.</para>
    /// </summary>
    private async Task<string> ReadVerificationStatusAsync(Guid dailyLogId)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var status = await ScalarAsync(read,
            """
            SELECT status FROM ssf.verification_events
            WHERE daily_log_id = @id
            ORDER BY occurred_at_utc DESC
            LIMIT 1
            """,
            ("id", dailyLogId));

        return Convert.ToString(status) ?? "Draft";
    }

    private void AssertApplied(SyncMutationResultDto result, string label)
    {
        output.WriteLine(
            $"[EVIDENCE] {label}: status='{result.Status}' errorCode='{result.ErrorCode}' errorMessage='{result.ErrorMessage}'");
        result.Status.Should().Be("applied", $"{label} must succeed for a genuine farm member under real FORCE-RLS");
    }

    private void AssertNonSuperuserAppRole()
    {
        // Anchor: the handler write path ran as a NON-superuser, no-BYPASSRLS
        // role so FORCE-RLS genuinely applied — this is not a superuser-vacuous
        // pass. Mirrors SyncPushLedgerDerivationRealPostgresTests.
        using var appCheck = new NpgsqlConnection(_appConn);
        appCheck.Open();
        using var cmd = appCheck.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var isSuper = Convert.ToBoolean(cmd.ExecuteScalar());
        isSuper.Should().BeFalse(
            "the app connection must be a NON-superuser, no-BYPASSRLS role so FORCE-RLS is real");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Seed helpers (mirror SyncPushLedgerDerivationRealPostgresTests).
    // ─────────────────────────────────────────────────────────────────────────

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

    private static async Task SeedFarmMembershipAsync(
        NpgsqlConnection db, Guid id, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        cmd.Parameters.AddWithValue("status", status);
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

    private static async Task SeedCropCycleAsync(
        NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId, string crop, string stage)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @crop, @stage, @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("crop", crop);
        cmd.Parameters.AddWithValue("stage", stage);
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
