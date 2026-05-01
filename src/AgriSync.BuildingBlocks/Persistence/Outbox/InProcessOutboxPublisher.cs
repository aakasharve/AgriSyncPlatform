using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING: in-process implementation of
/// <see cref="IOutboxPublisher"/>. Deserializes the queued payload back
/// into its concrete <see cref="IDomainEvent"/> type and dispatches it
/// to every registered <see cref="IDomainEventHandler{TEvent}"/>.
///
/// <para>
/// Designed for the typical "monolith with multiple bounded contexts"
/// shape where a domain event raised in one module needs to land in
/// another module's read-model or projection on the same process. For
/// genuine cross-process delivery (e.g. RabbitMQ / SNS) a separate
/// publisher implementation registers under the same interface and
/// replaces this one.
/// </para>
///
/// <para>
/// <b>No-handler-is-fine semantics.</b> An event with zero registered
/// handlers is treated as successfully published — the outbox row gets
/// <c>ProcessedOnUtc</c> stamped and the OutboxDispatcher never retries
/// it. This matches the "fire and forget; subscribe by importing the
/// handler" pattern; missing subscribers are a deployment-time
/// observation, not a runtime error.
/// </para>
/// </summary>
public sealed class InProcessOutboxPublisher : IOutboxPublisher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IDomainEventHandlerRegistry _registry;
    private readonly ILogger<InProcessOutboxPublisher> _logger;

    public InProcessOutboxPublisher(
        IDomainEventHandlerRegistry registry,
        ILogger<InProcessOutboxPublisher> logger)
    {
        _registry = registry;
        _logger = logger;
    }

    public async Task PublishAsync(OutboxMessage message, CancellationToken cancellationToken = default)
    {
        var eventType = Type.GetType(message.Type, throwOnError: false);
        if (eventType is null)
        {
            // Type couldn't be loaded — log and treat as fatal (the
            // dispatcher will mark this row failed). A redeploy with a
            // newer assembly typically resolves this.
            throw new InvalidOperationException(
                $"OutboxMessage {message.Id} has unknown event type '{message.Type}'.");
        }

        if (!typeof(IDomainEvent).IsAssignableFrom(eventType))
        {
            throw new InvalidOperationException(
                $"OutboxMessage {message.Id} type '{message.Type}' does not implement IDomainEvent.");
        }

        var domainEvent = (IDomainEvent?)JsonSerializer.Deserialize(
            message.Payload,
            eventType,
            JsonOptions);
        if (domainEvent is null)
        {
            throw new InvalidOperationException(
                $"OutboxMessage {message.Id} payload deserialized to null.");
        }

        var handlers = _registry.ResolveHandlers(eventType);
        if (handlers.Count == 0)
        {
            _logger.LogDebug(
                "OutboxMessage {OutboxMessageId} of type {EventType} has no registered handlers; treating as published.",
                message.Id, eventType.FullName);
            return;
        }

        foreach (var handler in handlers)
        {
            await handler.HandleAsync(domainEvent, cancellationToken);
        }
    }
}

/// <summary>
/// Erased per-event-type handler view used by
/// <see cref="InProcessOutboxPublisher"/>. Concrete subscribers
/// implement <see cref="IDomainEventHandler{TEvent}"/> and the registry
/// adapts them.
/// </summary>
public interface IDomainEventHandlerAdapter
{
    Task HandleAsync(IDomainEvent domainEvent, CancellationToken cancellationToken);
}

public interface IDomainEventHandler<in TEvent> where TEvent : IDomainEvent
{
    Task HandleAsync(TEvent domainEvent, CancellationToken cancellationToken);
}

public interface IDomainEventHandlerRegistry
{
    IReadOnlyList<IDomainEventHandlerAdapter> ResolveHandlers(Type eventType);
}

/// <summary>
/// Default registry that resolves handlers from the DI container per
/// dispatch. Keep handlers scoped (one per outbox message) so they get
/// fresh DbContexts.
/// </summary>
public sealed class DiDomainEventHandlerRegistry : IDomainEventHandlerRegistry
{
    private readonly IServiceProvider _services;

    public DiDomainEventHandlerRegistry(IServiceProvider services)
    {
        _services = services;
    }

    public IReadOnlyList<IDomainEventHandlerAdapter> ResolveHandlers(Type eventType)
    {
        var handlerInterface = typeof(IDomainEventHandler<>).MakeGenericType(eventType);
        var enumerableType = typeof(IEnumerable<>).MakeGenericType(handlerInterface);

        var raw = _services.GetService(enumerableType);
        if (raw is not System.Collections.IEnumerable enumerable)
        {
            return Array.Empty<IDomainEventHandlerAdapter>();
        }

        var adapters = new List<IDomainEventHandlerAdapter>();
        foreach (var handler in enumerable)
        {
            if (handler is null)
            {
                continue;
            }
            adapters.Add(new ReflectionDomainEventHandlerAdapter(handler, eventType));
        }
        return adapters;
    }
}

internal sealed class ReflectionDomainEventHandlerAdapter : IDomainEventHandlerAdapter
{
    private readonly object _handler;
    private readonly System.Reflection.MethodInfo _handleMethod;

    public ReflectionDomainEventHandlerAdapter(object handler, Type eventType)
    {
        _handler = handler;
        var handlerInterface = typeof(IDomainEventHandler<>).MakeGenericType(eventType);
        _handleMethod = handlerInterface.GetMethod(nameof(IDomainEventHandler<IDomainEvent>.HandleAsync))
            ?? throw new InvalidOperationException(
                $"IDomainEventHandler<{eventType.Name}>.HandleAsync not found.");
    }

    public async Task HandleAsync(IDomainEvent domainEvent, CancellationToken cancellationToken)
    {
        var task = (Task?)_handleMethod.Invoke(_handler, new object[] { domainEvent, cancellationToken });
        if (task is not null)
        {
            await task;
        }
    }
}
