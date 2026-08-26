using AgriSync.BuildingBlocks.Analytics;
using System.Diagnostics.Metrics;
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Domain.Tests.Sync;

/// <summary>
/// RG5 (Rulebook §4.1 — Observability) regression lock.
///
/// <para>
/// Before 2026-08-26 <c>PushSyncBatchHandler</c> had 71
/// <c>MutationExecutionOutcome.Failure</c> sites and no logger at all, and
/// <c>/sync/push</c> answers HTTP 200 whether or not it refused the farmer's
/// work — so a rejected mutation produced nothing: no log line, no metric, no
/// <c>analytics.events</c> row, no alarm. These tests exist so that regression
/// cannot recur silently.
/// </para>
///
/// <para>
/// They drive the REAL <see cref="PushSyncBatchHandler"/>, not a stand-in for
/// it. The rejection used is the blank-<c>mutationType</c> guard, which is a
/// genuine production rejection path (<c>ShramSafal.InvalidCommand</c>) that
/// returns before any collaborator is touched — hence the null-filled
/// dependency graph below.
/// </para>
/// </summary>
public sealed class PushSyncBatchRejectionObservabilityTests
{
    private static readonly Guid ActorUserId = Guid.Parse("aaaaaaaa-1111-2222-3333-444444444444");
    private static readonly Guid FarmId = Guid.Parse("bbbbbbbb-1111-2222-3333-555555555555");

    [Fact]
    public async Task Rejected_mutation_emits_exactly_one_structured_Warning()
    {
        var logger = new CapturingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        var response = await handler.HandleAsync(RejectableBatch());

        // Pre-condition: this really is a rejection on the wire.
        response.IsSuccess.Should().BeTrue("the batch call itself succeeds — rejections live inside the 200");
        // Asserted, not suppressed with `!`. CI builds Release /warnaserror, so
        // CS8602 is an error there; and a null Value would mean the handler
        // returned success with no payload, which is exactly the kind of
        // swallowed failure this test exists to catch.
        response.Value.Should().NotBeNull("a successful batch must carry a payload");
        response.Value!.Results.Should().ContainSingle()
            .Which.Status.Should().Be(PushSyncBatchHandler.RejectedStatus);

        var warnings = logger.Entries
            .Where(e => e.Level == LogLevel.Warning)
            .ToList();

        warnings.Should().ContainSingle(
            "one refused mutation must produce exactly one operator-visible line — "
            + "zero is the defect being fixed, more than one is alarm noise");

        var warning = warnings[0];

        // Warning, not Information/Debug: production Serilog minimum level is
        // Warning (appsettings.Production.json), so anything quieter than this
        // is discarded on the box and the observer would not exist.
        warning.Level.Should().Be(LogLevel.Warning);

        // The stable literal a CloudWatch Logs metric filter matches on.
        warning.RenderedMessage.Should().StartWith("SyncMutationRejected: ");
    }

    [Fact]
    public async Task Rejection_Warning_carries_every_field_an_operator_needs_to_act()
    {
        var logger = new CapturingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        await handler.HandleAsync(RejectableBatch());

        var properties = logger.Entries.Single(e => e.Level == LogLevel.Warning).Properties;

        properties.Should().ContainKey("MutationType");
        // CHANGED with the CWE-117 fix on PR #56. This used to require the raw
        // value "   " unmodified, on the reasoning that an operator should see
        // exactly what the client sent. That is right in spirit and was wrong
        // here: MutationType is client-supplied, so it now passes through
        // LogSafe.Text, and a whitespace-only value collapses to "unknown".
        //
        // The new rendering is also the more honest one — three spaces in a log
        // line read as a field nobody filled in, while "unknown" says a value
        // arrived and carried nothing usable. The raw value is not lost to the
        // operator either: it is still on the wire in the response the client
        // receives. What is gone is a client's ability to put a newline here and
        // forge a log line, which is the whole point of the guard.
        properties["MutationType"].Should().Be(LogSafe.Unknown,
            "client-supplied values are sanitised before they reach a log sink");
        properties.Should().ContainKey("ErrorCode");
        properties["ErrorCode"].Should().Be("ShramSafal.InvalidCommand");
        properties.Should().ContainKey("ActorUserId");
        properties["ActorUserId"].Should().Be(ActorUserId);
        properties.Should().ContainKey("ActorRole");
        properties["ActorRole"].Should().Be("Owner");
        properties.Should().ContainKey("FarmId");
        properties["FarmId"].Should().Be(FarmId.ToString());
        properties.Should().ContainKey("DeviceId");
        properties["DeviceId"].Should().Be("device-rg5");
        properties.Should().ContainKey("ClientRequestId");
        properties["ClientRequestId"].Should().Be("req-rg5");
        properties.Should().ContainKey("AppVersion");
        properties["AppVersion"].Should().Be("1.0.7");
    }

