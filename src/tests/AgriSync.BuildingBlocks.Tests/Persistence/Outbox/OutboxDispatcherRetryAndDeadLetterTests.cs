using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-PUBLISHER-IMPL: retry budget + dead-letter
/// regression coverage. Drives <see cref="OutboxDispatcher.RunCycleAsync"/>
/// directly so the BackgroundService loop doesn't have to be stood up;
/// the static cycle method is the only side-effecting code path that
/// needs deterministic coverage.
///
/// <para>
/// Each test uses an in-memory <see cref="OutboxDbContext"/> seeded
/// with one or more <see cref="OutboxMessage"/> rows and a fake
/// publisher that either succeeds or throws on every dispatch.
/// </para>
/// </summary>
public sealed class OutboxDispatcherRetryAndDeadLetterTests
{
    [Fact]
    public async Task RunCycleAsync_publish_success_marks_message_processed_and_clears_error()
    {
        await using var dbContext = NewInMemoryContext();
        var msg = NewPendingMessage();
        dbContext.OutboxMessages.Add(msg);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new SuccessfulPublisher();

        var processedCount = await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, OutboxDispatcher.DefaultMaxAttempts, default);

        Assert.Equal(1, processedCount);
        Assert.NotNull(msg.ProcessedOnUtc);
        Assert.Null(msg.DeadLetteredAt);
        Assert.Null(msg.Error);
        Assert.Equal(0, msg.AttemptCount);
        Assert.Equal(time.GetUtcNow().UtcDateTime, msg.ProcessedOnUtc);
        Assert.Equal(1, publisher.PublishCount);
    }

    [Fact]
    public async Task RunCycleAsync_publish_failure_increments_attempt_count_and_keeps_pending_below_budget()
    {
        await using var dbContext = NewInMemoryContext();
        var msg = NewPendingMessage();
        dbContext.OutboxMessages.Add(msg);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new FailingPublisher("kaboom");
        const int maxAttempts = 3;

        // First failed cycle.
        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);

        Assert.Equal(1, msg.AttemptCount);
        Assert.Equal("kaboom", msg.Error);
        Assert.Null(msg.ProcessedOnUtc);
        Assert.Null(msg.DeadLetteredAt);

        // Second failed cycle — picks up the same row (still pending,
        // not dead-lettered) and increments again.
        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);

        Assert.Equal(2, msg.AttemptCount);
        Assert.Null(msg.DeadLetteredAt);
    }

    [Fact]
    public async Task RunCycleAsync_marks_message_dead_lettered_when_attempt_count_reaches_budget()
    {
        await using var dbContext = NewInMemoryContext();
        var msg = NewPendingMessage();
        dbContext.OutboxMessages.Add(msg);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new FailingPublisher("kaboom");
        const int maxAttempts = 2;

        // Cycle 1 — attempt 1 fails, still under budget.
        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);
        Assert.Equal(1, msg.AttemptCount);
        Assert.Null(msg.DeadLetteredAt);

        // Cycle 2 — attempt 2 fails, hits budget, DLQ marker stamped.
        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);
        Assert.Equal(2, msg.AttemptCount);
        Assert.NotNull(msg.DeadLetteredAt);
        Assert.Equal(time.GetUtcNow().UtcDateTime, msg.DeadLetteredAt);
        Assert.Null(msg.ProcessedOnUtc);
    }

    [Fact]
    public async Task RunCycleAsync_skips_dead_lettered_messages_on_subsequent_cycles()
    {
        await using var dbContext = NewInMemoryContext();
        var msg = NewPendingMessage();
        dbContext.OutboxMessages.Add(msg);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new FailingPublisher("kaboom");
        const int maxAttempts = 1;

        // Cycle 1 — attempt 1 fails, immediately hits budget,
        // DLQ stamped.
        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);
        Assert.NotNull(msg.DeadLetteredAt);
        Assert.Equal(1, publisher.PublishCount);

        // Cycle 2 — should NOT touch the dead-lettered row. Publisher
        // not invoked again.
        var processedCount = await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, maxAttempts, default);
        Assert.Equal(0, processedCount);
        Assert.Equal(1, publisher.PublishCount);
        Assert.Equal(1, msg.AttemptCount);
    }

    [Fact]
    public async Task RunCycleAsync_processed_messages_are_not_revisited()
    {
        await using var dbContext = NewInMemoryContext();
        var msg = NewPendingMessage();
        dbContext.OutboxMessages.Add(msg);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new SuccessfulPublisher();

        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, OutboxDispatcher.DefaultMaxAttempts, default);
        Assert.NotNull(msg.ProcessedOnUtc);
        Assert.Equal(1, publisher.PublishCount);

        var processedCount = await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, OutboxDispatcher.DefaultMaxAttempts, default);
        Assert.Equal(0, processedCount);
        Assert.Equal(1, publisher.PublishCount);
    }

    [Fact]
    public async Task RunCycleAsync_with_mixed_success_and_failure_isolates_per_message()
    {
        await using var dbContext = NewInMemoryContext();
        var success = NewPendingMessage();
        var failure = NewPendingMessage();
        dbContext.OutboxMessages.AddRange(success, failure);
        await dbContext.SaveChangesAsync();

        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-05-01T10:00:00Z"));
        var publisher = new SelectivePublisher(passId: success.Id, failError: "selective failure");

        await OutboxDispatcher.RunCycleAsync(
            dbContext, publisher, time, NullLogger.Instance, OutboxDispatcher.DefaultMaxAttempts, default);

        Assert.NotNull(success.ProcessedOnUtc);
        Assert.Equal(0, success.AttemptCount);
        Assert.Null(failure.ProcessedOnUtc);
        Assert.Equal(1, failure.AttemptCount);
        Assert.Equal("selective failure", failure.Error);
    }

    [Fact]
    public async Task OutboxDispatcher_constructor_rejects_zero_or_negative_max_attempts()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() =>
            new OutboxDispatcher(
                scopeFactory: null!, logger: NullLogger<OutboxDispatcher>.Instance,
                timeProvider: TimeProvider.System, maxAttempts: 0));
        Assert.Equal("maxAttempts", ex.ParamName);
    }

    // ---- Test infrastructure ----

    private static OutboxDbContext NewInMemoryContext()
    {
        var options = new DbContextOptionsBuilder<OutboxDbContext>()
            .UseInMemoryDatabase($"outbox-retry-test-{Guid.NewGuid():N}")
            .Options;
        return new OutboxDbContext(options);
    }

    private static OutboxMessage NewPendingMessage(string note = "test") =>
        new(
            id: Guid.NewGuid(),
            type: typeof(TestEvent).AssemblyQualifiedName!,
            payload: System.Text.Json.JsonSerializer.Serialize(new TestEvent(note, Guid.NewGuid(), DateTime.UtcNow)),
            occurredOnUtc: DateTime.UtcNow);

    private sealed record TestEvent(string Note, Guid EventId, DateTime OccurredOnUtc) : IDomainEvent;

    private sealed class SuccessfulPublisher : IOutboxPublisher
    {
        public int PublishCount { get; private set; }

        public Task PublishAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            PublishCount += 1;
            return Task.CompletedTask;
        }
    }

    private sealed class FailingPublisher : IOutboxPublisher
    {
        private readonly string _error;
        public int PublishCount { get; private set; }

        public FailingPublisher(string error)
        {
            _error = error;
        }

        public Task PublishAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            PublishCount += 1;
            throw new InvalidOperationException(_error);
        }
    }

    private sealed class SelectivePublisher : IOutboxPublisher
    {
        private readonly Guid _passId;
        private readonly string _failError;

        public SelectivePublisher(Guid passId, string failError)
        {
            _passId = passId;
            _failError = failError;
        }

        public Task PublishAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            if (message.Id == _passId)
            {
                return Task.CompletedTask;
            }
            throw new InvalidOperationException(_failError);
        }
    }
}
