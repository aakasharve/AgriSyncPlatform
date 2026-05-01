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
    public async Task Implicit_save_followed_by_unrelated_explicit_rollback_does_NOT_resurrect_already_committed_events()
    {
        // T-IGH-03-OUTBOX-WIRING hardening regression: the original
        // commit-snapshot stashed events on EVERY SavedChangesAsync,
        // including auto-commit (implicit) saves. A later unrelated
        // explicit transaction on the same context that rolled back
        // — even with no events of its own — would call
        // OutboxTransactionInterceptor.TransactionRolledBack →
        // RestoreCommitSnapshot and resurrect events that were already
        // successfully published. The fix only stashes the snapshot
        // when SavedChanges runs inside an explicit transaction
        // (Database.CurrentTransaction is non-null), and clears any
        // stale prior snapshot on every implicit save.
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var saveSide = new DomainEventToOutboxInterceptor(clock);
        var txSide = new OutboxTransactionInterceptor(saveSide);

        await using var ctx = TestEntityDbContext.CreateSqlite(saveSide, txSide);
        await ctx.Database.EnsureCreatedAsync();

        // 1. Implicit save: aggregate raises events, SaveChangesAsync
        //    auto-commits, OutboxMessages get persisted, events are
        //    cleared. No explicit transaction in play.
        var entity = TestAggregate.Create(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"), "A");
        entity.Rename("AA"); // 2 events queued
        ctx.Aggregates.Add(entity);
        await ctx.SaveChangesAsync();

        Assert.Equal(2, await ctx.OutboxMessages.CountAsync());
        Assert.Empty(entity.DomainEvents);

        // 2. Open a NEW explicit transaction with NO events of our
        //    own, then roll it back. The save-side interceptor must
        //    NOT have stashed the implicit-save events as a commit
        //    snapshot, so this rollback must NOT resurrect them.
        await using (var tx = await ctx.Database.BeginTransactionAsync())
        {
            // Touch a non-aggregate row so the SaveChanges has
            // SOMETHING to do but doesn't go through the outbox flow
            // (no events on the entity above; nothing else is
            // tracking events).
            // Using SaveChangesAsync with an empty change set is also
            // fine; the interceptor's SavingChanges path just records
            // an empty pending state.
            await ctx.SaveChangesAsync();
            await tx.RollbackAsync();
        }

        // The aggregate's in-memory queue MUST stay empty — the
        // already-published events must not be resurrected by the
        // unrelated rollback.
        Assert.Empty(entity.DomainEvents);

        // The committed OutboxMessages must still be exactly 2 — no
        // duplicates, no resurrection-driven re-publishing.
        Assert.Equal(2, await ctx.OutboxMessages.CountAsync());
    }

    [Fact]
    public async Task ExplicitTransaction_RolledBack_after_successful_SaveChanges_re_arms_DomainEvents()
    {
        // T-IGH-03-OUTBOX-WIRING explicit-transaction rollback
        // regression: when a caller opens an explicit transaction,
        // SaveChanges succeeds (so SavedChangesAsync clears events),
        // and then the caller rolls the transaction back, the
        // OutboxMessage rows go away with the transaction. The
        // OutboxTransactionInterceptor must restore the in-memory
        // events so a retry resends them.
        //
        // We can only assert this against a relational provider
        // because the in-memory provider is non-transactional. We
        // use the SQLite in-memory provider which supports
        // transactions; OutboxTransactionInterceptor's TransactionRolledBack
        // hook fires on it.
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var saveSide = new DomainEventToOutboxInterceptor(clock);
        var txSide = new OutboxTransactionInterceptor(saveSide);

        await using var ctx = TestEntityDbContext.CreateSqlite(saveSide, txSide);
        await ctx.Database.EnsureCreatedAsync();

        var entity = TestAggregate.Create(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"), "Z");
        entity.Rename("ZZ"); // 2 events

        ctx.Aggregates.Add(entity);

        await using (var tx = await ctx.Database.BeginTransactionAsync())
        {
            await ctx.SaveChangesAsync();
            // SavedChanges already cleared the in-memory queue at this
            // point — that's the bug we're guarding against. The
            // explicit rollback below should re-arm them via the
            // transaction interceptor.
            await tx.RollbackAsync();
        }

        // Events MUST be back on the aggregate.
        Assert.Equal(2, entity.DomainEvents.Count);

        // Retry inside a fresh successful transaction: outbox should
        // commit exactly 2 messages.
        await using (var tx = await ctx.Database.BeginTransactionAsync())
        {
            await ctx.SaveChangesAsync();
            await tx.CommitAsync();
        }

        Assert.Equal(2, await ctx.OutboxMessages.CountAsync());
        Assert.Empty(entity.DomainEvents);
    }

    [Fact]
    public async Task Multiple_SaveChangesAsync_inside_one_explicit_transaction_rollback_re_arms_all_event_batches()
    {
        // T-IGH-03-OUTBOX-WIRING multi-save regression: when a caller
        // opens ONE explicit transaction and calls SaveChangesAsync
        // more than once before rolling back, EVERY batch's events
        // must be re-armed. The original snapshot was keyed only by
        // DbContext and replaced on each save, which lost earlier
        // batches' events on rollback. The fix accumulates batches in
        // a per-(DbContext, TransactionId) bucket and restores them
        // in reverse accumulation order so the original temporal
        // sequence is preserved at the front of the queue.
        var clock = new FixedTimeProvider(new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc));
        var saveSide = new DomainEventToOutboxInterceptor(clock);
        var txSide = new OutboxTransactionInterceptor(saveSide);

        await using var ctx = TestEntityDbContext.CreateSqlite(saveSide, txSide);
        await ctx.Database.EnsureCreatedAsync();

        var a = TestAggregate.Create(Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"), "A");
        a.Rename("AA"); // a now has [Created, Renamed("AA")] — 2 events queued

        var b = TestAggregate.Create(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"), "B");
        // b has [Created] — 1 event queued

        await using (var tx = await ctx.Database.BeginTransactionAsync())
        {
            // First save: stage A. A's 2 events get persisted as
            // outbox rows and cleared from the in-memory queue.
            ctx.Aggregates.Add(a);
            await ctx.SaveChangesAsync();
            Assert.Empty(a.DomainEvents);

            // Raise another event on A between saves to verify it
            // survives the rollback as part of the SECOND batch.
            a.Rename("AAA"); // a now has [Renamed("AAA")] — 1 event

            // Second save: stage B AND clear A's new event in the
            // SAME SaveChanges, so the bucket accumulates two batches
            // under the same TransactionId.
            ctx.Aggregates.Add(b);
            await ctx.SaveChangesAsync();
            Assert.Empty(a.DomainEvents);
            Assert.Empty(b.DomainEvents);

            await tx.RollbackAsync();
        }

        // Both aggregates' full event histories must be back in
        // original temporal order. The pre-fix design lost A's
        // [Created, Renamed("AA")] batch when batch 2 replaced it.
        Assert.Equal(3, a.DomainEvents.Count);
        Assert.IsType<TestAggregateCreated>(a.DomainEvents.ElementAt(0));
        Assert.IsType<TestAggregateRenamed>(a.DomainEvents.ElementAt(1));
        Assert.IsType<TestAggregateRenamed>(a.DomainEvents.ElementAt(2));
        Assert.Equal("AA", ((TestAggregateRenamed)a.DomainEvents.ElementAt(1)).Name);
        Assert.Equal("AAA", ((TestAggregateRenamed)a.DomainEvents.ElementAt(2)).Name);

        Assert.Single(b.DomainEvents);
        Assert.IsType<TestAggregateCreated>(b.DomainEvents.ElementAt(0));

        // No outbox rows should have committed (the entire
        // transaction rolled back).
        Assert.Equal(0, await ctx.OutboxMessages.CountAsync());

        // Retry: replay everything in a fresh successful transaction.
        // All 4 events should land in the outbox (3 from A + 1 from B).
        await using (var tx = await ctx.Database.BeginTransactionAsync())
        {
            await ctx.SaveChangesAsync();
            await tx.CommitAsync();
        }

        Assert.Equal(4, await ctx.OutboxMessages.CountAsync());
        Assert.Empty(a.DomainEvents);
        Assert.Empty(b.DomainEvents);
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

        public static TestEntityDbContext CreateSqlite(
            DomainEventToOutboxInterceptor saveSide,
            OutboxTransactionInterceptor txSide)
        {
            // Sqlite in-memory has real transaction semantics, unlike
            // EF's in-memory provider. We need a real provider so the
            // OutboxTransactionInterceptor's TransactionRolledBack hook
            // fires.
            var connection = new Microsoft.Data.Sqlite.SqliteConnection("DataSource=:memory:");
            connection.Open();
            var failing = new FailingInterceptor();
            var options = new DbContextOptionsBuilder<TestEntityDbContext>()
                .UseSqlite(connection)
                .AddInterceptors(saveSide, txSide, failing)
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
