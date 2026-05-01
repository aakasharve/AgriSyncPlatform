using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence.Outbox;

/// <summary>
/// Sub-plan 03 Task 6: <see cref="DomainEventToOutboxInterceptor"/>
/// must capture every <see cref="IDomainEvent"/> raised on a tracked
/// <see cref="Entity{TId}"/> and persist it as an
/// <see cref="OutboxMessage"/> in the SAME SaveChanges that wrote
/// the aggregate, then flush the in-memory queue.
/// </summary>
public sealed class DomainEventToOutboxInterceptorTests
{
    [Fact]
    public async Task SavingChanges_writes_an_OutboxMessage_for_each_DomainEvent()
    {
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var interceptor = new DomainEventToOutboxInterceptor(clock);

        await using var ctx = TestEntityDbContext.Create(interceptor);

        var entity = TestAggregate.Create(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "Patil");
        entity.Rename("Patil Farm A");
        entity.Rename("Patil Farm B");

        ctx.Aggregates.Add(entity);
        await ctx.SaveChangesAsync();

        // 3 events: 1 Created + 2 Renamed.
        var outboxRows = await ctx.OutboxMessages.OrderBy(m => m.OccurredOnUtc).ToListAsync();
        Assert.Equal(3, outboxRows.Count);

        Assert.All(outboxRows, m =>
        {
            Assert.Equal(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc), m.OccurredOnUtc);
            Assert.NotNull(m.Type);
            Assert.NotEmpty(m.Payload);
            Assert.Null(m.ProcessedOnUtc);
            Assert.Null(m.Error);
        });

        var typeNames = outboxRows.Select(m => m.Type).ToList();
        Assert.Contains(typeNames, t => t.Contains(nameof(TestAggregateCreated)));
        Assert.Contains(typeNames, t => t.Contains(nameof(TestAggregateRenamed)));

