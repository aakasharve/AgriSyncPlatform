// spec: plr-d10 pilot lane NO-TRIAL (CTO ruling, 28 Nov 2026: nothing about the trial applies during the pilot) — /me/context's plan
// alerts follow Pilot:TrialEnforcementEnabled through ITrialEnforcementReader: OFF = no plan_expiring / plan_expired (so the live 1.0.17
// phones, which draw whatever alerts arrive, show nothing either); ON or no reader = exactly the alerts as before.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Application.Ports;
using User.Application.UseCases.Users.GetMeContext;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace UserMeContextTests;

public sealed class GetMeContextPilotAlertsTests
{
    private static readonly DateTime Now = new(2026, 12, 20, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid OwnerAccount = Guid.Parse("a1a1a1a1-0000-0000-0000-0000000000c2");

    public static IEnumerable<object[]> PlanAlerts() =>
    [
        ["Trialing", 3, "plan_expiring"], // "प्लॅन 3 दिवसांत संपेल"
        ["PastDue", 4, "plan_expiring"],
        ["Expired", -2, "plan_expired"], // "प्लॅन संपला आहे"
    ];

    [Theory]
    [MemberData(nameof(PlanAlerts))]
    public async Task Switch_off_sends_no_plan_alert(string status, int daysToEnd, string kind)
    {
        var farm = Guid.NewGuid();

        var off = await RunAsync(new FixedEnforcement(false), Seat(farm, status, daysToEnd));

        off.Alerts.Should().NotContain(a => a.Kind == "plan_expiring" || a.Kind == "plan_expired", $"{status}: the pilot warns no one about a trial or plan");
        off.Farms.Single().Plan.Should().Be(ExpectedPlan(status), "only the alert is held back; the farm's own plan field is unchanged");
        kind.Should().NotBeNull();
    }

    [Theory]
    [MemberData(nameof(PlanAlerts))]
    public async Task Switch_on_and_no_reader_send_the_plan_alert_exactly_as_before(string status, int daysToEnd, string kind)
    {
        var farm = Guid.NewGuid();

        var on = await RunAsync(new FixedEnforcement(true), Seat(farm, status, daysToEnd));
        var noReader = await RunAsync(null, Seat(farm, status, daysToEnd));

        on.Alerts.Should().ContainSingle(a => a.FarmId == farm && a.Kind == kind);
        on.Alerts.Should().BeEquivalentTo(noReader.Alerts, "an older composition without the reader keeps today's alerts");
    }

    [Fact]
    public async Task Switch_off_leaves_every_other_alert_alone()
    {
        var farm = Guid.NewGuid();
        var on = await RunAsync(new FixedEnforcement(true), Seat(farm, "Trialing", 3));
        var off = await RunAsync(new FixedEnforcement(false), Seat(farm, "Trialing", 3));

        off.Alerts.Should().BeEquivalentTo(on.Alerts.Where(a => a.Kind is not ("plan_expiring" or "plan_expired")));
        (await RunAsync(new FixedEnforcement(false))).Alerts.Should().Contain(a => a.Kind == "no_farms_yet", "a person with no farm is still told so");
    }

    // ---- helpers ----

    private static string ExpectedPlan(string status) => status switch
    {
        "Trialing" => "Trial",
        "PastDue" => "PastDue",
        _ => "Expired",
    };

    private static FarmMembershipSnapshot Seat(Guid farmId, string subscriptionStatus, int daysToEnd)
        => new(
            FarmId: new FarmId(farmId),
            FarmName: "Pilot Wadi",
            FarmCode: "P1L0T2",
            OwnerAccountId: new OwnerAccountId(OwnerAccount),
            Role: "PrimaryOwner",
            Status: "Active",
            JoinedVia: "SelfJoin",
            GrantedAtUtc: Now.AddDays(-30),
            LastSeenAtUtc: null,
            Subscription: new SubscriptionSnapshot(subscriptionStatus, "ShramSafalPro", Now.AddDays(daysToEnd)));

    private static async Task<MeContextDto> RunAsync(ITrialEnforcementReader? enforcement, params FarmMembershipSnapshot[] seats)
    {
        var user = DomainUser.RegisterViaOtp(new UserId(Guid.NewGuid()), DomainPhone.Create("8888888877"), "Pilot User", "unusable", Now);
        var handler = new GetMeContextHandler(
            new SingleUserRepository(user),
            new FixedAccounts(),
            new FixedMemberships(seats),
            new FixedAffiliation(),
            new FixedClock(Now),
            trialEnforcement: enforcement);
        var result = await handler.HandleAsync(user.Id);
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private sealed class FixedEnforcement(bool enabled) : ITrialEnforcementReader
    {
        public bool TrialEnforcementEnabled => enabled;
    }

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
