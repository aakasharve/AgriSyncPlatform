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
/// <b>Known limitation (explicit transactions):</b> when a caller
/// opens its own transaction via <c>dbContext.Database.BeginTransactionAsync</c>
/// and then commits or rolls back independently of <c>SaveChangesAsync</c>,
/// <c>SavedChanges</c> fires after the SQL is sent but BEFORE the
/// caller's <c>Transaction.Commit</c>. A <c>Transaction.Rollback</c>
/// after a successful save would still drop the in-memory events even
/// though the OutboxMessage rows were rolled back with it. Closing
/// that gap requires a paired <c>IDbTransactionInterceptor</c>
/// (<c>TransactionCommitted</c> / <c>TransactionFailed</c>); tracked
/// as a follow-up under <c>T-IGH-03-OUTBOX-WIRING</c>. The interceptor-
/// only fix here is sufficient for ordinary handler paths that rely on
/// the implicit transaction <c>SaveChangesAsync</c> wraps around them.
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

            snapshot.Add(new PendingClear(entity, events.Count));
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
            foreach (var pending in state.Clears)
            {
                RemoveFirstDomainEventsViaBase(pending.Entity, pending.Count);
            }
            _pending.Remove(context);
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

    private readonly record struct PendingClear(object Entity, int Count);

    private sealed record PendingState(List<PendingClear> Clears, List<OutboxMessage> Messages);
}
