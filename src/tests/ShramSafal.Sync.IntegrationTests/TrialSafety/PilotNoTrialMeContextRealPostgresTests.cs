// spec: plr-d10 pilot lane NO-TRIAL (CTO ruling, 28 Nov 2026: nothing about the trial applies during the pilot)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Application.UseCases.Users.GetMeContext;
using Xunit;
using Xunit.Abstractions;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// <c>/me/context</c>'s plan alerts on real Postgres as the app role: the REAL <see cref="FarmMembershipSnapshotReader"/> (the production
/// query, RLS on, reading the subscription from accounts.subscriptions) fed to the REAL <see cref="GetMeContextHandler"/> with the REAL
/// <see cref="PilotTrialEnforcementReader"/> over <see cref="PilotOptions"/>, in both modes. Only the user lookup, the accounts and the
/// referral readers are fixed (they decide no alert).
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PilotNoTrialMeContextRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>
{
    [Theory]
    [InlineData(1, 3)] // a trial ending in 3 days: "प्लॅन 3 दिवसांत संपेल"
    [InlineData(3, 4)] // PastDue
    public async Task Switch_off_no_plan_alert_switch_on_the_same_alert_as_before(int status, int daysToEnd)
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (farm, owner) = await SeedFarmAsync(status, DateTime.UtcNow.AddDays(daysToEnd));

        var on = await MeContextAsync(owner, enforce: true);
        var off = await MeContextAsync(owner, enforce: false);
        output.WriteLine($"[EVIDENCE] status {status}: on={string.Join(",", on.Alerts.Select(a => a.Kind))} off={string.Join(",", off.Alerts.Select(a => a.Kind))}");

        on.Alerts.Should().ContainSingle(a => a.FarmId == farm && a.Kind == "plan_expiring" && a.DaysLeft == daysToEnd, "control: the commercial rules warn");
        off.Alerts.Should().NotContain(a => a.Kind == "plan_expiring" || a.Kind == "plan_expired", "the pilot warns no one");
        off.Farms.Single(f => f.FarmId == farm).Plan.Should().Be(on.Farms.Single(f => f.FarmId == farm).Plan, "only the alert changes");
    }

    /// <summary>
    /// SOURCE PIN, not a behaviour test: Program.cs cannot be started cheaply, so this reads it and checks the production host registers
    /// the reader (without it the handler keeps today's alerts, which is the behaviour of every test host that builds without Program.cs).
    /// </summary>
    [Fact]
    public void The_production_host_hands_the_pilot_switch_to_me_context_source_pin()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "AgriSync.sln")))
        {
            dir = dir.Parent;
        }

        dir.Should().NotBeNull();
        var program = File.ReadAllText(Path.Combine(dir!.FullName, "AgriSync.Bootstrapper", "Program.cs"));
        program.Should().MatchRegex(
            @"\n\s*builder\.Services\.AddSingleton<User\.Application\.Ports\.ITrialEnforcementReader,\s*AgriSync\.Bootstrapper\.Adapters\.PilotTrialEnforcementReader>\(\);");
    }

    // ── helpers ──

    private async Task<(Guid Farm, Guid Owner)> SeedFarmAsync(int status, DateTime validUntilUtc)
    {
        var farm = Guid.NewGuid();
        var account = Guid.NewGuid();
        var owner = Guid.NewGuid();
        await db.SeedAccountAsync(account, owner, farm);
        await db.SeedFarmAsync(farm, owner, account, ShramSafal.Domain.Farms.FarmCode.New());
        await db.SeedSubscriptionAsync(account, status, validUntilUtc);
        return (farm, owner);
    }

    private async Task<MeContextDto> MeContextAsync(Guid who, bool enforce)
    {
        await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(db.AppConn).Options);
        await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(db.AppConn).Options);
        var user = DomainUser.RegisterViaOtp(new UserId(who), DomainPhone.Create("9876500011"), "Pilot Probe", "unusable", DateTime.UtcNow);
        var handler = new GetMeContextHandler(
            new OneUser(user),
            new NoAccounts(),
            new FarmMembershipSnapshotReader(ssf, accounts, new UtcClock()),
            new NoAffiliation(),
            new UtcClock(),
            trialEnforcement: new PilotTrialEnforcementReader(Options.Create(new PilotOptions { TrialEnforcementEnabled = enforce })));

        var result = await handler.HandleAsync(new UserId(who));
        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : null);
        return result.Value!;
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