    [Fact]
    public async Task Rejection_Warning_never_carries_the_error_message_or_payload_content()
    {
        var logger = new CapturingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        var response = await handler.HandleAsync(RejectableBatch());

        // The wire response still carries the human-readable reason for the
        // client — only the SERVER LOG is redacted.
        response.Value.Should().NotBeNull("a successful batch must carry a payload");
        response.Value!.Results[0].ErrorMessage.Should().NotBeNullOrWhiteSpace();

        var warning = logger.Entries.Single(e => e.Level == LogLevel.Warning);

        // ErrorMessage is excluded on purpose: several rejection sites
        // interpolate caller-supplied values into it and Result.Error
        // .Description can carry domain text.
        warning.Properties.Should().NotContainKey("ErrorMessage");
        warning.RenderedMessage.Should().NotContain(response.Value.Results[0].ErrorMessage!);

        // Nothing but farmId is ever lifted out of the payload.
        warning.RenderedMessage.Should().NotContain(PayloadSecret);
        warning.Properties.Values.Should().NotContain(PayloadSecret);
    }

    [Fact]
    public async Task Rejected_mutation_increments_the_alarmable_counter_with_low_cardinality_tags()
    {
        var measurements = new List<(long Value, Dictionary<string, object?> Tags)>();

        // MeterListener.Start() publishes instruments that already exist. Force
        // the static Meter to be constructed first so this test does not depend
        // on another test in the class having touched SyncPushMetrics earlier.
        System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(
            typeof(SyncPushMetrics).TypeHandle);

        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, l) =>
        {
            if (instrument.Meter.Name == SyncPushMetrics.MeterName
                && instrument.Name == SyncPushMetrics.MutationRejectedInstrumentName)
            {
                l.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((_, value, tags, _) =>
        {
            var copied = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var tag in tags)
            {
                copied[tag.Key] = tag.Value;
            }
            measurements.Add((value, copied));
        });
        listener.Start();

        var handler = BuildHandler(new CapturingLogger<PushSyncBatchHandler>());
        await handler.HandleAsync(RejectableBatch());

        measurements.Should().ContainSingle("one refused mutation is one increment");
        measurements[0].Value.Should().Be(1);

        // Tags must stay low-cardinality — an alarm on a metric tagged with
        // farm/user/device ids would be unusable and expensive.
        measurements[0].Tags.Keys.Should().BeEquivalentTo(new[] { "mutation_type", "error_code" });
        measurements[0].Tags["error_code"].Should().Be("ShramSafal.InvalidCommand");
        measurements[0].Tags.Values.Should().NotContain(ActorUserId.ToString());
        measurements[0].Tags.Values.Should().NotContain(FarmId.ToString());
        measurements[0].Tags.Values.Should().NotContain("device-rg5");

        // mutationType is client-supplied. A value outside SyncMutationCatalog
        // must collapse to one bucket, or a client could mint unbounded time
        // series (and unbounded CloudWatch cost) just by sending junk.
        measurements[0].Tags["mutation_type"].Should().Be("unregistered");
        measurements[0].Tags["mutation_type"].Should().NotBe("   ");
    }

    [Fact]
    public async Task An_applied_mutation_emits_no_rejection_signal()
    {
        // Guards the other direction: if this ever starts firing on success,
        // the alarm built on it becomes noise and gets muted, which is how
        // observability dies quietly.
        var logger = new CapturingLogger<PushSyncBatchHandler>();
        var handler = BuildHandler(logger);

        // An empty batch is the cheapest no-rejection path through the same loop.
        var response = await handler.HandleAsync(new PushSyncBatchCommand(
            DeviceId: "device-rg5",
            AuthenticatedUserId: ActorUserId,
            ActorRole: "Owner",
            Mutations: [],
            AppVersion: "1.0.7"));

        response.IsSuccess.Should().BeTrue();
        logger.Entries.Should().BeEmpty();
    }

