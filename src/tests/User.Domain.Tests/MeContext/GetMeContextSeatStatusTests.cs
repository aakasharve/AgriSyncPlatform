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
            Seat(waitingFarm, "Shinde Mala", status, role: "Worker"),
            Seat(activeFarm, "Jadhav Wadi", "Active", role: "Mukadam"));

        var waiting = context.Farms.Single(f => f.FarmId == waitingFarm);
        waiting.Name.Should().Be("Shinde Mala");
        waiting.Status.Should().Be(status);
        waiting.FarmCode.Should().BeNull("a person who has not been let in is not handed the farm's code");
        waiting.OwnerAccountId.Should().Be(Guid.Empty);
        waiting.Plan.Should().Be("Free", "the contract's 'nothing known' value, never the owner's real plan (PastDue here)");
        waiting.PlanValidUntilUtc.Should().BeNull();
        waiting.Capabilities.Should().Be(new MeCapabilitiesDto(false, false, false, false));
        context.Alerts.Should().NotContain(a => a.FarmId == waitingFarm,
            "a plan alert would tell a requester the owner's billing state");

        // CONTROL: the Active seat on a farm of the SAME owner account and the SAME PastDue
        // subscription keeps its code, owner account, plan and alert.
        var active = context.Farms.Single(f => f.FarmId == activeFarm);
        active.FarmCode.Should().Be("K7M2QP");
        active.OwnerAccountId.Should().Be(OwnerAccount);
        active.Plan.Should().Be("PastDue");
        active.PlanValidUntilUtc.Should().NotBeNull();
        active.Capabilities.CanVerify.Should().BeTrue("control: a Mukadam's capabilities are computed as before");
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
