using Accounts.Application.Ports;
using Accounts.Application.UseCases.Subscriptions.ApplyProviderEvent;
using Accounts.Domain.Subscriptions;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Xunit;

namespace Accounts.Domain.Tests.Subscriptions;

public sealed class ApplyProviderEventHandlerTests
{
    private readonly FakeSubscriptionRepository _repo = new();
    private readonly FixedClock _clock = new(new DateTime(2026, 5, 1, 12, 0, 0, DateTimeKind.Utc));
    private ApplyProviderEventHandler Handler => new(_repo, _clock);

    [Fact]
    public async Task Duplicate_ProviderEventId_Returns_WasDuplicate_True()
    {
        _repo.SeedWebhookEvent("evt_001");

        var command = BuildActivateCommand("evt_001");
        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.WasDuplicate);
        Assert.Equal(0, _repo.SaveCalls);
    }

    [Fact]
    public async Task Activate_Event_Transitions_Subscription_To_Active()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var validUntil = _clock.UtcNow.AddDays(365);
        var command = new ApplyProviderEventCommand(
            "evt_activate_1",
            ProviderEventTypes.SubscriptionActivated,
            subId,
            _clock.UtcNow,
            validUntil,
            null,
            "cus_abc",
            "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.WasDuplicate);
        Assert.False(result.Value!.WasUnknownEventType);
        Assert.Equal(SubscriptionStatus.Active, _repo.GetSubscription(subId)!.Status);
        Assert.Equal(1, _repo.SaveCalls);
    }

    [Fact]
    public async Task PastDue_Event_Transitions_Subscription_To_PastDue()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var command = new ApplyProviderEventCommand(
            "evt_pastdue_1",
            ProviderEventTypes.SubscriptionPastDue,
            subId,
            null, null,
            _clock.UtcNow.AddDays(7),
            null, "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Equal(SubscriptionStatus.PastDue, _repo.GetSubscription(subId)!.Status);
    }

    [Fact]
    public async Task Expire_Event_Transitions_Subscription_To_Expired()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var command = new ApplyProviderEventCommand(
            "evt_expire_1",
            ProviderEventTypes.SubscriptionExpired,
            subId,
            null, null, null, null, "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Equal(SubscriptionStatus.Expired, _repo.GetSubscription(subId)!.Status);
    }

    [Fact]
    public async Task Cancel_Event_Transitions_Subscription_To_Canceled()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var command = new ApplyProviderEventCommand(
            "evt_cancel_1",
            ProviderEventTypes.SubscriptionCanceled,
            subId,
            null, null, null, null, "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Equal(SubscriptionStatus.Canceled, _repo.GetSubscription(subId)!.Status);
    }

    [Fact]
    public async Task Unknown_EventType_With_Subscription_Returns_WasUnknownEventType_True()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var command = new ApplyProviderEventCommand(
            "evt_unknown_1",
            "subscription.future_unknown",
            subId, null, null, null, null, "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.WasDuplicate);
        Assert.True(result.Value!.WasUnknownEventType);
        Assert.Equal(1, _repo.SaveCalls); // raw event still persisted, subscription not mutated
    }

    [Fact]
    public async Task Unknown_EventType_Without_SubscriptionId_Still_Stores_Raw_Event()
    {
        var command = new ApplyProviderEventCommand(
            "evt_unknown_nosub_1",
            "subscription.future_unknown",
            null, null, null, null, null, "{}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.WasDuplicate);
        Assert.Equal(1, _repo.SaveCalls);
    }

    [Fact]
    public async Task Event_Without_SubscriptionId_Stores_Raw_Event()
    {
        var command = new ApplyProviderEventCommand(
            "evt_nosub_1",
            ProviderEventTypes.SubscriptionActivated,
            null, null, null, null, null, "{\"note\":\"no sub id\"}");

        var result = await Handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, _repo.SaveCalls);
    }

    /// <summary>
    /// Sub-plan 03 Task 3: missing ValidUntilUtc on an Activate/Renew event
    /// must surface as a Result.Failure (Validation kind), not as an
    /// InvalidOperationException bubbling out of the handler.
    /// </summary>
    [Fact]
    public async Task Activate_Event_WithoutValidUntilUtc_ReturnsValidationFailure()
    {
        var subId = new SubscriptionId(Guid.NewGuid());
        _repo.SeedSubscription(BuildTrialingSubscription(subId));

        var command = new ApplyProviderEventCommand(
            "evt_activate_no_validuntil",
            ProviderEventTypes.SubscriptionActivated,
            subId,
            _clock.UtcNow,
            null,                          // ValidUntilUtc deliberately omitted
            null,
            "cus_abc",
            "{}");

        var result = await Handler.HandleAsync(command);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.Error);
        Assert.Equal(AgriSync.BuildingBlocks.Results.ErrorKind.Validation, result.Error.Kind);
        Assert.Contains("ValidUntilUtc", result.Error.Description);

        // Subscription should NOT have transitioned, and no save should occur
        // for an aborted command.
        Assert.Equal(SubscriptionStatus.Trialing, _repo.GetSubscription(subId)!.Status);
        Assert.Equal(0, _repo.SaveCalls);
    }

    private static ApplyProviderEventCommand BuildActivateCommand(string eventId) =>
        new(eventId, ProviderEventTypes.SubscriptionActivated,
            null, null, null, null, null, "{}");

    private Subscription BuildTrialingSubscription(SubscriptionId subId)
    {
        var ownerId = new OwnerAccountId(Guid.NewGuid());
        return Subscription.StartTrial(
            subId, ownerId, "shramsafal_pro",
            _clock.UtcNow.AddDays(-7),
            _clock.UtcNow.AddDays(7));
    }

    // ---- Fakes ----

    private sealed class FakeSubscriptionRepository : ISubscriptionRepository
    {
        private readonly Dictionary<SubscriptionId, Subscription> _subs = new();
        private readonly HashSet<string> _eventIds = new();
        public int SaveCalls { get; private set; }

        public void SeedSubscription(Subscription s) => _subs[s.Id] = s;
        public void SeedWebhookEvent(string id) => _eventIds.Add(id);
        public Subscription? GetSubscription(SubscriptionId id) => _subs.GetValueOrDefault(id);

        public Task AddAsync(Subscription s, CancellationToken ct = default)
        {
            _subs[s.Id] = s;
            return Task.CompletedTask;
        }

        public Task<Subscription?> GetCurrentAsync(OwnerAccountId id, CancellationToken ct = default) =>
            Task.FromResult<Subscription?>(_subs.Values.FirstOrDefault(s => s.OwnerAccountId == id));

        public Task<Subscription?> GetByIdAsync(SubscriptionId id, CancellationToken ct = default) =>
            Task.FromResult(_subs.GetValueOrDefault(id));

        public Task<bool> WebhookEventExistsAsync(string id, CancellationToken ct = default) =>
            Task.FromResult(_eventIds.Contains(id));

        public Task AddWebhookEventAsync(SubscriptionWebhookEvent e, CancellationToken ct = default)
        {
            _eventIds.Add(e.ProviderEventId);
            return Task.CompletedTask;
        }

        public Task<List<Subscription>> GetNonTerminalExpiredAsync(DateTime asOf, CancellationToken ct = default) =>
            Task.FromResult(new List<Subscription>());

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }
}
