using Accounts.Application.EventHandlers;
using Accounts.Application.Ports;
using Accounts.Domain.Affiliation;
using Accounts.Domain.Subscriptions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.Regression;

/// <summary>Spec §9 regression: referral qualification creates exactly one BenefitLedgerEntry (I11 de-dup).</summary>
public sealed class ReferralQualificationTests
{
    private readonly FakeAffiliationRepo _affiliationRepo = new();
    private readonly FakeSubRepo _subRepo = new();
    private readonly SequentialIdGenerator _ids;
    private readonly FixedClock _clock = new(DateTime.UtcNow);

    public ReferralQualificationTests()
    {
        _ids = new SequentialIdGenerator([Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()]);
    }

    private ReferralQualificationHandler Handler =>
        new(_affiliationRepo, _subRepo, _ids, _clock);

    [Fact]
    public async Task Qualification_Creates_Exactly_One_GrowthEvent_And_Benefit()
    {
        var referrerAccount = new OwnerAccountId(Guid.NewGuid());
        var referredAccount = new OwnerAccountId(Guid.NewGuid());
        var relationship = SeedPendingRelationship(referrerAccount, referredAccount);
        _subRepo.SeedActiveSubscription(referredAccount);

        await Handler.HandleAsync(referredAccount);

        Assert.Equal(1, _affiliationRepo.GrowthEventsAdded);
        Assert.Equal(1, _affiliationRepo.BenefitsAdded);
        Assert.Equal(ReferralRelationshipStatus.Qualified, relationship.Status);
    }

    [Fact]
    public async Task Qualification_Is_Idempotent_On_Duplicate_Call()
    {
        var referrerAccount = new OwnerAccountId(Guid.NewGuid());
        var referredAccount = new OwnerAccountId(Guid.NewGuid());
        SeedPendingRelationship(referrerAccount, referredAccount);
        _subRepo.SeedActiveSubscription(referredAccount);

        await Handler.HandleAsync(referredAccount);
        // Second call — GrowthEventExists returns true, nothing should be added.
        _affiliationRepo.SimulateExistingEvent = true;
        await Handler.HandleAsync(referredAccount);

        Assert.Equal(1, _affiliationRepo.GrowthEventsAdded); // not 2
    }

    [Fact]
    public async Task Qualification_Skipped_When_No_ActiveSubscription()
    {
        var referredAccount = new OwnerAccountId(Guid.NewGuid());
        var referrerAccount = new OwnerAccountId(Guid.NewGuid());
        SeedPendingRelationship(referrerAccount, referredAccount);
        // No subscription seeded.

        await Handler.HandleAsync(referredAccount);

        Assert.Equal(0, _affiliationRepo.GrowthEventsAdded);
    }

    private ReferralRelationship SeedPendingRelationship(OwnerAccountId referrer, OwnerAccountId referred)
    {
        var rel = new ReferralRelationship(
            new ReferralRelationshipId(Guid.NewGuid()),
            referrer, referred,
            new ReferralCodeId(Guid.NewGuid()),
            DateTime.UtcNow);
        _affiliationRepo.Relationship = rel;
        return rel;
    }

    // --- Fakes ---

    private sealed class FakeAffiliationRepo : IAffiliationRepository
    {
        public ReferralRelationship? Relationship { get; set; }
        public bool SimulateExistingEvent { get; set; }
        public int GrowthEventsAdded { get; private set; }
        public int BenefitsAdded { get; private set; }

        public Task<ReferralRelationship?> GetByReferredAccountAsync(OwnerAccountId id, CancellationToken ct = default)
            => Task.FromResult(Relationship);
        public Task<bool> GrowthEventExistsAsync(GrowthEventType t, Guid refId, CancellationToken ct = default)
            => Task.FromResult(SimulateExistingEvent);
        public Task AddGrowthEventAsync(GrowthEvent e, CancellationToken ct = default)
        { GrowthEventsAdded++; return Task.CompletedTask; }
        public Task AddBenefitLedgerEntryAsync(BenefitLedgerEntry b, CancellationToken ct = default)
        { BenefitsAdded++; return Task.CompletedTask; }
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // Unused for this test suite
        public Task<ReferralCode?> GetActiveCodeByOwnerAccountAsync(OwnerAccountId id, CancellationToken ct = default) => Task.FromResult<ReferralCode?>(null);
        public Task<ReferralCode?> GetActiveCodeByValueAsync(string code, CancellationToken ct = default) => Task.FromResult<ReferralCode?>(null);
        public Task AddReferralCodeAsync(ReferralCode code, CancellationToken ct = default) => Task.CompletedTask;
        public Task<bool> ReferralRelationshipExistsAsync(OwnerAccountId id, CancellationToken ct = default) => Task.FromResult(false);
        public Task AddReferralRelationshipAsync(ReferralRelationship r, CancellationToken ct = default) => Task.CompletedTask;
        public Task<List<ReferralRelationship>> GetPendingByReferrerAsync(OwnerAccountId id, CancellationToken ct = default) => Task.FromResult(new List<ReferralRelationship>());
        public Task<List<GrowthEvent>> GetGrowthEventsForOwnerAsync(OwnerAccountId id, int limit, CancellationToken ct = default) => Task.FromResult(new List<GrowthEvent>());
        public Task<List<BenefitLedgerEntry>> GetBenefitEntriesForOwnerAsync(OwnerAccountId id, CancellationToken ct = default) => Task.FromResult(new List<BenefitLedgerEntry>());
        public Task<(int, int, int)> GetAffiliationStatsAsync(OwnerAccountId id, CancellationToken ct = default) => Task.FromResult((0, 0, 0));
    }

    private sealed class FakeSubRepo : ISubscriptionRepository
    {
        private Subscription? _sub;
        public void SeedActiveSubscription(OwnerAccountId id)
        {
            _sub = Subscription.StartTrial(
                new SubscriptionId(Guid.NewGuid()), id,
                "shramsafal_pro", DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(13));
        }
        public Task<Subscription?> GetCurrentAsync(OwnerAccountId id, CancellationToken ct = default)
            => Task.FromResult(_sub);
        public Task AddAsync(Subscription s, CancellationToken ct = default) => Task.CompletedTask;
        public Task<Subscription?> GetByIdAsync(SubscriptionId id, CancellationToken ct = default) => Task.FromResult<Subscription?>(null);
        public Task<bool> WebhookEventExistsAsync(string id, CancellationToken ct = default) => Task.FromResult(false);
        public Task AddWebhookEventAsync(SubscriptionWebhookEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task<List<Subscription>> GetNonTerminalExpiredAsync(DateTime asOf, CancellationToken ct = default) => Task.FromResult(new List<Subscription>());
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class SequentialIdGenerator(Guid[] ids) : IIdGenerator
    {
        private int _i = 0;
        public Guid New() => ids[_i++ % ids.Length];
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }
}
