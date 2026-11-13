// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2 + AC5) — the round-1 verifier findings, proven
// over the REAL pipeline as the non-superuser app role (same harness as the other parts):
//   SEC-MU2-1 — a हजेरी व पक्कं grant left on a WAITING request survived an approval as काम सांगणे,
//               and a co-owner could store one there.
//   SEC-MU2-2 / MU2-V1 — splitting a whole-farm bill (allocate_global_expense) is the AddCost say
//               of the primary owner; nothing tested that gate.
//   SEC-MU2-5 — /me/context's step-2 projection (permissions, statusReason, the labour grant, the
//               registrant) had never run on real Postgres.
//   SEC-MU2-6 — a PrimaryOwner SEAT that is not the farm's registrant decided about people.
//   MU2-V6    — removing a person who had already left answered 403 ("you may not") — untrue.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Application.UseCases.Users.GetMeContext;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public sealed partial class MembershipLifecycleRoutesRealPostgresTests
{
    /// <summary>
    /// SEC-MU2-1. Nobody — the primary owner or a co-owner — stores हजेरी व पक्कं on a WAITING
    /// request (403, nothing stored, no history). And a grant already left on one (written before
    /// this refusal existed) does not survive the primary owner's approval as काम सांगणे: the seat
    /// is EXACTLY the chosen preset, and the audit row records the grant going from on to off.
    /// </summary>
    [Fact]
    public async Task An_approval_as_kaam_sangne_never_carries_a_grant_left_on_the_waiting_request()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);

        foreach (var caller in new[] { Family, Owner })
        {
            using var refused = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{Farm}/labour-permissions/{Joiner}", caller,
                new { canManageLabourRecords = true });
            var text = await refused.Content.ReadAsStringAsync();
            Output.WriteLine($"[EVIDENCE] {(caller == Owner ? "primary owner" : "co-owner")} grants on a waiting request: {(int)refused.StatusCode}");
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"a waiting request becomes what the approval says, nothing else: {text}");
        }

        (await LiveSeatAsync(Farm, Joiner))!.LabourGrant.Should().BeFalse("nothing was stored");
        (await AuditPayloadsAsync(Farm, "LabourManagementGranted")).Should().BeEmpty();

        // A grant left on the waiting seat by the code before this fix (planted as superuser).
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "UPDATE ssf.farm_memberships SET can_manage_labour_records = TRUE WHERE farm_id = @f AND user_id = @u AND status = 2",
                ("f", Farm), ("u", Joiner));
        }

        (await LiveSeatAsync(Farm, Joiner))!.LabourGrant.Should().BeTrue("arrange: the waiting request carries a grant");

        // The phone's exact काम सांगणे body.
        using (var doc = await DecideOkAsync(HttpMethod.Post, $"{Joiner}/approve", Owner, new { role = "Worker", grantLabour = false }))
        {
            doc.RootElement.GetProperty("role").GetString().Should().Be("Worker");
            doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean().Should().BeFalse();
        }

        var seat = await LiveSeatAsync(Farm, Joiner);
        seat!.Status.Should().Be(3);
        seat.LabourGrant.Should().BeFalse("काम सांगणे is a worker with no हजेरी व पक्कं");
        var approved = (await AuditPayloadsAsync(Farm, "MemberApproved")).Single();
        approved.GetProperty("labourGrantBefore").GetBoolean().Should().BeTrue();
        approved.GetProperty("labourGrant").GetBoolean().Should().BeFalse();

        // CONTROL: a person who has been let in can be granted — by the primary owner.
        using var granted = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{Farm}/labour-permissions/{Joiner}", Owner,
            new { canManageLabourRecords = true });
        granted.StatusCode.Should().Be(HttpStatusCode.OK, await granted.Content.ReadAsStringAsync());
        (await LiveSeatAsync(Farm, Joiner))!.LabourGrant.Should().BeTrue();
    }

    /// <summary>
    /// SEC-MU2-2 / MU2-V1. Splitting a whole-farm bill over the plots (the phone's
    /// allocate_global_expense push) is CHANGING money — the AddCost permission. A worker, a
    /// मुकादम and a co-owner are refused (Forbidden, no day ledger written); the primary owner's
    /// split is applied; once he stores AddCost for the co-owner, the co-owner's split is applied.
    /// </summary>
    [Fact]
    public async Task Splitting_a_whole_farm_bill_needs_the_primary_owners_AddCost_say()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });
        var billA = Guid.NewGuid();
        var billB = Guid.NewGuid();
        await SeedWholeFarmBillAsync(billA);
        await SeedWholeFarmBillAsync(billB);

        foreach (var (who, label) in new[] { (Worker, "worker"), (Worker3, "मुकादम"), (Family, "co-owner") })
        {
            var refused = await PushAllocationAsync(who, billA);
            Output.WriteLine($"[EVIDENCE] {label} allocate_global_expense: {refused.Status} {refused.ErrorCode}");
            refused.Status.Should().Be("failed", $"a {label} does not split money unless the primary owner said so");
            // lane BILL-1 add-on (re-review 2, N1): a कामगार seat reads only its own money, so another person's bill is not
            // there for it (not found, as a bill of another farm); the others see it and lack the authority.
            if (who == Worker)
            {
                refused.ErrorCode.Should().Be("ShramSafal.CostEntryNotFound");
            }
            else
            {
                refused.ErrorCode.Should().EndWith("Forbidden");
            }
            (await DayLedgerCountAsync(billA)).Should().Be(0, $"nothing is written for the {label}");
        }

        // CONTROLS: the primary owner splits the bill…
        var byOwner = await PushAllocationAsync(Owner, billA);
        byOwner.Status.Should().Be("applied", $"{byOwner.ErrorCode} {byOwner.ErrorMessage}");
        (await DayLedgerCountAsync(billA)).Should().Be(1);

        // …and once he stores AddCost for the co-owner, so may the co-owner.
        await DecideOkAsync(HttpMethod.Put, $"{Family}/access", Owner, new { permissions = new[] { "ReviewMoney" } });
        var byCoOwner = await PushAllocationAsync(Family, billB);
        byCoOwner.Status.Should().Be("applied", $"{byCoOwner.ErrorCode} {byCoOwner.ErrorMessage}");
        (await DayLedgerCountAsync(billB)).Should().Be(1);
    }

    /// <summary>
    /// SEC-MU2-5. <c>/me/context</c>'s step-2 fields, read by the REAL composition-root reader as the
    /// app role (RLS on) and mapped by the REAL handler: a paused person gets his status, the owner's
    /// reason, no permissions and no capabilities; the registrant every permission; a co-owner only
    /// what the primary owner stored; a मुकादम with the grant may verify and records purchases, and
    /// holds no money permission.
    /// </summary>
    [Fact]
    public async Task Me_context_carries_the_pause_reason_and_each_seats_real_permissions_on_real_Postgres()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // HARNESS PARITY (as the public.users grant in InitializeAsync, and the accounts grant in
        // Labour/PurveshDemoReseedHarness): the reader's subscription lookup reads accounts.*, which
        // the migration chain does not grant to the app role. Read-only; nothing in ssf.* changes.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "GRANT USAGE ON SCHEMA accounts TO agrisync_app; GRANT SELECT ON ALL TABLES IN SCHEMA accounts TO agrisync_app;");
        }

        const string Why = "पाऊस आहे, काम बंद";
        await DecideOkAsync(HttpMethod.Post, $"{Worker}/suspend", Owner, new { reason = Why });
        await DecideOkAsync(HttpMethod.Put, $"{Family}/access", Owner, new { permissions = new[] { "ReviewMoney" } });
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });

        var paused = (await MeContextAsync(Worker, includePending: true)).Single(f => f.FarmId == Farm);
        paused.Status.Should().Be("Suspended");
        paused.StatusReason.Should().Be(Why, "the paused person is told why (AccessStatusNotice)");
        paused.Permissions.Should().BeEmpty("a pause grants nothing");
        paused.Capabilities.Should().Be(new MeCapabilitiesDto(false, false, false, false));
        (await MeContextAsync(Worker, includePending: false)).Should().BeEmpty("an older app sees Active seats only");

        var owner = (await MeContextAsync(Owner, includePending: true)).Single(f => f.FarmId == Farm);
        // lane 2b: the primary owner holds every grantable authority; Invite is retired (D-26).
        owner.Permissions.Should().BeEquivalentTo(new[]
        {
            "SeeMoney", "SeeWages", "ReviewMoney", "PlanWork", "AddTestRecord",
            "AssignWork", "ConfirmRecords", "EditFarmSetup", "ManageScheduleTemplates", "SeeAllTasks", "SeeCompare", "ManageReminders",
        });
        owner.Authorities!.Select(a => a.Name).Should().BeEquivalentTo(FarmAuthorities.All.Select(FarmAuthorities.NameOf));
        owner.Authorities!.Should().OnlyContain(a => a.ExpiresAtUtc == null);
        owner.Capabilities.CanInvite.Should().BeTrue();

        // Exactly what the primary owner stored (D-22) — reviewing money brings seeing money (2b, §11.1).
        var coOwner = (await MeContextAsync(Family, includePending: true)).Single(f => f.FarmId == Farm);
        coOwner.Permissions.Should().Equal(new[] { "SeeMoney", "ReviewMoney" }, "what the primary owner stored, with what it needs");
        coOwner.Authorities!.Select(a => a.Name).Should().BeEquivalentTo(new[] { "SeeMoney", "ReviewMoney" });
        coOwner.Capabilities.CanInvite.Should().BeFalse("people and permissions are the primary account holder's (D-26)");

        var crew = (await MeContextAsync(Worker3, includePending: true)).Single(f => f.FarmId == Farm);
        crew.Role.Should().Be("Mukadam");
        crew.Permissions.Should().Equal(new[] { "ConfirmRecords" },
            "the one हजेरी व पक्कं switch is हजेरी + confirm records (2b); a मुकादम label gives no money power");
        crew.Authorities!.Select(a => a.Name).Should().BeEquivalentTo(new[] { "TakeAttendance", "ConfirmRecords" });
        crew.Capabilities.CanVerify.Should().BeTrue("the हजेरी व पक्कं grant is on");
        crew.Capabilities.CanAddCost.Should().BeTrue("every Active member records a purchase (M-5)");
        crew.StatusReason.Should().BeNull();

        // CONTROL: a plain worker with no grant may not verify.
        var plain = (await MeContextAsync(Worker2, includePending: true)).Single(f => f.FarmId == Farm);
        plain.Capabilities.CanVerify.Should().BeFalse();
        plain.Capabilities.CanAddCost.Should().BeTrue();
    }

    /// <summary>
    /// SEC-MU2-6. On farm G the registrant has no seat row and a second PrimaryOwner SEAT exists.
    /// That seat decides nothing about anybody (403, nothing moves, no history); the registrant —
    /// the primary owner for now — takes the same decision.
    /// </summary>
    [Fact]
    public async Task A_primary_owner_seat_that_is_not_the_registrant_decides_about_nobody()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var verb in new[] { "suspend", "remove" })
        {
            using var refused = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmG}/memberships/{WorkerG}/{verb}", SecondPrimaryG, new { reason = "x" });
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{verb}: {await refused.Content.ReadAsStringAsync()}");
        }

        (await LiveSeatAsync(FarmG, WorkerG))!.Status.Should().Be(3);
        (await DecisionAuditCountAsync(FarmG)).Should().Be(0);

        using var ok = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmG}/memberships/{WorkerG}/suspend", RegistrantG, new { reason = "x" });
        ok.StatusCode.Should().Be(HttpStatusCode.OK, await ok.Content.ReadAsStringAsync());
        (await LiveSeatAsync(FarmG, WorkerG))!.Status.Should().Be(4);
    }

    /// <summary>
    /// MU2-V6. The primary owner taps "शेतातून काढा" for a person who has meanwhile left, or "नको"
    /// for a request its maker withdrew. "Not on the farm" is already true: 200 with the ended row
    /// as it is (Exited — no fresh decision claimed), and no history row.
    /// </summary>
    [Fact]
    public async Task Removing_a_person_who_already_left_answers_the_truth_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SelfExitAsync(Worker);
        await JoinAndExpectPendingAsync(Joiner);
        await SelfExitAsync(Joiner);

        using (var removed = await DecideOkAsync(HttpMethod.Post, $"{Worker}/remove", Owner, new { reason = "x" }))
        {
            removed.RootElement.GetProperty("status").GetString().Should().Be("Exited");
        }

        using (var declined = await DecideOkAsync(HttpMethod.Post, $"{Joiner}/decline", Owner, new { reason = "x" }))
        {
            declined.RootElement.GetProperty("status").GetString().Should().Be("Exited");
        }

        (await DecisionAuditCountAsync(Farm)).Should().Be(0, "nothing was decided: the people had already gone");

        // CONTROL: someone never on this farm is still the uniform 403.
        using var stranger = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Stranger}/remove", Owner, new { reason = "x" });
        stranger.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // -- Harness (this part) ------------------------------------------------------

    private async Task SeedWholeFarmBillAsync(Guid costEntryId)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await ExecAsync(raw, """
            INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                          created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
            VALUES (@cost, @farm, NULL, 'probe whole-farm bill', 900, 'INR', CURRENT_DATE, @owner, NOW(), NOW(), 'manual', 'unknown', 'unknown', 'other');
            """,
            ("cost", costEntryId), ("farm", Farm), ("owner", Owner));
    }

    /// <summary>The phone's own split push (AllocationSelector's "equal" choice).</summary>
    private async Task<PushOutcome> PushAllocationAsync(Guid who, Guid costEntryId)
    {
        var requestId = $"allocate-{Guid.NewGuid():N}";
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    clientCommandId = requestId,
                    mutationType = "allocate_global_expense",
                    payload = new Dictionary<string, object?>
                    {
                        ["costEntryId"] = costEntryId, ["allocationBasis"] = "equal", ["allocations"] = Array.Empty<object>(),
                    },
                },
            },
        };

        using var response = await SendAsync(HttpMethod.Post, "/sync/push", who, request);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var result = doc.RootElement.GetProperty("results").EnumerateArray().Single();
        return new PushOutcome(
            result.GetProperty("status").GetString()!,
            result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null,
            result.TryGetProperty("errorMessage", out var msg) && msg.ValueKind == JsonValueKind.String ? msg.GetString() : null);
    }

    private async Task<long> DayLedgerCountAsync(Guid costEntryId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.day_ledgers WHERE source_cost_entry_id = @id";
        cmd.Parameters.AddWithValue("id", costEntryId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>
    /// <c>/me/context</c>'s farms for one person: the REAL <see cref="FarmMembershipSnapshotReader"/>
    /// over the app-role connection (RLS on, exactly the production query) fed to the REAL
    /// <see cref="GetMeContextHandler"/>. Only the user lookup, the accounts and the referral
    /// readers are fixed — they are not what step 2 changed.
    /// </summary>
    private async Task<IReadOnlyList<MeFarmDto>> MeContextAsync(Guid who, bool includePending)
    {
        await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
        await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(_appConn).Options);
        var user = DomainUser.RegisterViaOtp(new UserId(who), DomainPhone.Create("9876500000"), "Probe", "unusable", DateTime.UtcNow);
        var handler = new GetMeContextHandler(
            new OneUser(user),
            new NoAccounts(),
            new FarmMembershipSnapshotReader(ssf, accounts, new UtcClock()),
            new NoAffiliation(),
            new UtcClock());

        var result = await handler.HandleAsync(new UserId(who), includePending);
        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : null);
        return result.Value!.Farms;
    }

    private sealed class OneUser(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoAccounts : IAccountsSnapshotReader
    {
        public Task<AccountsSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AccountsSnapshot(Array.Empty<OwnerAccountSnapshot>()));
    }

    private sealed class NoAffiliation : IAffiliationSnapshotReader
    {
        public Task<AffiliationSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AffiliationSnapshot(null, 0, 0, 0));
    }

    private sealed class UtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }
}
