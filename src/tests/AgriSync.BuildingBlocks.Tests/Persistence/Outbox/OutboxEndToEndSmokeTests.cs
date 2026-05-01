using System.Text.Json;
using Accounts.Application.EventHandlers;
using Accounts.Domain.Events;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-PUBLISHER-IMPL: production-shape smoke proving the
/// end-to-end dispatch path runs against a real subscriber:
///
/// <para>
/// <c>OutboxDbContext (pending row) → OutboxDispatcher.RunCycleAsync →
/// InProcessOutboxPublisher (DI-resolved) → DiDomainEventHandlerRegistry
/// → SubscriptionLifecycleAuditSubscriber.HandleAsync</c>
/// </para>
///
/// <para>
/// This test does NOT exercise the writer-side interceptor (that's
/// already covered by <c>OutboxE2ETests</c> in the integration suite);
/// it pre-populates the OutboxDbContext with a serialized
/// <see cref="SubscriptionActivated"/> payload and asserts the
/// subscriber observes it. Runs against EF in-memory rather than
/// Testcontainers Postgres because the dispatcher's polling /
/// publisher / registry plumbing is provider-agnostic, and we already
/// pay the Testcontainers cost in <c>AnalyticsMigrationTests</c>.
/// </para>
///
/// <para>
/// What "production-shape" means here: real DI container with the same
/// service descriptors the Bootstrapper uses (publisher, registry,
/// scoped subscriber, interface-by-interface registrations), and a
/// real <see cref="OutboxDispatcher.RunCycleAsync"/> call rather than
/// a hand-rolled loop. The pieces under test are exactly what runs in
/// production.
/// </para>
/// </summary>
public sealed class OutboxEndToEndSmokeTests
{
    [Fact]
    public async Task SubscriptionActivated_outbox_row_dispatches_to_lifecycle_subscriber_and_marks_processed()
    {
        // Capture the subscriber's log lines to prove it ran.
        var logSink = new List<(LogLevel Level, string Message)>();
        var services = new ServiceCollection();
        services.AddLogging(builder =>
        {
            builder.AddProvider(new CapturingLoggerProvider(logSink));
            builder.SetMinimumLevel(LogLevel.Trace);
        });

        // Outbox plumbing — same shape as production registration.
        var dbName = $"outbox-e2e-smoke-{Guid.NewGuid():N}";
        services.AddDbContext<OutboxDbContext>(opts => opts.UseInMemoryDatabase(dbName));
        services.AddScoped<IDomainEventHandlerRegistry, DiDomainEventHandlerRegistry>();
        services.AddScoped<IOutboxPublisher, InProcessOutboxPublisher>();

        // Subscriber wiring — single instance, four interface aliases.
        services.AddScoped<SubscriptionLifecycleAuditSubscriber>();
        services.AddScoped<IDomainEventHandler<SubscriptionActivated>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionPastDue>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionExpired>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
        services.AddScoped<IDomainEventHandler<SubscriptionCanceled>>(
            sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());

        await using var root = services.BuildServiceProvider();

        // Seed an outbox row simulating an interceptor enqueue. Type
        // and payload shape match what DomainEventToOutboxInterceptor
        // produces (assembly-qualified type name + JSON of the event
        // record).
        var subscriptionId = new SubscriptionId(Guid.NewGuid());
        var ownerAccountId = new OwnerAccountId(Guid.NewGuid());
        var occurredOnUtc = DateTime.UtcNow;
        var validUntilUtc = occurredOnUtc.AddDays(30);

        var domainEvent = new SubscriptionActivated(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: occurredOnUtc,
            SubscriptionId: subscriptionId,
            OwnerAccountId: ownerAccountId,
            PlanCode: "FARMER_BASIC",
            ValidFromUtc: occurredOnUtc,
            ValidUntilUtc: validUntilUtc,
            IsTrial: true);

        await using (var seedScope = root.CreateAsyncScope())
        {
            var ctx = seedScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            var message = new OutboxMessage(
                id: Guid.NewGuid(),
                type: typeof(SubscriptionActivated).AssemblyQualifiedName!,
                payload: JsonSerializer.Serialize(
                    domainEvent, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                occurredOnUtc: occurredOnUtc);
            ctx.OutboxMessages.Add(message);
            await ctx.SaveChangesAsync();
        }

        // Drive one dispatcher cycle from the same in-memory database.
        // Must use a fresh scope so the registry resolves handlers
        // through the dispatcher's scope (the production semantic).
        await using (var dispatchScope = root.CreateAsyncScope())
        {
            var ctx = dispatchScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            var publisher = dispatchScope.ServiceProvider.GetRequiredService<IOutboxPublisher>();
            var processed = await OutboxDispatcher.RunCycleAsync(
                ctx, publisher, TimeProvider.System, NullLogger.Instance,
                OutboxDispatcher.DefaultMaxAttempts, default);

            Assert.Equal(1, processed);
        }

        // Verify the subscriber actually ran (its structured log
        // mentions "activated") and the outbox row got marked
        // processed.
        Assert.Contains(logSink, entry =>
            entry.Level == LogLevel.Information &&
            entry.Message.Contains("activated", StringComparison.OrdinalIgnoreCase) &&
            entry.Message.Contains(subscriptionId.Value.ToString(), StringComparison.OrdinalIgnoreCase));

        await using (var verifyScope = root.CreateAsyncScope())
        {
            var ctx = verifyScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            var rows = await ctx.OutboxMessages.ToListAsync();
            Assert.Single(rows);
            Assert.NotNull(rows[0].ProcessedOnUtc);
            Assert.Null(rows[0].DeadLetteredAt);
            Assert.Equal(0, rows[0].AttemptCount);
            Assert.Null(rows[0].Error);
        }
    }

    [Fact]
    public async Task SubscriptionLifecycle_subscriber_unknown_event_type_does_not_crash_dispatcher()
    {
        // Even if a payload references an event type with no handler
        // registered, the dispatcher's "no handler is fine" semantic
        // should mark the row processed instead of dead-lettering it.
        var services = new ServiceCollection();
        services.AddLogging();
        var dbName = $"outbox-noop-{Guid.NewGuid():N}";
        services.AddDbContext<OutboxDbContext>(opts => opts.UseInMemoryDatabase(dbName));
        services.AddScoped<IDomainEventHandlerRegistry, DiDomainEventHandlerRegistry>();
        services.AddScoped<IOutboxPublisher, InProcessOutboxPublisher>();
        // No subscriber registrations — empty handler set.

        await using var root = services.BuildServiceProvider();

        await using (var seedScope = root.CreateAsyncScope())
        {
            var ctx = seedScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            ctx.OutboxMessages.Add(new OutboxMessage(
                id: Guid.NewGuid(),
                type: typeof(SubscriptionExpired).AssemblyQualifiedName!,
                payload: JsonSerializer.Serialize(new SubscriptionExpired(
                    EventId: Guid.NewGuid(),
                    OccurredOnUtc: DateTime.UtcNow,
                    SubscriptionId: new SubscriptionId(Guid.NewGuid()),
                    OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
                    ExpiredAtUtc: DateTime.UtcNow),
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)),
                occurredOnUtc: DateTime.UtcNow));
            await ctx.SaveChangesAsync();
        }

        await using (var dispatchScope = root.CreateAsyncScope())
        {
            var ctx = dispatchScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            var publisher = dispatchScope.ServiceProvider.GetRequiredService<IOutboxPublisher>();
            await OutboxDispatcher.RunCycleAsync(
                ctx, publisher, TimeProvider.System, NullLogger.Instance,
                OutboxDispatcher.DefaultMaxAttempts, default);
        }

        await using (var verifyScope = root.CreateAsyncScope())
        {
            var ctx = verifyScope.ServiceProvider.GetRequiredService<OutboxDbContext>();
            var rows = await ctx.OutboxMessages.ToListAsync();
            Assert.Single(rows);
            // Marked processed (no handlers but no failure either).
            Assert.NotNull(rows[0].ProcessedOnUtc);
            Assert.Null(rows[0].DeadLetteredAt);
        }
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<(LogLevel, string)> _sink;
        public CapturingLoggerProvider(List<(LogLevel, string)> sink) { _sink = sink; }
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(_sink);
        public void Dispose() { }
    }

    private sealed class CapturingLogger : ILogger
    {
        private readonly List<(LogLevel, string)> _sink;
        public CapturingLogger(List<(LogLevel, string)> sink) { _sink = sink; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            _sink.Add((logLevel, formatter(state, exception)));
        }
    }
}
