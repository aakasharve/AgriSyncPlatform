// spec: plr-d10 pilot lane NO-TRIAL (founder, 28 Nov 2026: "the 21-day trial is for the commercial purposes … For the pilot
// testing, we need to prove the thesis") — the server switch Pilot:TrialEnforcementEnabled (default false), and the voice
// switch Sarvam:LiveWordsEnabled (default false, founder 28 Nov 2026: no live words for the pilot).
//
// The policy runs for real (DefaultEntitlementPolicy, internal, InternalsVisibleTo this project) over a strict fake repository
// and a fake subscription reader. Enforcement ON is checked against the decisions the policy made before the switch existed;
// enforcement OFF against the pilot rule. Nothing here opens a database.
using System.Reflection;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases;
using ShramSafal.Application.UseCases.Memberships.GetMyFarms;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Subscriptions;
using ShramSafal.Domain.Tests.Common;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class PilotNoTrialEntitlementTests
{
    private static readonly DateTime Now = new(2026, 12, 20, 6, 0, 0, DateTimeKind.Utc);

    // ── the policy, enforcement ON: exactly the decisions made before the switch existed ──────────────────────────

    [Theory]
    [InlineData(1, 5, "none", true, EntitlementReason.Allowed)]
    [InlineData(1, -3, "none", true, EntitlementReason.Allowed)] // the job lags; the status decides, as before
    [InlineData(2, -3, "none", true, EntitlementReason.Allowed)]
    [InlineData(3, -1, "none", false, EntitlementReason.SubscriptionPastDueForWrite)]
    [InlineData(4, -2, "none", false, EntitlementReason.SubscriptionExpired)]
    [InlineData(5, -9, "none", false, EntitlementReason.SubscriptionCanceled)]
    [InlineData(6, -9, "none", false, EntitlementReason.SubscriptionSuspended)]
    [InlineData(0, -9, "none", false, EntitlementReason.SubscriptionMissing)] // an unknown status fails closed
    [InlineData(null, 0, "none", false, EntitlementReason.SubscriptionMissing)]
    [InlineData(4, -2, "active", true, EntitlementReason.Allowed)]
    [InlineData(4, -2, "ended", false, EntitlementReason.SubscriptionExpired)]
    [InlineData(4, -2, "not-started", false, EntitlementReason.SubscriptionExpired)]
    [InlineData(null, 0, "active", true, EntitlementReason.Allowed)]
    [InlineData(5, -9, "active", true, EntitlementReason.Allowed)]
    public async Task Enforcement_on_decides_exactly_as_before(int? status, int validUntilDays, string extension, bool allowed, EntitlementReason reason)
    {
        var farm = new FarmSetup(AppRole.PrimaryOwner, status, validUntilDays, extension);

        var decision = await farm.Policy(enforce: true).EvaluateAsync(farm.Caller, farm.FarmId, PaidFeature.EditFinance);

        decision.Should().Be(new EntitlementDecision(allowed, reason, status));
    }

    // ── the policy, enforcement OFF (the pilot): no time limit ────────────────────────────────────────────────────

    [Theory]
    [InlineData(1, 5, "none", true, EntitlementReason.Allowed)] // a trial still running is simply allowed
    [InlineData(2, 30, "none", true, EntitlementReason.Allowed)]
    [InlineData(1, -3, "none", true, EntitlementReason.Pilot)] // past its end: open only because of the pilot, and it says so
    [InlineData(2, -3, "none", true, EntitlementReason.Pilot)]
    [InlineData(3, -1, "none", true, EntitlementReason.Pilot)]
    [InlineData(4, -2, "none", true, EntitlementReason.Pilot)]
    [InlineData(null, 0, "none", true, EntitlementReason.Pilot)]
    [InlineData(4, -2, "ended", true, EntitlementReason.Pilot)] // the extension's end date (31 Dec) closes nothing
    [InlineData(4, -2, "not-started", true, EntitlementReason.Pilot)]
    [InlineData(4, -2, "active", true, EntitlementReason.Pilot)]
    [InlineData(5, -9, "none", false, EntitlementReason.SubscriptionCanceled)] // an act, not a date: unchanged
    [InlineData(6, -9, "none", false, EntitlementReason.SubscriptionSuspended)]
    [InlineData(5, -9, "active", true, EntitlementReason.Allowed)] // the extension rule itself is unchanged
    [InlineData(0, -9, "none", false, EntitlementReason.SubscriptionMissing)] // an unknown status still fails closed
    public async Task Enforcement_off_has_no_time_limit_and_says_when_the_pilot_is_what_allows(
        int? status, int validUntilDays, string extension, bool allowed, EntitlementReason reason)
    {
        var farm = new FarmSetup(AppRole.PrimaryOwner, status, validUntilDays, extension);

        var decision = await farm.Policy(enforce: false).EvaluateAsync(farm.Caller, farm.FarmId, PaidFeature.EditFinance);

        decision.Should().Be(new EntitlementDecision(allowed, reason, status), "the subscription's real status is reported, never pretended current");
    }

    [Theory]
    [InlineData(PaidFeature.CreatePlot)]
    [InlineData(PaidFeature.WriteDailyLog)]
    [InlineData(PaidFeature.RunVerification)]
    [InlineData(PaidFeature.EditFinance)]
    [InlineData(PaidFeature.AiParse)]
    [InlineData(PaidFeature.OwnerSyncPush)]
    [InlineData(PaidFeature.MisRead)]
    public async Task Enforcement_off_opens_every_paid_feature_of_an_expired_farm_for_owner_and_worker_alike(PaidFeature feature)
    {
        foreach (var role in new[] { AppRole.PrimaryOwner, AppRole.Worker })
        {
            var farm = new FarmSetup(role, status: 4, validUntilDays: -30, extension: "none");

            (await farm.Policy(enforce: false).EvaluateAsync(farm.Caller, farm.FarmId, feature)).Allowed.Should().BeTrue($"{role} / {feature}");
            (await farm.Policy(enforce: true).EvaluateAsync(farm.Caller, farm.FarmId, feature)).Allowed.Should().BeFalse($"{role} / {feature}");
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Membership_is_untouched_by_the_switch(bool enforce)
    {
        var farm = new FarmSetup(AppRole.PrimaryOwner, status: 4, validUntilDays: -2, extension: "none");
        var policy = farm.Policy(enforce);

        (await policy.EvaluateAsync(new UserId(Guid.NewGuid()), farm.FarmId, PaidFeature.EditFinance))
            .Should().Be(new EntitlementDecision(false, EntitlementReason.NoMembership, null), "a stranger is still a stranger");
        (await policy.EvaluateAsync(new UserId(Guid.Empty), farm.FarmId, PaidFeature.EditFinance))
            .Should().Be(new EntitlementDecision(false, EntitlementReason.NoMembership, null));
        (await policy.EvaluateAsync(farm.Caller, new FarmId(Guid.Empty), PaidFeature.EditFinance))
            .Should().Be(new EntitlementDecision(false, EntitlementReason.NoMembership, null));
        (await policy.EvaluateAsync(farm.Caller, farm.FarmId, PaidFeature.WorkerSyncPush))
            .Should().Be(new EntitlementDecision(true, EntitlementReason.Allowed, null), "worker-basic features never read the subscription");
        farm.Reader.SubscriptionReads.Should().Be(0);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task A_farm_with_no_owner_account_is_refused_in_both_modes(bool enforce)
    {
        var farm = new FarmSetup(AppRole.PrimaryOwner, status: 1, validUntilDays: 5, extension: "none", attachOwnerAccount: false);

        (await farm.Policy(enforce).EvaluateAsync(farm.Caller, farm.FarmId, PaidFeature.EditFinance))
            .Should().Be(new EntitlementDecision(false, EntitlementReason.SubscriptionMissing, null));
    }

    [Fact]
    public async Task A_pilot_decision_is_an_allow_through_the_one_gate_and_never_a_refusal_code()
    {
        var policy = new FixedPolicy(new EntitlementDecision(true, EntitlementReason.Pilot, 4));

        (await EntitlementGate.CheckErrorAsync(policy, new UserId(Guid.NewGuid()), new FarmId(Guid.NewGuid()), PaidFeature.AiParse, CancellationToken.None))
            .Should().BeNull();
    }

    [Fact]
    public void Pilot_is_appended_last_so_no_earlier_reason_changes_its_number()
    {
        ((int)EntitlementReason.Allowed).Should().Be(0);
        ((int)EntitlementReason.SubscriptionSuspended).Should().Be(6);
        ((int)EntitlementReason.Pilot).Should().Be(7);
        Enum.GetValues<EntitlementReason>().Max().Should().Be(EntitlementReason.Pilot);
    }

    // ── the setting ──────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_setting_is_off_by_default_and_KeepsOpen_is_false_whenever_enforcement_is_on()
    {
        new PilotOptions().TrialEnforcementEnabled.Should().BeFalse();
        PilotOptions.SectionName.Should().Be("Pilot");

        var pilot = new PilotOptions { TrialEnforcementEnabled = false };
        foreach (var open in new int?[] { null, 1, 2, 3, 4 })
        {
            pilot.KeepsOpen(open).Should().BeTrue($"status {open?.ToString() ?? "none"}");
        }

        foreach (var closed in new int?[] { 0, 5, 6, 7 })
        {
            pilot.KeepsOpen(closed).Should().BeFalse($"status {closed}");
        }

        var enforced = new PilotOptions { TrialEnforcementEnabled = true };
        foreach (var any in new int?[] { null, 0, 1, 2, 3, 4, 5, 6 })
        {
            enforced.KeepsOpen(any).Should().BeFalse();
        }
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("true", true)]
    [InlineData("True", true)]
    public void The_server_reads_Pilot_TrialEnforcementEnabled_through_its_own_registration(string? value, bool expected)
    {
        using var provider = new ServiceCollection()
            .AddShramSafalInfrastructure(Config(("Pilot:TrialEnforcementEnabled", value)))
            .BuildServiceProvider();

        provider.GetRequiredService<IOptions<PilotOptions>>().Value.TrialEnforcementEnabled.Should().Be(expected);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void Live_words_are_off_unless_Sarvam_LiveWordsEnabled_turns_them_on_and_keyterms_stay_on(string? value, bool expected)
    {
        new SarvamOptions().LiveWordsEnabled.Should().BeFalse("founder 28 Nov 2026: no live words for the pilot");
        new SarvamOptions().SttKeytermsEnabled.Should().BeTrue("the product-name hints to Sarvam stay");

        using var provider = new ServiceCollection()
            .AddShramSafalInfrastructure(Config(("Sarvam:LiveWordsEnabled", value)))
            .BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<SarvamOptions>>().Value;

        options.LiveWordsEnabled.Should().Be(expected);
        options.SttKeytermsEnabled.Should().BeTrue();
    }

    public static IEnumerable<object[]> AllFourSettingsFiles() =>
    [
        ["appsettings.json"],
        ["appsettings.Production.json"],
        ["appsettings.Development.json"],
        ["appsettings.Development.example.json"],
    ];

    [Theory]
    [MemberData(nameof(AllFourSettingsFiles))]
    public void Every_shipped_settings_file_says_pilot_mode_and_no_live_words_in_the_right_section(string file)
    {
        var settings = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(BootstrapperDirectory(), file), optional: false, reloadOnChange: false)
            .Build();

        bool.Parse(settings["Pilot:TrialEnforcementEnabled"]!).Should().BeFalse();
        bool.Parse(settings["Sarvam:LiveWordsEnabled"]!).Should().BeFalse();
        settings["TrialEnforcementEnabled"].Should().BeNull("a value under the wrong parent is silently ignored");
        settings["LiveWordsEnabled"].Should().BeNull();
        settings["Sarvam:SttKeytermsEnabled"].Should().BeNull("keyterms keep their code default (on)");
    }

    // ── /shramsafal/farms/mine says what the gate will do ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(4, false, true)]
    [InlineData(4, true, false)]
    [InlineData(3, false, true)]
    [InlineData(3, true, false)]
    [InlineData(5, false, false)]
    [InlineData(6, false, false)]
    [InlineData(1, true, true)]
    public async Task My_farms_tells_the_phone_what_the_gate_will_do(int status, bool enforce, bool allowsOwnerWrites)
    {
        var farm = new FarmSetup(AppRole.PrimaryOwner, status, validUntilDays: -2, extension: "none");
        var handler = new GetMyFarmsHandler(farm.Repository, farm.Reader, new FixedClock(Now), Options.Create(new PilotOptions { TrialEnforcementEnabled = enforce }));

        var result = await handler.HandleAsync(new GetMyFarmsCommand(farm.Caller));

        result.IsSuccess.Should().BeTrue();
        var snapshot = result.Value!.Farms.Single().Subscription!;
        snapshot.AllowsOwnerWrites.Should().Be(allowsOwnerWrites);
        snapshot.StatusCode.Should().Be(status, "the status itself is reported as it is");
        snapshot.AccessExtendedUntilUtc.Should().BeNull();
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

    private static string BootstrapperDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AgriSync.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "AgriSync.Bootstrapper");
    }

    private static IConfiguration Config((string Key, string? Value) setting)
    {
        var values = new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = "Host=127.0.0.1;Port=1;Database=none;Username=none",
        };
        if (setting.Value is not null)
        {
            values[setting.Key] = setting.Value;
        }

        return new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    }

    /// <summary>One farm, its caller's seat, the owner account's subscription row (or none) and its access extension.</summary>
    private sealed class FarmSetup
    {
        public FarmSetup(AppRole role, int? status, int validUntilDays, string extension, bool attachOwnerAccount = true)
        {
            FarmId = new FarmId(Guid.NewGuid());
            Caller = new UserId(Guid.NewGuid());
            var account = new OwnerAccountId(Guid.NewGuid());
            var farm = Farm.Create(FarmId, "Pilot Farm", role == AppRole.PrimaryOwner ? Caller : new UserId(Guid.NewGuid()), Now.AddDays(-60));
            if (attachOwnerAccount)
            {
                farm.AttachToOwnerAccount(account, Now.AddDays(-60));
            }

            Repository = new OneFarmRepository(farm, Caller, role, account);
            var sub = status is { } s ? Projection<SubscriptionProjection>(
                ("SubscriptionId", new SubscriptionId(Guid.NewGuid())), ("OwnerAccountId", account), ("PlanCode", "shramsafal_pro"),
                ("Status", s), ("ValidFromUtc", Now.AddDays(-60)), ("ValidUntilUtc", Now.AddDays(validUntilDays)),
                ("TrialEndsAtUtc", (DateTime?)Now.AddDays(validUntilDays)), ("CreatedAtUtc", Now.AddDays(-60)), ("UpdatedAtUtc", Now.AddDays(-1))) : null;
            var ext = extension switch
            {
                "active" => Extension(account, Now.AddDays(-1), Now.AddDays(10)),
                "ended" => Extension(account, Now.AddDays(-20), Now.AddDays(-1)),
                "not-started" => Extension(account, Now.AddDays(1), Now.AddDays(30)),
                _ => null,
            };
            Reader = new FakeSubscriptionReader(account, sub, ext);
        }

        public FarmId FarmId { get; }
        public UserId Caller { get; }
        public OneFarmRepository Repository { get; }
        public FakeSubscriptionReader Reader { get; }

        public DefaultEntitlementPolicy Policy(bool enforce) =>
            new(Repository, Reader, new FixedClock(Now), Options.Create(new PilotOptions { TrialEnforcementEnabled = enforce }));

        private static AccessExtensionProjection Extension(OwnerAccountId account, DateTime starts, DateTime ends) =>
            Projection<AccessExtensionProjection>(
                ("AccessExtensionId", Guid.NewGuid()), ("OwnerAccountId", account), ("Reason", "pilot-extension-2026-10"),
                ("StartsAtUtc", starts), ("EndsAtUtc", ends), ("GrantedByUserId", Guid.NewGuid()), ("CreatedAtUtc", starts));
    }

    /// <summary>The two projections are EF read shapes with private setters; a test builds one the way EF does.</summary>
    private static T Projection<T>(params (string Name, object? Value)[] values) where T : class
    {
        var instance = (T)Activator.CreateInstance(typeof(T), nonPublic: true)!;
        foreach (var (name, value) in values)
        {
            typeof(T).GetProperty(name, BindingFlags.Public | BindingFlags.Instance)!.SetValue(instance, value);
        }

        return instance;
    }

    private sealed class OneFarmRepository(Farm farm, UserId caller, AppRole role, OwnerAccountId account)
        : FakeShramSafalRepository, IShramSafalRepository
    {
        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<AppRole?>(farmId == (Guid)farm.Id && userId == caller.Value ? role : null);

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult<Farm?>(farmId == (Guid)farm.Id ? farm : null);

        public Task<List<MyFarmProjection>> GetMyFarmsAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(userId == caller.Value
                ? new List<MyFarmProjection> { new((Guid)farm.Id, farm.Name, "ABC123", account.Value, role) }
                : new List<MyFarmProjection>());
    }

    private sealed class FakeSubscriptionReader(OwnerAccountId account, SubscriptionProjection? subscription, AccessExtensionProjection? extension)
        : ISubscriptionReader
    {
        public int SubscriptionReads { get; private set; }

        public Task<SubscriptionProjection?> GetByOwnerAccountAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default)
        {
            SubscriptionReads++;
            return Task.FromResult(ownerAccountId == account ? subscription : null);
        }

        public Task<AccessExtensionProjection?> GetActiveAccessExtensionAsync(OwnerAccountId ownerAccountId, DateTime asOfUtc, CancellationToken ct = default) =>
            Task.FromResult(ownerAccountId == account && extension is not null && extension.IsActiveAt(asOfUtc) ? extension : null);
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow => now;
    }

    private sealed class FixedPolicy(EntitlementDecision decision) : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(decision);
    }
}
