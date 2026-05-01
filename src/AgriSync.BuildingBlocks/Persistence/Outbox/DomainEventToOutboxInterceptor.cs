using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// Sub-plan 03 Task 6: bridges <see cref="Entity{TId}.DomainEvents"/>
/// into the <see cref="OutboxMessage"/> table inside the SAME EF Core
/// SaveChangesAsync as the aggregate's writes.
///
/// <para>
/// Wiring (deferred to <c>T-IGH-03-OUTBOX-WIRING</c>): each writing
/// <see cref="DbContext"/> must (a) register
/// <see cref="OutboxMessageConfiguration"/> in its <c>OnModelCreating</c>
/// and (b) be registered with
/// <c>options.AddInterceptors(provider.GetRequiredService&lt;DomainEventToOutboxInterceptor&gt;())</c>
/// in its DI module.
/// </para>
///
/// <para>
/// <b>Rollback safety (T-IGH-03-OUTBOX-WIRING prerequisite):</b> the
/// in-memory <c>DomainEvents</c> queue is cleared only AFTER
/// <c>SaveChangesAsync</c> returns successfully (via
/// <see cref="SavedChangesAsync"/>), and is left untouched if
/// <see cref="SaveChangesFailedAsync"/> fires. So if EF's implicit
/// transaction rolls back (constraint violation, deadlock, etc.) the
/// events stay queued on the aggregate and are picked up on the next
/// successful save. The previous implementation cleared inside
/// <c>SavingChanges</c>, which silently dropped events on a failed
/// save.
/// </para>
///
/// <para>
/// <b>Explicit-transaction rollback safety:</b> when a caller opens
/// its own transaction via
/// <c>dbContext.Database.BeginTransactionAsync</c>, <c>SavedChanges</c>
/// fires after the SQL is sent but BEFORE the caller's
/// <c>Transaction.Commit</c>. A subsequent <c>Transaction.Rollback</c>
/// would naively drop the in-memory events even though the
/// OutboxMessage rows rolled back with the transaction. Closed by
/// <see cref="OutboxTransactionInterceptor"/> in tandem with
/// <see cref="RestoreTxSnapshot"/> / <see cref="DiscardTxSnapshot"/>:
/// snapshots are accumulated per-transaction (keyed by
/// <see cref="DbContext"/> + <c>TransactionId</c>) so multiple
/// <c>SaveChanges</c> calls inside one explicit transaction all
/// re-arm on rollback, and an unrelated implicit-then-explicit-
/// rollback sequence cannot resurrect events from a different
/// transaction's already-committed save.
/// </para>
/// </summary>
public sealed class DomainEventToOutboxInterceptor : SaveChangesInterceptor
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly TimeProvider _clock;

    /// <summary>
    /// Per-DbContext list of (entity, snapshotted-event-count) pairs.
    /// Populated by <see cref="EnqueueOutboxMessages"/> and consumed by
    /// <see cref="SavedChangesAsync"/> after the save commits. Keyed by
    /// <see cref="DbContext"/> reference because a single interceptor
    /// instance can be shared across contexts;
    /// <see cref="ConditionalWeakTable{TKey,TValue}"/> avoids leaking
    /// references when contexts are disposed without ever firing
    /// SavedChanges/SaveChangesFailed (e.g. when SaveChanges was never
    /// called).
    /// </summary>
    private readonly ConditionalWeakTable<DbContext, PendingState> _pending = new();

    /// <summary>
    /// Two-level snapshot store: outer key is the
    /// <see cref="DbContext"/> (held weakly so a context that goes out
    /// of scope without ever closing its transaction doesn't leak),
    /// inner key is the active
    /// <see cref="Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction.TransactionId"/>
    /// at <c>SavedChanges</c>-time. Multiple <c>SaveChanges</c> calls
    /// within the same explicit transaction <i>accumulate</i> into the
    /// same bucket; <see cref="OutboxTransactionInterceptor"/> consumes
    /// the whole bucket on rollback / failure and removes it on commit.
    ///
    /// <para>
    /// Only populated when <see cref="SavedChangesAsync"/> ran inside
    /// an explicit transaction (<c>Database.CurrentTransaction</c> is
    /// non-null). Implicit (auto-commit) saves do not register a
    /// snapshot at all because there is no caller-visible transaction
    /// handle for any rollback callback to fire on, and the events are
    /// already durably committed in the same atomic save as their
    /// <see cref="OutboxMessage"/> rows.
    /// </para>
    /// </summary>
    private readonly ConditionalWeakTable<DbContext, ConcurrentDictionary<Guid, List<CommitSnapshotEntry>>> _txSnapshots = new();

    public DomainEventToOutboxInterceptor(TimeProvider clock)
    {
        _clock = clock;
    }

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        EnqueueOutboxMessages(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        EnqueueOutboxMessages(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        ClearSnapshotted(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        ClearSnapshotted(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        // Do NOT clear the in-memory events — the OutboxMessage rows we
        // added in SavingChanges were rolled back with the failed save,
        // so the events should stay queued for the next successful save.
        DiscardSnapshot(eventData.Context);
        base.SaveChangesFailed(eventData);
    }

    public override Task SaveChangesFailedAsync(
        DbContextErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        DiscardSnapshot(eventData.Context);
        return base.SaveChangesFailedAsync(eventData, cancellationToken);
    }

    private void EnqueueOutboxMessages(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        // Self-heal: if prior pending state lingers, the previous save
        // attempt failed without SavedChanges/SaveChangesFailed firing
        // (e.g. a downstream interceptor threw before EF reached its
        // failure callback). Detach the stale OutboxMessages so we
        // don't double-commit them alongside the fresh batch we're
        // about to write. The in-memory DomainEvents weren't cleared
        // by the prior pass, so they will be re-snapshotted below —
        // which is the correct retry behaviour.
        if (_pending.TryGetValue(context, out var stalePending))
        {
            foreach (var msg in stalePending.Messages)
            {
                var staleEntry = context.Entry(msg);
                if (staleEntry.State != EntityState.Detached)
                {
                    staleEntry.State = EntityState.Detached;
                }
            }
            _pending.Remove(context);
        }

        // Find every tracked Entity<TId> whose DomainEvents queue is non-empty.
        // We use the open generic Entity<> base type so this works against any
        // aggregate without a per-type registration.
        var entries = context.ChangeTracker
            .Entries()
            .Where(entry => entry.Entity is not null
                            && IsEntityWithDomainEvents(entry.Entity))
            .ToList();

        if (entries.Count == 0)
        {
            return;
        }

        var occurredOnUtc = _clock.GetUtcNow().UtcDateTime;
        var messages = new List<OutboxMessage>();
        var snapshot = new List<PendingClear>(entries.Count);

        foreach (var entry in entries)
        {
            var entity = entry.Entity!;
            var events = GetDomainEventsSnapshot(entity);
            if (events.Count == 0)
            {
                continue;
            }

            foreach (var domainEvent in events)
            {
                var eventType = domainEvent.GetType();
                var payload = JsonSerializer.Serialize(
                    domainEvent,
                    eventType,
                    JsonOptions);

                messages.Add(new OutboxMessage(
                    id: Guid.NewGuid(),
                    type: eventType.AssemblyQualifiedName ?? eventType.FullName ?? eventType.Name,
                    payload: payload,
                    occurredOnUtc: occurredOnUtc));
            }

            // Record the exact events we serialized so a later
            // explicit-transaction rollback (via OutboxTransactionInterceptor)
            // can restore them without touching the queue between
            // SavingChanges and SavedChanges.
            snapshot.Add(new PendingClear(entity, events.Count, events));
        }

        if (messages.Count > 0)
        {
            context.AddRange(messages);
        }

        if (snapshot.Count > 0 || messages.Count > 0)
        {
            // Replace any prior snapshot for this context — a save can
            // only have one in-flight SavingChanges/SavedChanges pair.
            _pending.Remove(context);
            _pending.Add(context, new PendingState(snapshot, messages));
        }
    }

    private void ClearSnapshotted(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        if (_pending.TryGetValue(context, out var state))
        {
            // Always clear the in-memory queue for the snapshotted
            // count first — events were captured at SavingChanges-time
            // and stored on PendingClear.Events, so the queue clear is
            // independent of (and safely ordered before) any tx-bucket
            // bookkeeping below.
            foreach (var pending in state.Clears)
            {
                RemoveFirstDomainEventsViaBase(pending.Entity, pending.Count);
            }

            // Stash a commit-snapshot ONLY when SaveChanges ran inside
            // an explicit user-opened transaction. Detection: if the
            // DbContext has an active relational transaction at
            // SavedChanges-time, that's the caller's explicit
            // transaction (EF's own implicit transaction is already
            // committed and disposed by this point). The in-memory
            // provider returns null here, which is the correct
            // behaviour for auto-commit semantics.
            //
            // Without this guard, a later unrelated explicit
            // transaction on the same context that the caller rolls
            // back would call OutboxTransactionInterceptor →
            // RestoreTxSnapshot and resurrect events that were already
            // successfully published in a prior implicit save.
            var currentTx = context.Database.CurrentTransaction;
            if (currentTx is not null)
            {
                var newEntries = state.Clears
                    .Where(c => c.Events.Count > 0)
                    .Select(c => new CommitSnapshotEntry(c.Entity, c.Events))
                    .ToList();

                if (newEntries.Count > 0)
                {
                    var bucket = _txSnapshots.GetValue(
                        context,
                        _ => new ConcurrentDictionary<Guid, List<CommitSnapshotEntry>>());
                    // Accumulate per-tx: multiple SaveChanges inside
                    // the same explicit transaction append into the
                    // same bucket. Rolling back the transaction must
                    // re-arm EVERY batch's events.
                    bucket.AddOrUpdate(
                        currentTx.TransactionId,
                        addValueFactory: _ => newEntries,
                        updateValueFactory: (_, existing) =>
                        {
                            existing.AddRange(newEntries);
                            return existing;
                        });
                }
            }
            // Implicit-tx (auto-commit) saves: events were committed
            // in the same atomic SaveChanges with the OutboxMessage
            // rows. No bucket is created because no transaction
            // callback will ever fire to consume one.

            _pending.Remove(context);
        }
    }

    /// <summary>
    /// Called by <see cref="OutboxTransactionInterceptor"/> when the
    /// explicit transaction identified by <paramref name="transactionId"/>
    /// rolls back or fails. Re-arms the in-memory
    /// <see cref="Entity{TId}.DomainEvents"/> queues for every batch
    /// accumulated under that transaction, in <i>reverse accumulation
    /// order</i> so multiple saves on the same aggregate preserve the
    /// caller's original event sequence at the front of the queue.
    ///
    /// <para>
    /// No-op if no bucket exists for the given (context, transactionId)
    /// pair — that's the correct behaviour both for transactions that
    /// produced no events and for the redundant case where rollback
    /// fires after restore has already run (e.g. TransactionFailed
    /// followed by TransactionRolledBack on some providers).
    /// </para>
    /// </summary>
    public void RestoreTxSnapshot(DbContext context, Guid transactionId)
    {
        if (_txSnapshots.TryGetValue(context, out var bucket)
            && bucket.TryRemove(transactionId, out var entries))
        {
            // Reverse accumulation order: batch N goes back first so
            // batch N-1's InsertAtFront places earlier events ahead of
            // it, ending with the original temporal order across the
            // queue.
            for (int i = entries.Count - 1; i >= 0; i--)
            {
                ReinsertDomainEventsAtFrontViaBase(entries[i].Entity, entries[i].Events);
            }
        }
    }

    /// <summary>
    /// Called by <see cref="OutboxTransactionInterceptor"/> after a
    /// successful explicit commit on the transaction identified by
    /// <paramref name="transactionId"/>. Drops only that transaction's
    /// bucket — leaves any other in-flight transaction's bucket on the
    /// same context untouched.
    /// </summary>
    public void DiscardTxSnapshot(DbContext context, Guid transactionId)
    {
        if (_txSnapshots.TryGetValue(context, out var bucket))
        {
            bucket.TryRemove(transactionId, out _);
        }
    }

    private void DiscardSnapshot(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        if (_pending.TryGetValue(context, out var state))
        {
            // The OutboxMessage rows we Added to the context in
            // SavingChanges are still in the change tracker after a
            // failed save (Added state). If we leave them there, the
            // next successful SaveChanges would commit BOTH them AND a
            // fresh batch generated from the same in-memory events.
            // Detach them so the retry produces exactly one set.
            foreach (var msg in state.Messages)
            {
                var entry = context.Entry(msg);
                if (entry.State != EntityState.Detached)
                {
                    entry.State = EntityState.Detached;
                }
            }
            _pending.Remove(context);
        }
    }

    private static bool IsEntityWithDomainEvents(object entity)
    {
        // Walk up the type hierarchy looking for Entity<>. Reflection over
        // the open generic keeps us decoupled from every concrete aggregate.
        var type = entity.GetType();
        while (type is not null)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Entity<>))
            {
                var domainEventsProp = type.GetProperty(nameof(Entity<int>.DomainEvents));
                if (domainEventsProp?.GetValue(entity) is IReadOnlyCollection<IDomainEvent> events)
                {
                    return events.Count > 0;
                }
                return false;
            }
            type = type.BaseType;
        }
        return false;
    }

    private static IReadOnlyList<IDomainEvent> GetDomainEventsSnapshot(object entity)
    {
        var type = entity.GetType();
        while (type is not null)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Entity<>))
            {
                var domainEventsProp = type.GetProperty(nameof(Entity<int>.DomainEvents))!;
                return ((IReadOnlyCollection<IDomainEvent>)domainEventsProp.GetValue(entity)!).ToList();
            }
            type = type.BaseType;
        }
        return Array.Empty<IDomainEvent>();
    }

    private static void RemoveFirstDomainEventsViaBase(object entity, int count)
    {
        // Walk up to Entity<> and call its internal RemoveFirstDomainEvents(int).
        // Same-assembly access (this interceptor lives in AgriSync.BuildingBlocks
        // alongside Entity<>), so reflection is only needed because TId is open.
        var type = entity.GetType();
        while (type is not null)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Entity<>))
            {
                var method = type.GetMethod(
                    nameof(Entity<int>.RemoveFirstDomainEvents),
                    System.Reflection.BindingFlags.Instance
                    | System.Reflection.BindingFlags.NonPublic
                    | System.Reflection.BindingFlags.Public);
                method?.Invoke(entity, new object[] { count });
                return;
            }
            type = type.BaseType;
        }
    }

    private static void ReinsertDomainEventsAtFrontViaBase(object entity, IReadOnlyList<IDomainEvent> events)
    {
        if (events.Count == 0)
        {
            return;
        }
        var type = entity.GetType();
        while (type is not null)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Entity<>))
            {
                var method = type.GetMethod(
                    nameof(Entity<int>.InsertDomainEventsAtFront),
                    System.Reflection.BindingFlags.Instance
                    | System.Reflection.BindingFlags.NonPublic
                    | System.Reflection.BindingFlags.Public);
                method?.Invoke(entity, new object[] { events });
                return;
            }
            type = type.BaseType;
        }
    }

    private readonly record struct PendingClear(object Entity, int Count, IReadOnlyList<IDomainEvent> Events);

    private sealed record PendingState(List<PendingClear> Clears, List<OutboxMessage> Messages);

    private readonly record struct CommitSnapshotEntry(object Entity, IReadOnlyList<IDomainEvent> Events);
}
