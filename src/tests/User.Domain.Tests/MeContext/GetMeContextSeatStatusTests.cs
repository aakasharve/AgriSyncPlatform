// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Application.Ports;
using User.Application.UseCases.Users.GetMeContext;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace UserMeContextTests;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — <c>GET /user/auth/me/context?includePending=true</c>
/// lists every seat that has not ended, so a person who only TYPED a farm's code (a PendingApproval
/// request) or whose seat is paused (Suspended) is listed too; without the parameter (an older
/// installed app) only Active seats are. Such a seat is a relationship, not access:
/// the person has not been let in, so the farm's code, its owner account and the owner's billing
/// (plan, plan date, plan alerts) are not his to see — the same rule <c>GetMyFarmsHandler</c>
/// applies to <c>/shramsafal/farms/mine</c>. Each refusal is paired with an Active control that
/// carries the same farm data, so the refusal cannot pass because the fixture is empty.
/// </summary>
public sealed class GetMeContextSeatStatusTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid OwnerAccount = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000c1");

    [Theory]
    [InlineData("PendingApproval")]
    [InlineData("Suspended")]
    [InlineData("PendingOtpClaim")]
    public async Task A_seat_that_is_not_Active_carries_name_and_status_only(string status)
    {
        var waitingFarm = Guid.NewGuid();
        var activeFarm = Guid.NewGuid();
        var context = await RunAsync(
            includePending: true,
            Seat(waitingFarm, "Shinde Mala", status, role: "Worker") with { StatusReason = "थांबा" },
            // step 2: a Mukadam verifies only with the labour grant (canVerify is now real).
            Seat(activeFarm, "Jadhav Wadi", "Active", role: "Mukadam") with { HasLabourGrant = true });

        var waiting = context.Farms.Single(f => f.FarmId == waitingFarm);
        waiting.Name.Should().Be("Shinde Mala");
        waiting.Status.Should().Be(status);
        waiting.FarmCode.Should().BeNull("a person who has not been let in is not handed the farm's code");
        waiting.OwnerAccountId.Should().Be(Guid.Empty);
        waiting.Plan.Should().Be("Free", "the contract's 'nothing known' value, never the owner's real plan (PastDue here)");
        waiting.PlanValidUntilUtc.Should().BeNull();
        waiting.Capabilities.Should().Be(new MeCapabilitiesDto(false, false, false, false));
        waiting.Permissions.Should().BeEmpty("spec step 2: a seat that is not Active grants nothing");
        waiting.StatusReason.Should().Be("थांबा", "spec step 2: a paused person is told the owner's reason");
        context.Alerts.Should().NotContain(a => a.FarmId == waitingFarm,
            "a plan alert would tell a requester the owner's billing state");

        // CONTROL: the Active seat on a farm of the SAME owner account and the SAME PastDue
        // subscription keeps its code, owner account, plan and alert.
        var active = context.Farms.Single(f => f.FarmId == activeFarm);
        active.FarmCode.Should().Be("K7M2QP");
        active.OwnerAccountId.Should().Be(OwnerAccount);
        active.Plan.Should().Be("PastDue");
        active.PlanValidUntilUtc.Should().NotBeNull();
        active.Capabilities.CanVerify.Should().BeTrue("control: a Mukadam with the labour grant may verify");
        context.Alerts.Should().ContainSingle(a => a.FarmId == activeFarm && a.Kind == "plan_expiring");
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — the 1.0.16 APK (and any app before
    /// step 1) calls <c>/me/context</c> WITHOUT <c>includePending</c> and ignores <c>status</c>.
    /// It must get exactly the Active-only list it always got: a person whose only seat is a
    /// waiting request sees the no-farm screen, never a farm he would tap and cannot open.
    /// </summary>
    [Theory]
    [InlineData("PendingApproval")]
    [InlineData("Suspended")]
    [InlineData("PendingOtpClaim")]
    public async Task Without_includePending_a_seat_that_is_not_Active_is_not_listed_at_all(string status)
    {
        var waitingFarm = Guid.NewGuid();
        var activeFarm = Guid.NewGuid();

        var both = await RunAsync(
            includePending: false,
            Seat(waitingFarm, "Shinde Mala", status, role: "Worker"),
            Seat(activeFarm, "Jadhav Wadi", "Active", role: "Mukadam"));
        both.Farms.Select(f => f.FarmId).Should().Equal(new[] { activeFarm },
            "an older app is handed only the farm it can open");

        var onlyWaiting = await RunAsync(includePending: false, Seat(waitingFarm, "Shinde Mala", status, role: "Worker"));
        onlyWaiting.Farms.Should().BeEmpty("the old app shows its 0-farm screen, as before step 1");
        onlyWaiting.Alerts.Should().ContainSingle(a => a.Kind == "no_farms_yet",
            "the same alert an old app got for a person with no farm");

        // CONTROL: the same seat IS listed when the caller asks for it — so the absence above is
        // the parameter, not an empty fixture.
        var asked = await RunAsync(includePending: true, Seat(waitingFarm, "Shinde Mala", status, role: "Worker"));
        asked.Farms.Should().ContainSingle(f => f.FarmId == waitingFarm && f.Status == status);
    }

    [Fact]
    public async Task The_default_is_Active_only()
    {
        var waitingFarm = Guid.NewGuid();
        var user = NewUser();
        var handler = NewHandler(user, Seat(waitingFarm, "Shinde Mala", "PendingApproval", role: "Worker"));

        var result = await handler.HandleAsync(user.Id);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Farms.Should().BeEmpty("a caller that does not say includePending is an older app");
    }

    // ── spec: plr-d7-m1-multiuser-2026-10-26 (step 2) ─────────────────────────

    /// <summary>
    /// P11-M2: with includePending the list carries waiting / paused seats, but "no_farms_yet" is
    /// about farms the person is IN. A person whose only seat is a waiting request still gets it
    /// (before the fix he lost it, because the pending row counted as a farm).
    /// </summary>
    [Theory]
    [InlineData("PendingApproval")]
    [InlineData("Suspended")]
    public async Task No_farms_yet_counts_Active_seats_only_even_with_includePending(string status)
    {
        var waitingFarm = Guid.NewGuid();

        var onlyWaiting = await RunAsync(includePending: true, Seat(waitingFarm, "Shinde Mala", status, role: "Worker"));
        onlyWaiting.Farms.Should().ContainSingle("the waiting seat is still listed for the person to see");
        onlyWaiting.Alerts.Should().ContainSingle(a => a.Kind == "no_farms_yet");

        // CONTROL: with one Active seat beside it, the person HAS a farm.
        var withActive = await RunAsync(
            includePending: true,
            Seat(waitingFarm, "Shinde Mala", status, role: "Worker"),
            Seat(Guid.NewGuid(), "Jadhav Wadi", "Active", role: "Worker"));
        withActive.Alerts.Should().NotContain(a => a.Kind == "no_farms_yet");
    }

    /// <summary>
    /// The capability flags say what the server allows — fixed before any screen reads them
    /// (plan §4): canVerify = owner tier or a live labour grant; canAddCost = every Active seat
    /// (recording a purchase is open to every Active member — founder D-24d / D-12, alignment M-5);
    /// the effective permission names (correcting money = AddCost) travel as they are.
    /// </summary>
    [Fact]
    public async Task Capabilities_are_what_the_server_allows()
    {
        var farms = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        var context = await RunAsync(
            includePending: false,
            Seat(farms[0], "a", "Active", role: "Mukadam") with { Permissions = [] },
            Seat(farms[1], "b", "Active", role: "Mukadam") with { Permissions = [], HasLabourGrant = true },
            Seat(farms[2], "c", "Active", role: "Mukadam") with { Permissions = [], HasLabourGrant = true, LabourGrantExpiresAtUtc = Now.AddMinutes(-1) },
            Seat(farms[3], "d", "Active", role: "Worker") with { Permissions = [] },
            Seat(farms[4], "e", "Active", role: "SecondaryOwner") with { Permissions = ["SeeMoney", "PlanWork"] });

        MeCapabilitiesDto Caps(int i) => context.Farms.Single(f => f.FarmId == farms[i]).Capabilities;

        Caps(0).CanVerify.Should().BeFalse("an un-granted Mukadam is refused by the verify gate");
        Caps(1).CanVerify.Should().BeTrue("the labour grant lets him verify");
        Caps(2).CanVerify.Should().BeFalse("an expired grant answers nothing");
        for (var i = 0; i < farms.Length; i++)
        {
            Caps(i).CanAddCost.Should().BeTrue($"seat {i}: every Active member may record a purchase (the server's rule)");
        }

        Caps(3).CanInvite.Should().BeFalse();
        Caps(3).CanVerify.Should().BeFalse("a plain worker verifies nothing");
        Caps(4).CanVerify.Should().BeTrue("owner tier verifies (the labour rule, unchanged until step 2b)");
        Caps(4).CanInvite.Should().BeTrue();
        context.Farms.Single(f => f.FarmId == farms[3]).Permissions.Should().BeEmpty("a worker holds no stored power");
        context.Farms.Single(f => f.FarmId == farms[4]).Permissions.Should().Equal("SeeMoney", "PlanWork");
    }

    [Fact]
    public async Task A_waiting_or_paused_seat_has_no_capability_not_even_recording_a_purchase()
    {
        var waiting = Guid.NewGuid();
        var paused = Guid.NewGuid();
        var context = await RunAsync(
            includePending: true,
            Seat(waiting, "w", "PendingApproval", role: "Worker") with { Permissions = [] },
            Seat(paused, "p", "Suspended", role: "Mukadam") with { Permissions = [], HasLabourGrant = true });

        foreach (var farm in context.Farms)
        {
            farm.Capabilities.CanAddCost.Should().BeFalse($"{farm.Status}: nothing is granted until Active");
            farm.Capabilities.CanVerify.Should().BeFalse();
            farm.Permissions.Should().BeEmpty();
        }
    }

    private static FarmMembershipSnapshot Seat(Guid farmId, string name, string status, string role)
        => new(
            FarmId: new FarmId(farmId),
            FarmName: name,
            FarmCode: "K7M2QP",
            OwnerAccountId: new OwnerAccountId(OwnerAccount),
            Role: role,
            Status: status,
            JoinedVia: "SelfJoin",
            GrantedAtUtc: Now.AddDays(-1),
            LastSeenAtUtc: null,
            Subscription: new SubscriptionSnapshot("PastDue", "ShramSafalPro", Now.AddDays(3)));

    private static async Task<MeContextDto> RunAsync(bool includePending, params FarmMembershipSnapshot[] seats)
    {
        var user = NewUser();
        var result = await NewHandler(user, seats).HandleAsync(user.Id, includePending);
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private static DomainUser NewUser() => DomainUser.RegisterViaOtp(
        new UserId(Guid.NewGuid()), DomainPhone.Create("8888888888"), "Test User", "unusable", Now);

    private static GetMeContextHandler NewHandler(DomainUser user, params FarmMembershipSnapshot[] seats) => new(
        new SingleUserRepository(user),
        new FixedAccounts(),
        new FixedMemberships(seats),
        new FixedAffiliation(),
        new FixedClock(Now));

    // ---- hand-rolled fakes (this project has no mocking library) ----

    private sealed class FixedClock(DateTime now) : IClock { public DateTime UtcNow => now; }

    private sealed class FixedAccounts : IAccountsSnapshotReader
    {
        public Task<AccountsSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AccountsSnapshot(Array.Empty<OwnerAccountSnapshot>()));
    }

    private sealed class FixedMemberships(IReadOnlyList<FarmMembershipSnapshot> seats) : IFarmMembershipSnapshotReader
    {
        public Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(seats);
    }

    private sealed class FixedAffiliation : IAffiliationSnapshotReader
    {
        public Task<AffiliationSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AffiliationSnapshot(null, 0, 0, 0));
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
