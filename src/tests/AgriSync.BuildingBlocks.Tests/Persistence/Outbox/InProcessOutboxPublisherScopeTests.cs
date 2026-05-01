using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-WIRING hardening: <see cref="DiDomainEventHandlerRegistry"/>
/// must resolve handlers from the SCOPE the dispatcher created, not
/// from the root container. The original registration was singleton,
/// which captured the root <see cref="IServiceProvider"/> and would
/// either throw or hand back a root-resolved instance for any handler
/// with a scoped dependency (e.g. <c>DbContext</c>).
/// </summary>
public sealed class InProcessOutboxPublisherScopeTests
{
    [Fact]
    public async Task Scoped_handler_with_scoped_dependency_resolves_from_dispatcher_scope()
    {
        // Arrange: minimal DI container with a scoped service that the
        // handler depends on. The publisher + registry are both scoped.
        // Each scope MUST get a fresh ScopedContext instance — the test
        // proves the registry doesn't leak the root scope.
        var services = new ServiceCollection();
        services.AddLogging(); // registers ILogger<T> open generic
        services.AddScoped<ScopedContext>();
        services.AddScoped<IDomainEventHandler<TestPayloadEvent>, ScopedHandler>();
        services.AddScoped<IDomainEventHandlerRegistry, DiDomainEventHandlerRegistry>();
        services.AddScoped<IOutboxPublisher, InProcessOutboxPublisher>();

        var root = services.BuildServiceProvider();

        // Build an OutboxMessage payload as if the interceptor wrote
        // it. Type must round-trip via Type.GetType so we use the
        // assembly-qualified name.
        var payload = new TestPayloadEvent("hello", Guid.NewGuid(), DateTime.UtcNow);
        var json = JsonSerializer.Serialize<TestPayloadEvent>(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var message = new OutboxMessage(
            id: Guid.NewGuid(),
            type: typeof(TestPayloadEvent).AssemblyQualifiedName!,
            payload: json,
            occurredOnUtc: DateTime.UtcNow);

        // Act: dispatch through TWO independent scopes. Each scope
        // creates its own ScopedContext, and the handler captures
        // which instance it saw.
        Guid scope1ContextId;
        Guid scope2ContextId;

        await using (var scope1 = root.CreateAsyncScope())
        {
            var publisher = scope1.ServiceProvider.GetRequiredService<IOutboxPublisher>();
            await publisher.PublishAsync(message);
            scope1ContextId = scope1.ServiceProvider.GetRequiredService<ScopedContext>().Id;
        }

        await using (var scope2 = root.CreateAsyncScope())
        {
            var publisher = scope2.ServiceProvider.GetRequiredService<IOutboxPublisher>();
            await publisher.PublishAsync(message);
            scope2ContextId = scope2.ServiceProvider.GetRequiredService<ScopedContext>().Id;
        }

        // Assert: the handler ran in BOTH scopes (recorded onto the
        // static call list), and each ran against its own
        // ScopedContext (not the same root-scoped instance).
        Assert.Equal(2, ScopedHandler.SeenContextIds.Count);
        Assert.Equal(scope1ContextId, ScopedHandler.SeenContextIds[0]);
        Assert.Equal(scope2ContextId, ScopedHandler.SeenContextIds[1]);
        Assert.NotEqual(scope1ContextId, scope2ContextId);
    }

    // ---- Test doubles ----

    private sealed record TestPayloadEvent(string Note, Guid EventId, DateTime OccurredOnUtc) : IDomainEvent;

    /// <summary>
    /// Stand-in for a scoped service like a DbContext. Each scope gets
    /// a fresh instance with a unique Id so we can verify scope
    /// boundaries.
    /// </summary>
    private sealed class ScopedContext
    {
        public Guid Id { get; } = Guid.NewGuid();
    }

    private sealed class ScopedHandler : IDomainEventHandler<TestPayloadEvent>
    {
        // Static list of "context ids the handler saw" — readable by
        // the test after each scope publishes. ResetSafe per test via
        // a clear at the start; xUnit creates a fresh test class
        // instance per fact, but statics persist across tests in the
        // same assembly run, so we clear in the constructor below.
        public static readonly List<Guid> SeenContextIds = new();

        private readonly ScopedContext _ctx;

        public ScopedHandler(ScopedContext ctx)
        {
            _ctx = ctx;
        }

        public Task HandleAsync(TestPayloadEvent domainEvent, CancellationToken cancellationToken)
        {
            SeenContextIds.Add(_ctx.Id);
            return Task.CompletedTask;
        }
    }

    public InProcessOutboxPublisherScopeTests()
    {
        // Reset statics between tests — defensive in case more facts are added.
        ScopedHandler.SeenContextIds.Clear();
    }
}
