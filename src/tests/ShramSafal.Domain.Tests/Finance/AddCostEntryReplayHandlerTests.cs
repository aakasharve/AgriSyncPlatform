using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// spec: pre-launch-repair L2b (R-1; founder D-41 phase A "server-side duplicate prevention so double taps,
/// retries and reconnection cannot create the same purchase or payment twice"). The phone now derives a money
/// entry's id from its source, so a repeat re-sends the SAME id. The handler's rule:
/// <list type="bullet">
///   <item>same id, same farm, same person → the STORED entry, as success; nothing written, nothing audited;</item>
///   <item>same id, another farm or another person → <c>ShramSafal.CostEntry.Conflict</c>; nothing written;</item>
///   <item>a new id (every older APK's random id) → saved exactly as before.</item>
/// </list>
/// The real-Postgres half (FORCE RLS, two pushes → one row, the cross-farm primary-key path) is
/// <c>ShramSafal.Sync.IntegrationTests/Finance/AddCostEntryIdentityRealPostgresTests</c>.
/// </summary>
public sealed class AddCostEntryReplayHandlerTests
{
    private static readonly Guid FarmA = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002");
    private static readonly Guid Owner = Guid.Parse("11111111-0000-0000-0000-000000000001");
    private static readonly Guid Mukadam = Guid.Parse("22222222-0000-0000-0000-000000000002");
    private static readonly Guid EntryId = Guid.Parse("cc8e3180-4f63-5f29-b0cd-4d641ae7228b");

    [Fact]
    public async Task A_repeat_of_a_stored_id_from_the_same_farm_and_person_is_answered_with_the_stored_entry()
    {
        var repo = new Repo();
        repo.Stored = StoredEntry(FarmA, Owner, amount: 600m);

        var result = await Handler(repo).HandleAsync(Command(FarmA, Owner, amount: 999m));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Entry.Id.Should().Be(EntryId);
        result.Value.Entry.Amount.Should().Be(600m, "the stored entry wins — a repeat never rewrites money");
        result.Value.IsPotentialDuplicate.Should().BeFalse();
        repo.Added.Should().BeEmpty();
        repo.Audits.Should().BeEmpty();
        repo.Saves.Should().Be(0);
    }

    [Fact]
    public async Task The_answer_does_not_wait_on_the_plan_gate_the_entry_is_already_saved()
    {
        var repo = new Repo();
        repo.Stored = StoredEntry(FarmA, Owner, amount: 600m);

        var repeat = await Handler(repo, allowWrites: false).HandleAsync(Command(FarmA, Owner, amount: 600m));
        repeat.IsSuccess.Should().BeTrue();

        repo.Stored = null;
        var fresh = await Handler(repo, allowWrites: false).HandleAsync(Command(FarmA, Owner, amount: 600m));
        fresh.IsSuccess.Should().BeFalse("a NEW entry still needs the plan, exactly as before");
        repo.Added.Should().BeEmpty();
    }

    [Theory]
    [InlineData("another farm")]
    [InlineData("another person")]
    public async Task The_same_id_from_another_farm_or_person_is_the_typed_conflict_and_nothing_is_written(string who)
    {
        var repo = new Repo();
        repo.Stored = who == "another farm" ? StoredEntry(FarmB, Owner, 600m) : StoredEntry(FarmA, Mukadam, 600m);

        var result = await Handler(repo).HandleAsync(Command(FarmA, Owner, amount: 600m));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.CostEntry.Conflict");
        result.Error.Should().Be(ShramSafalErrors.CostEntryIdConflict);
        repo.Added.Should().BeEmpty();
        repo.Audits.Should().BeEmpty();
    }

    [Fact]
    public async Task A_new_id_is_saved_exactly_as_before()
    {
        var repo = new Repo();

        var result = await Handler(repo).HandleAsync(Command(FarmA, Owner, amount: 600m));

        result.IsSuccess.Should().BeTrue();
        repo.Added.Should().ContainSingle().Which.Id.Should().Be(EntryId);
        repo.Audits.Should().ContainSingle();
        repo.Saves.Should().Be(1);
    }

    // ---- helpers ----

    private static CostEntry StoredEntry(Guid farmId, Guid creator, decimal amount) => CostEntry.Create(
        EntryId, new FarmId(farmId), null, null, "fertilizer", "bill-1:line-1", amount, "INR",
        new DateOnly(2026, 10, 20), new UserId(creator), null, new DateTime(2026, 10, 20, 8, 0, 0, DateTimeKind.Utc));

    private static AddCostEntryCommand Command(Guid farmId, Guid creator, decimal amount) => new(
        FarmId: farmId, PlotId: null, CropCycleId: null, CategoryId: "fertilizer", Description: "bill-1:line-1",
        Amount: amount, CurrencyCode: "INR", EntryDate: new DateOnly(2026, 10, 20), CreatedByUserId: creator,
        CostEntryId: EntryId, ActorRole: "owner", ClientCommandId: $"add_cost_entry:{EntryId}");

    private static AddCostEntryHandler Handler(Repo repo, bool allowWrites = true) => new(
        repo, new FixedIdGenerator(), new FixedClock(), new Entitlements(allowWrites), new NoopAnalytics(), new NoAiJobs());

    /// <summary>Farm A (Owner, Mukadam) and farm B (Owner); one optionally stored entry.</summary>
    private sealed class Repo : FakeShramSafalRepository, IShramSafalRepository
    {
        public CostEntry? Stored { get; set; }
        public List<CostEntry> Added { get; } = new();
        public List<AuditEvent> Audits { get; } = new();
        public int Saves { get; private set; }

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult<Farm?>(Farm.Create(new FarmId(farmId), "शेत", new UserId(Owner), new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(userId == Owner || (farmId == FarmA && userId == Mukadam));
        Task<CostEntry?> IShramSafalRepository.FindCostEntryForReplayAsync(Guid costEntryId, CancellationToken ct) =>
            Task.FromResult(Stored is not null && Stored.Id == costEntryId ? Stored : null);
        public override Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) { Added.Add(costEntry); return Task.CompletedTask; }
        public override Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) =>
            Task.FromResult(new List<CostEntry>());
        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) { Audits.Add(auditEvent); return Task.CompletedTask; }
        public override Task SaveChangesAsync(CancellationToken ct = default) { Saves++; return Task.CompletedTask; }
    }

    private sealed class Entitlements(bool allow) : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(allow
                ? new EntitlementDecision(true, EntitlementReason.Allowed, null)
                : new EntitlementDecision(false, EntitlementReason.SubscriptionExpired, null));
    }

    private sealed class FixedClock : IClock { public DateTime UtcNow => new(2026, 10, 29, 6, 0, 0, DateTimeKind.Utc); }
    private sealed class FixedIdGenerator : IIdGenerator { public Guid New() => Guid.Parse("99999999-0000-0000-0000-000000000009"); }
    private sealed class NoopAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
    /// <summary>No command here carries a SourceAiJobId, so nothing may touch this.</summary>
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
