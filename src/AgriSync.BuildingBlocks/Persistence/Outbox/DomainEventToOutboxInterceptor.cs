using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// Sub-plan 03 Task 6: bridges <see cref="Entity{TId}.DomainEvents"/>
/// into the <see cref="OutboxMessage"/> table inside the SAME EF Core
/// transaction as the aggregate's writes. After events are persisted
/// the entity's queue is flushed via <c>ClearDomainEvents()</c>, so a
/// retried <c>SaveChangesAsync</c> never re-emits.
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
/// Idempotency contract: this interceptor is safe to attach to multiple
/// contexts; it only collects events from <see cref="Entity{TId}"/>
/// instances whose <c>DomainEvents</c> are non-empty and clears them
/// in-place. If a row's transaction rolls back, the events stay queued
/// on the in-memory aggregate and will be picked up on the next
/// successful save.
/// </para>
/// </summary>
public sealed class DomainEventToOutboxInterceptor : SaveChangesInterceptor
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly TimeProvider _clock;

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

    private void EnqueueOutboxMessages(DbContext? context)
    {
        if (context is null)
        {
            return;
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

        foreach (var entry in entries)
        {
            var entity = entry.Entity!;
            var events = GetAndClearDomainEvents(entity);

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
        }

        if (messages.Count > 0)
        {
            context.AddRange(messages);
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

    private static IReadOnlyList<IDomainEvent> GetAndClearDomainEvents(object entity)
    {
        var type = entity.GetType();
        while (type is not null)
        {
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Entity<>))
            {
                var domainEventsProp = type.GetProperty(nameof(Entity<int>.DomainEvents))!;
                var clearMethod = type.GetMethod(nameof(Entity<int>.ClearDomainEvents))!;
                var snapshot = ((IReadOnlyCollection<IDomainEvent>)domainEventsProp.GetValue(entity)!).ToList();
                clearMethod.Invoke(entity, null);
                return snapshot;
            }
            type = type.BaseType;
        }
        return Array.Empty<IDomainEvent>();
    }
}
