using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.ApproveCostEntry;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// spec: plr-d10-founder-answers-2026-11-23 — the founder's answers on his final approval page (23 Nov 2026).
/// <list type="bullet">
///   <item>arve-owner-bills: "25000 चा नियम काढून टाक प्रत्येक बिल तपासले गेले पाहिजे" — remove the ₹25,000 rule, every bill
///   is checked. Every bill waits for a reviewer on its first save, whatever its amount, the owner's own bill too (his one tap:
///   an automatic stamp would be a check that never happened, P4). Money that comes IN (a sale) is not a bill and keeps the
///   rule it had.</item>
///   <item>C3 = C: nobody approves his own bill; the owner (primary account holder) may. A switch per farm comes after 3 December.</item>
/// </list>
/// The real-Postgres halves (the push, the edit's money, the approve door) are in ShramSafal.Sync.IntegrationTests
/// (<c>BillApprovalRealPostgresTests</c>, <c>EditMoneyRealPostgresTests</c>).
/// </summary>
public sealed class EveryBillIsCheckedTests
{
    private static readonly Guid FarmA = Guid.Parse("aaaaaaaa-0000-0000-0000-0000000000f1");
    private static readonly Guid Owner = Guid.Parse("11111111-0000-0000-0000-0000000000f1");
    private static readonly Guid Mukadam = Guid.Parse("22222222-0000-0000-0000-0000000000f2");

    [Theory]
    [InlineData("owner", null)]
    [InlineData("owner", MoneyDirection.Expense)]
    [InlineData("mukadam", MoneyDirection.Expense)]
    public async Task SmallBill_IsSetAsideForChecking(string who, MoneyDirection? direction)
    {
        var repo = new Repo();
        var creator = who == "owner" ? Owner : Mukadam;

        var result = await Handler(repo).HandleAsync(Command(creator, 120m, direction));

        result.IsSuccess.Should().BeTrue();
        var saved = repo.Added.Should().ContainSingle().Subject;
        saved.IsFlagged.Should().BeTrue("every bill is checked, ₹120 too, and the owner's own bill waits for his one tap");
        saved.FlagReason.Should().Be(CostEntry.EveryBillReviewReason);
        CostEntryReview.NeedsReview(saved, []).Should().BeTrue("तपासायचे until someone approves it");
    }

    [Fact]
    public async Task A_big_bill_is_set_aside_under_the_new_rule_too()
    {
        var repo = new Repo();

        await Handler(repo).HandleAsync(Command(Owner, 31234.56m, MoneyDirection.Expense));

        repo.Added.Single().FlagReason.Should().Be(CostEntry.EveryBillReviewReason, "one rule now, whatever the amount");
    }

    [Theory]
    [InlineData(600, false)]
    [InlineData(25000, true)]
    public async Task Money_that_comes_in_is_not_a_bill_and_keeps_the_amount_rule_it_had(int amount, bool setAside)
    {
        var repo = new Repo();

        await Handler(repo).HandleAsync(Command(Owner, amount, MoneyDirection.Income));

        var saved = repo.Added.Single();
        saved.IsFlagged.Should().Be(setAside);
        saved.FlagReason.Should().Be(setAside ? CostEntry.ReviewAmountReason : null);
    }

    [Fact]
    public void The_rule_in_one_place_and_the_old_reason_stays_readable_for_rows_already_saved()
    {
        CostEntry.ReviewReasonFor(1m, MoneyDirection.Expense).Should().Be(CostEntry.EveryBillReviewReason);
        CostEntry.ReviewReasonFor(1m, null).Should().Be(CostEntry.EveryBillReviewReason);
        CostEntry.ReviewReasonFor(0m, MoneyDirection.Expense).Should().Be(CostEntry.EveryBillReviewReason, "a bill corrected to nothing is checked too");
        CostEntry.ReviewReasonFor(24999.99m, MoneyDirection.Income).Should().BeNull();
        CostEntry.ReviewReasonFor(25000m, MoneyDirection.Income).Should().Be(CostEntry.ReviewAmountReason);
        CostEntry.ReviewAmountReason.Should().Be("High amount: >= 25000 INR", "rows already saved carry it; they are never rewritten");
        CostEntry.EveryBillReviewReason.Should().Be("Every bill is checked");
    }

    [Fact]
    public void ReviewerOwnBill_rule_nobody_approves_his_own_bill_the_owner_may()
    {
        BillApprovalRules.ReviewerMayApproveOwnBill.Should().BeFalse("founder C3 = C: for now it works like A");
        BillApprovalRules.MayApproveOwnBill(isPrimaryAccountHolder: false, isMaker: true).Should().BeFalse("a reviewer's own bill needs someone else");
        BillApprovalRules.MayApproveOwnBill(isPrimaryAccountHolder: true, isMaker: true).Should().BeTrue("the owner may approve his own bill");
        BillApprovalRules.MayApproveOwnBill(isPrimaryAccountHolder: false, isMaker: false).Should().BeTrue("a reviewer approves someone else's bill");
    }

    // ---- helpers ----

    private static AddCostEntryCommand Command(Guid creator, decimal amount, MoneyDirection? direction) => new(
        FarmId: FarmA, PlotId: null, CropCycleId: null, CategoryId: "fertilizer", Description: "बिल",
        Amount: amount, CurrencyCode: "INR", EntryDate: new DateOnly(2026, 11, 20), CreatedByUserId: creator,
        CostEntryId: Guid.NewGuid(), ActorRole: "owner", Direction: direction);

    private static AddCostEntryHandler Handler(Repo repo) => new(
        repo, new IdGen(), new FixedClock(), new AllowAll(), new NoopAnalytics(), new NoAiJobs());

    private sealed class Repo : FakeShramSafalRepository, IShramSafalRepository
    {
        public List<CostEntry> Added { get; } = new();

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult<Farm?>(Farm.Create(new FarmId(farmId), "शेत", new UserId(Owner), new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(userId == Owner || userId == Mukadam);
        Task<CostEntry?> IShramSafalRepository.FindCostEntryForReplayAsync(Guid costEntryId, CancellationToken ct) =>
            Task.FromResult<CostEntry?>(null);
        public override Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) { Added.Add(costEntry); return Task.CompletedTask; }
        public override Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) =>
            Task.FromResult(new List<CostEntry>());
        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => Task.CompletedTask;
        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AllowAll : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class FixedClock : IClock { public DateTime UtcNow => new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc); }
    private sealed class IdGen : IIdGenerator { public Guid New() => Guid.NewGuid(); }
    private sealed class NoopAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
    private sealed class NoAiJobs : IAiJobRepository
    {
        private static NotSupportedException Unused() => new("no AiJob on this path");
        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => throw Unused();
        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw Unused();
        public Task AddAsync(AiJob job, CancellationToken ct = default) => throw Unused();
        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => throw Unused();
        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => throw Unused();
        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => throw Unused();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw Unused();
        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) => throw Unused();
        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw Unused();
        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw Unused();
    }
}
