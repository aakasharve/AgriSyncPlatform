using System.Diagnostics;
using System.Text.Json;
using Accounts.Application.EventHandlers;
using Accounts.Domain.Events;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence.Outbox;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence.Outbox;

/// <summary>
/// T-IGH-03-OUTBOX-PUBLISHER-IMPL: subscriber dispatch coverage for the
/// first production <see cref="IDomainEventHandler{TEvent}"/>.
///
/// <para>
/// The subscriber records lifecycle transitions via structured logs +
/// Activity events. These tests prove:
/// <list type="bullet">
/// <item>Each of the four <c>Subscription*</c> events is dispatched to
/// the subscriber with the correct payload (caller fan-out by
/// <see cref="DiDomainEventHandlerRegistry"/>).</item>
/// <item>The subscriber reads payload fields without throwing on the
/// expected event shape.</item>
/// <item>An ActivityListener attached to the subscriber's source picks
/// up at least one ActivityEvent per dispatch.</item>
/// </list>
/// </para>
/// </summary>
public sealed class SubscriptionLifecycleAuditSubscriberTests
{
    [Fact]
    public async Task Activated_event_dispatch_invokes_subscriber()
    {
        using var harness = new SubscriberHarness();

        var evt = new SubscriptionActivated(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: DateTime.UtcNow,
            SubscriptionId: new SubscriptionId(Guid.NewGuid()),
            OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            PlanCode: "FARMER_BASIC",
            ValidFromUtc: DateTime.UtcNow,
            ValidUntilUtc: DateTime.UtcNow.AddDays(30),
            IsTrial: true);

        await harness.PublishAsync(evt);

        Assert.Single(harness.RecordedLogs);
        Assert.Equal(LogLevel.Information, harness.RecordedLogs[0].Level);
        Assert.Contains("activated", harness.RecordedLogs[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PastDue_event_dispatch_invokes_subscriber_at_warning_level()
    {
        using var harness = new SubscriberHarness();

        var evt = new SubscriptionPastDue(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: DateTime.UtcNow,
            SubscriptionId: new SubscriptionId(Guid.NewGuid()),
            OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            GracePeriodEndsAtUtc: DateTime.UtcNow.AddDays(7));

        await harness.PublishAsync(evt);

        Assert.Single(harness.RecordedLogs);
        Assert.Equal(LogLevel.Warning, harness.RecordedLogs[0].Level);
        Assert.Contains("past due", harness.RecordedLogs[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Expired_event_dispatch_invokes_subscriber_at_warning_level()
    {
        using var harness = new SubscriberHarness();

        var evt = new SubscriptionExpired(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: DateTime.UtcNow,
            SubscriptionId: new SubscriptionId(Guid.NewGuid()),
            OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            ExpiredAtUtc: DateTime.UtcNow);

        await harness.PublishAsync(evt);

        Assert.Single(harness.RecordedLogs);
        Assert.Equal(LogLevel.Warning, harness.RecordedLogs[0].Level);
        Assert.Contains("expired", harness.RecordedLogs[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Canceled_event_dispatch_invokes_subscriber()
    {
        using var harness = new SubscriberHarness();

        var evt = new SubscriptionCanceled(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: DateTime.UtcNow,
            SubscriptionId: new SubscriptionId(Guid.NewGuid()),
            OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            CanceledAtUtc: DateTime.UtcNow);

        await harness.PublishAsync(evt);

        Assert.Single(harness.RecordedLogs);
        Assert.Equal(LogLevel.Information, harness.RecordedLogs[0].Level);
        Assert.Contains("canceled", harness.RecordedLogs[0].Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Activity_event_emitted_when_listener_attached()
    {
        // Attach an ActivityListener that captures events emitted on
        // ANY ambient Activity, so the subscriber's AddEvent call is
        // observable. Listening to both the test driver source and the
        // subscriber's source so an Activity instance exists to attach
        // events to.
        var capturedEvents = new List<ActivityEvent>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source =>
                source.Name == SubscriptionLifecycleAuditSubscriber.ActivitySource ||
                source.Name == "test-driver",
            Sample = (ref ActivityCreationOptions<ActivityContext> options) => ActivitySamplingResult.AllData,
            ActivityStarted = activity => { },
            ActivityStopped = activity =>
            {
                foreach (var e in activity.Events)
                {
                    capturedEvents.Add(e);
                }
            }
        };
        ActivitySource.AddActivityListener(listener);

        using var ambient = new ActivitySource("test-driver").StartActivity("test-cycle");
        Assert.NotNull(ambient); // guards the test wiring; if listener didn't attach, no Activity to attach events to

        using var harness = new SubscriberHarness();
        var evt = new SubscriptionActivated(
            EventId: Guid.NewGuid(),
            OccurredOnUtc: DateTime.UtcNow,
            SubscriptionId: new SubscriptionId(Guid.NewGuid()),
            OwnerAccountId: new OwnerAccountId(Guid.NewGuid()),
            PlanCode: "FARMER_BASIC",
            ValidFromUtc: DateTime.UtcNow,
            ValidUntilUtc: DateTime.UtcNow.AddDays(30),
            IsTrial: false);

        await harness.PublishAsync(evt);
        ambient.Stop();

        Assert.NotEmpty(capturedEvents);
        Assert.Contains(capturedEvents, e => e.Name == "subscription.activated");
    }

    // ---- Test infrastructure ----

    /// <summary>
    /// Wires the publisher + DI registry + subscriber together and
    /// captures all log emissions. <see cref="PublishAsync"/> simulates
    /// an outbox row by serializing the event and routing it through
    /// <see cref="InProcessOutboxPublisher"/>.
    /// </summary>
    private sealed class SubscriberHarness : IDisposable
    {
        public List<RecordedLog> RecordedLogs { get; } = new();

        private readonly ServiceProvider _root;

        public SubscriberHarness()
        {
            var services = new ServiceCollection();
            services.AddLogging(builder =>
            {
                builder.AddProvider(new RecordingLoggerProvider(RecordedLogs));
                builder.SetMinimumLevel(LogLevel.Trace);
            });
            services.AddScoped<SubscriptionLifecycleAuditSubscriber>();
            services.AddScoped<IDomainEventHandler<SubscriptionActivated>>(
                sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
            services.AddScoped<IDomainEventHandler<SubscriptionPastDue>>(
                sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
            services.AddScoped<IDomainEventHandler<SubscriptionExpired>>(
                sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
            services.AddScoped<IDomainEventHandler<SubscriptionCanceled>>(
                sp => sp.GetRequiredService<SubscriptionLifecycleAuditSubscriber>());
            services.AddScoped<IDomainEventHandlerRegistry, DiDomainEventHandlerRegistry>();
            services.AddScoped<IOutboxPublisher, InProcessOutboxPublisher>();

            _root = services.BuildServiceProvider();
        }

        public async Task PublishAsync<TEvent>(TEvent domainEvent) where TEvent : IDomainEvent
        {
            var json = JsonSerializer.Serialize(domainEvent, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var message = new OutboxMessage(
                id: Guid.NewGuid(),
                type: typeof(TEvent).AssemblyQualifiedName!,
                payload: json,
                occurredOnUtc: DateTime.UtcNow);

            await using var scope = _root.CreateAsyncScope();
            var publisher = scope.ServiceProvider.GetRequiredService<IOutboxPublisher>();
            await publisher.PublishAsync(message);
        }

        public void Dispose() => _root.Dispose();
    }

    public sealed record RecordedLog(LogLevel Level, string Message);

    private sealed class RecordingLoggerProvider : ILoggerProvider
    {
        private readonly List<RecordedLog> _sink;
        public RecordingLoggerProvider(List<RecordedLog> sink) { _sink = sink; }
        public ILogger CreateLogger(string categoryName) => new RecordingLogger(_sink, categoryName);
        public void Dispose() { }
    }

    private sealed class RecordingLogger : ILogger
    {
        private readonly List<RecordedLog> _sink;
        private readonly string _category;
        public RecordingLogger(List<RecordedLog> sink, string category) { _sink = sink; _category = category; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) =>
            _category.Contains("SubscriptionLifecycleAuditSubscriber", StringComparison.Ordinal);
        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            _sink.Add(new RecordedLog(logLevel, formatter(state, exception)));
        }
    }
}