    /// <summary>
    /// Structural lock on the argument that makes this fix complete: the
    /// rejection log sits at ONE seam, and every mutation result — from all 71
    /// <c>MutationExecutionOutcome.Failure</c> sites, the blank-field guards,
    /// the <c>DbUpdateException</c> path and the store-failure path — passes
    /// through it. If a future change adds a second place where a result enters
    /// the response, that path would bypass the observability and this test
    /// fails instead of the alarm silently under-counting.
    /// </summary>
    [Fact]
    public void Handler_has_exactly_one_seam_where_a_mutation_result_enters_the_response()
    {
        var source = File.ReadAllText(HandlerSourcePath());

        CountOccurrences(source, "results.Add(").Should().Be(
            1,
            "the rejection log in HandleAsync is only exhaustive while there is a single "
            + "place a SyncMutationResultDto enters the response list");

        CountOccurrences(source, "LogMutationRejected(").Should().Be(
            2,
            "exactly one call site (inside the results.Add loop) plus the method declaration");

        CountOccurrences(source, "\"failed\"").Should().Be(
            1,
            "the only remaining occurrence must be the RejectedStatus constant declaration — "
            + "a second raw literal means a producer that the observability check cannot see");
    }

    private const string PayloadSecret = "Ramchandra Patil";

    private static PushSyncBatchCommand RejectableBatch()
    {
        // Blank mutationType — a real client-side bug shape, rejected with
        // ShramSafal.InvalidCommand before any collaborator is touched.
        // The payload carries a farmId (lifted into the log) alongside a
        // person's name (must never be).
        using var document = JsonDocument.Parse(
            $$"""{"farmId":"{{FarmId}}","workerName":"{{PayloadSecret}}"}""");

        return new PushSyncBatchCommand(
            DeviceId: "device-rg5",
            AuthenticatedUserId: ActorUserId,
            ActorRole: "Owner",
            Mutations:
            [
                new PushSyncMutationCommand(
                    ClientRequestId: "req-rg5",
                    MutationType: "   ",
                    Payload: document.RootElement.Clone())
            ],
            AppVersion: "1.0.7");
    }

    /// <summary>
    /// Builds the real handler with only the two collaborators the rejection
    /// path actually touches (<see cref="IClock"/> for the response timestamp,
    /// the logger under test). Everything else is left null deliberately: if a
    /// future change makes this path reach another dependency, this test
    /// NullReferences loudly rather than passing while measuring nothing.
    /// Reflection over the single constructor keeps the test from breaking
    /// every time an unrelated dependency is added.
    /// </summary>
    private static PushSyncBatchHandler BuildHandler(ILogger<PushSyncBatchHandler> logger)
    {
        var constructor = typeof(PushSyncBatchHandler).GetConstructors().Single();
        var arguments = constructor.GetParameters()
            .Select(parameter => parameter.ParameterType switch
            {
                var t when t == typeof(IClock) => (object?)new FrozenClock(),
                var t when t == typeof(ILogger<PushSyncBatchHandler>) => logger,
                _ => null
            })
            .ToArray();

        return (PushSyncBatchHandler)constructor.Invoke(arguments);
    }

    private static string HandlerSourcePath()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(
                current.FullName,
                "apps", "ShramSafal", "ShramSafal.Application", "UseCases", "Sync",
                "PushSyncBatch", "PushSyncBatchHandler.cs");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new FileNotFoundException(
            "Could not locate PushSyncBatchHandler.cs from the test execution directory.");
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = haystack.IndexOf(needle, StringComparison.Ordinal);
        while (index >= 0)
        {
            count++;
            index = haystack.IndexOf(needle, index + needle.Length, StringComparison.Ordinal);
        }

        return count;
    }

    private sealed class FrozenClock : IClock
    {
        public DateTime UtcNow { get; } = new(2026, 8, 26, 9, 0, 0, DateTimeKind.Utc);
    }

    private sealed record CapturedLogEntry(
        LogLevel Level,
        string RenderedMessage,
        IReadOnlyDictionary<string, object?> Properties);

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        private readonly List<CapturedLogEntry> _entries = [];

        public IReadOnlyList<CapturedLogEntry> Entries => _entries;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var properties = new Dictionary<string, object?>(StringComparer.Ordinal);
            if (state is IReadOnlyList<KeyValuePair<string, object?>> structured)
            {
                foreach (var pair in structured)
                {
                    if (pair.Key != "{OriginalFormat}")
                    {
                        properties[pair.Key] = pair.Value;
                    }
                }
            }

            _entries.Add(new CapturedLogEntry(
                logLevel,
                formatter(state, exception),
                properties));
        }
    }
}