        // Aggregate's in-memory queue must be drained — a retried save MUST NOT
        // re-emit. We verify by saving a no-op change and asserting no new
        // outbox rows accumulate.
        await ctx.SaveChangesAsync();
        Assert.Equal(3, await ctx.OutboxMessages.CountAsync());
    }

    [Fact]
    public async Task SaveChangesFailed_keeps_DomainEvents_queued_so_a_retry_resends_them()
    {
        // T-IGH-03-OUTBOX-WIRING rollback-safety regression: the
        // previous interceptor cleared events inside SavingChanges,
        // so a failed SaveChanges silently dropped them. The fix
        // moves the clear to SavedChanges and leaves the in-memory
        // queue untouched on SaveChangesFailed.
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var interceptor = new DomainEventToOutboxInterceptor(clock);

        await using var ctx = TestEntityDbContext.Create(interceptor);
        var entity = TestAggregate.Create(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), "X");
        entity.Rename("Y"); // 2 events queued total: Created + Renamed

        ctx.Aggregates.Add(entity);

        // Force SaveChangesAsync to throw by registering a failing
        // SaveChanges interceptor that runs AFTER ours. Its
        // SavingChangesAsync override will throw, which means
        // SaveChangesFailedAsync fires on our interceptor.
        ctx.AddFailingInterceptor();

        await Assert.ThrowsAsync<InvalidOperationException>(() => ctx.SaveChangesAsync());

        // Events MUST stay queued on the aggregate.
        Assert.Equal(2, entity.DomainEvents.Count);

        // Drop the failing interceptor and retry — events should now
        // make it to the outbox.
        ctx.RemoveFailingInterceptor();
        await ctx.SaveChangesAsync();

        Assert.Equal(2, await ctx.OutboxMessages.CountAsync());
        Assert.Empty(entity.DomainEvents); // cleared after the successful save
    }

    [Fact]
    public async Task SavingChanges_with_no_domain_events_writes_no_outbox_rows()
    {
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var interceptor = new DomainEventToOutboxInterceptor(clock);

        await using var ctx = TestEntityDbContext.Create(interceptor);

        var aggregate = TestAggregate.Create(Guid.NewGuid(), "x");
        ctx.Aggregates.Add(aggregate);
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.OutboxMessages.CountAsync()); // Created event

        // Subsequent save with no new events: outbox count must NOT grow.
        var loaded = await ctx.Aggregates.FirstAsync();
        // No mutation, no new events.
        await ctx.SaveChangesAsync();
        Assert.Equal(1, await ctx.OutboxMessages.CountAsync());
    }

    // ---- Test doubles ----

    private sealed class FixedTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _now;
        public FixedTimeProvider(DateTime utcNow) => _now = new DateTimeOffset(utcNow, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
    }

    private sealed record TestAggregateCreated(Guid AggregateId, string Name, Guid EventId, DateTime OccurredOnUtc) : IDomainEvent;
    private sealed record TestAggregateRenamed(Guid AggregateId, string Name, Guid EventId, DateTime OccurredOnUtc) : IDomainEvent;

    private sealed class TestAggregate : Entity<Guid>
    {
        public string Name { get; private set; }

        private TestAggregate(Guid id, string name) : base(id)
        {
            Name = name;
        }

        public static TestAggregate Create(Guid id, string name)
        {
            var agg = new TestAggregate(id, name);
            agg.Raise(new TestAggregateCreated(id, name, Guid.NewGuid(), DateTime.UtcNow));
            return agg;
        }

        public void Rename(string newName)
        {
            Name = newName;
            Raise(new TestAggregateRenamed(Id, newName, Guid.NewGuid(), DateTime.UtcNow));
        }
    }

    /// <summary>
    /// Toggleable interceptor used by the rollback-safety regression
    /// test to make a single SaveChangesAsync throw without permanently
    /// breaking the context. Registered alongside the real
    /// DomainEventToOutboxInterceptor; runs AFTER it (interceptor order
    /// follows registration order) so that our interceptor's
    /// SavingChanges has already snapshotted + queued OutboxMessages
    /// when we throw, exercising the SaveChangesFailedAsync path.
    /// </summary>
    private sealed class FailingInterceptor : SaveChangesInterceptor
    {
        public bool ShouldFail { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (ShouldFail)
            {
                throw new InvalidOperationException("forced save failure");
            }
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private sealed class TestEntityDbContext : DbContext
    {
        public DbSet<TestAggregate> Aggregates => Set<TestAggregate>();
        public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

        private readonly FailingInterceptor _failing;

        private TestEntityDbContext(DbContextOptions<TestEntityDbContext> options, FailingInterceptor failing) : base(options)
        {
            _failing = failing;
        }

        public void AddFailingInterceptor() => _failing.ShouldFail = true;
        public void RemoveFailingInterceptor() => _failing.ShouldFail = false;

        public static TestEntityDbContext Create(DomainEventToOutboxInterceptor interceptor)
        {
            var failing = new FailingInterceptor();
            var options = new DbContextOptionsBuilder<TestEntityDbContext>()
                .UseInMemoryDatabase($"outbox-tests-{Guid.NewGuid()}")
                .AddInterceptors(interceptor, failing)
                .Options;
            return new TestEntityDbContext(options, failing);
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // The in-memory provider doesn't enforce relational settings; just
            // declare the entities so EF tracks them.
            modelBuilder.Entity<TestAggregate>(b =>
            {
                b.HasKey(a => a.Id);
                b.Property(a => a.Name);
                b.Ignore(a => a.DomainEvents); // not a column; lives in memory only
            });
            modelBuilder.Entity<OutboxMessage>(b =>
            {
                b.HasKey(m => m.Id);
                b.Property(m => m.Type);
                b.Property(m => m.Payload);
                b.Property(m => m.OccurredOnUtc);
                b.Property(m => m.ProcessedOnUtc);
                b.Property(m => m.Error);
            });
        }
    }
}
