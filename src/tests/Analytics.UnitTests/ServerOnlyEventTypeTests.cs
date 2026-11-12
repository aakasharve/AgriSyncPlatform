using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Analytics.UnitTests;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (plan CR-1c Task V4, review
/// round 2, finding 1).
///
/// <para>
/// Seven event types are written by the server itself and by nothing else.
/// Until this round nothing enforced that: <c>POST /analytics/ingest</c>
/// accepted every type in the vocabulary, so any signed-in account could post
/// an <c>app.seen</c> row naming any person on any version (and the same for
/// <c>api.error</c>, <c>log.created</c> and the rest). These tests hold the
/// door shut:
/// </para>
/// <list type="number">
/// <item>the server-only set is exactly the seven names, and every other
/// vocabulary entry is one a client may send;</item>
/// <item><see cref="IngestEventsValidator.ValidateFromClient"/> refuses each
/// of the seven with <c>analytics.server_only_event_type</c>, on top of
/// whatever the shape check reports, and still accepts the eight client
/// types (the released app sends only those, so no old app breaks);</item>
/// <item><see cref="IngestEventsValidator.Validate"/> stays the shape check
/// any producer can use, and still accepts the seven;</item>
/// <item><see cref="IngestEventsHandler"/>, which serves the client route,
/// writes nothing at all for a batch that carries one of the seven.</item>
/// </list>
///
/// <para>
/// The two lists of names below are written out by hand on purpose. A test
/// that looped over <see cref="EventVocabulary.ServerOnly"/> itself would
/// pass against an empty set.
/// </para>
/// </summary>
public sealed class ServerOnlyEventTypeTests
{
    private const string ServerOnlyCode = "analytics.server_only_event_type";

    /// <summary>Written by the server and by nothing else.</summary>
    private static readonly string[] ServerOnlyTypes =
    [
        "log.created", "ai.invocation", "api.error", "api.refused",
        "app.seen", "worker.named", "admin.farmer_lookup",
    ];

    /// <summary>The eight types the app's own schema can send.</summary>
    private static readonly string[] ClientTypes =
    [
        "closure.started", "closure.submitted", "closure.abandoned",
        "proof.attached", "closure_summary.viewed", "closure.verified",
        "next_action.created", "client.error",
    ];

    private static readonly Guid Farmer = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid SomebodyElse = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    // -----------------------------------------------------------------
    // The set
    // -----------------------------------------------------------------

    [Fact]
    public void Server_only_set_is_exactly_the_seven_names()
    {
        EventVocabulary.ServerOnly.Should().BeEquivalentTo(ServerOnlyTypes,
            "these seven are written by the server's own middleware, handlers and jobs; a name "
            + "missing here is a row any signed-in account can forge, and a name too many is a "
            + "client event the released app can no longer send");
        EventVocabulary.ServerOnly.Should().HaveCount(7);

        foreach (var name in ServerOnlyTypes)
        {
            EventVocabulary.IsServerOnly(name).Should().BeTrue($"'{name}' is written by the server only");
            EventVocabulary.IsKnown(name).Should().BeTrue(
                $"'{name}' is server-only AND in the vocabulary: server-only is a rule about who "
                + "may write a known type, not a second list of names");
        }

        foreach (var name in ClientTypes)
        {
            EventVocabulary.IsServerOnly(name).Should().BeFalse(
                $"'{name}' is one of the eight types the app itself sends");
        }

        EventVocabulary.IsServerOnly("closure.never_heard_of_it").Should().BeFalse(
            "a name outside the vocabulary is unknown, which is a different refusal");

        // Every vocabulary entry is on exactly one side. A sixteenth entry
        // fails here until somebody decides which side it is on.
        EventVocabulary.Registry.Keys.Should().BeEquivalentTo(
            ServerOnlyTypes.Concat(ClientTypes),
            "seven server-only types and eight client types are the whole vocabulary; a new "
            + "entry has to be put on one side deliberately");
    }

    // -----------------------------------------------------------------
    // The client door: ValidateFromClient
    // -----------------------------------------------------------------

    [Fact]
    public void Ingest_from_a_client_refuses_every_server_only_type()
    {
        IngestEventsValidator.ServerOnlyEventTypeCode.Should().Be(ServerOnlyCode,
            "the code is what the client and the logs see; it is part of the contract");

        var sut = new IngestEventsValidator();

        // Each of the seven, alone and perfectly well-formed, so the ONLY
        // thing wrong with it is who is sending it.
        foreach (var type in ServerOnlyTypes)
        {
            var outcome = sut.ValidateFromClient(Batch(WellFormed(type)));

            outcome.IsValid.Should().BeFalse($"a client may not write '{type}'");
            outcome.Errors.Should().ContainSingle(
                $"'{type}' has every required prop, so being server-only is its one fault");
            outcome.Errors[0].Code.Should().Be(ServerOnlyCode);
            outcome.Errors[0].EventType.Should().Be(type);
            outcome.Errors[0].Index.Should().Be(0);
        }

        // The forgery review round 2 found: any signed-in account naming any
        // person on any version.
        var forged = sut.ValidateFromClient(Batch(
            new IngestedEvent("app.seen", new Dictionary<string, object?>
            {
                ["appVersion"] = "9.9.9",
                ["personId"] = SomebodyElse.ToString("D"),
            })));

        forged.IsValid.Should().BeFalse(
            "an app.seen row a client wrote would put a person of its choosing on a version of "
            + "its choosing, outside the once-a-day rule");
        forged.Errors.Should().ContainSingle();
        forged.Errors[0].Code.Should().Be(ServerOnlyCode);

        // One error per server-only event, each at its own place in the
        // batch, and none for the honest events between them.
        var mixed = sut.ValidateFromClient(Batch(
            WellFormed("api.error"),
            WellFormed("closure.started"),
            WellFormed("app.seen"),
            WellFormed("client.error")));

        mixed.IsValid.Should().BeFalse("one server-only event is enough to refuse the batch");
        mixed.Errors.Select(e => (e.Index, e.EventType, e.Code)).Should().BeEquivalentTo(
            new[]
            {
                (0, (string?)"api.error", ServerOnlyCode),
                (2, (string?)"app.seen", ServerOnlyCode),
            },
            "every server-only event is reported, at its own index, in one pass");

        // On top of the shape check, not in place of it: an app.seen with no
        // props and a type nobody has heard of. Everything Validate reports
        // is still reported, plus one server-only error for the app.seen.
        var broken = Batch(
            new IngestedEvent("app.seen", new Dictionary<string, object?>()),
            new IngestedEvent("closure.never_heard_of_it", new Dictionary<string, object?>()));

        var shape = sut.Validate(broken);
        var fromClient = sut.ValidateFromClient(broken);

        shape.Errors.Should().NotBeEmpty("this batch is malformed as well as forbidden");
        fromClient.IsValid.Should().BeFalse();
        fromClient.Errors
            .Where(e => e.Code != ServerOnlyCode)
            .Select(e => (e.Index, e.EventType, e.Code))
            .Should().BeEquivalentTo(
                shape.Errors.Select(e => (e.Index, e.EventType, e.Code)),
                "the client check reports everything the shape check reports");
        fromClient.Errors
            .Where(e => e.Code == ServerOnlyCode)
            .Select(e => (e.Index, e.EventType))
            .Should().BeEquivalentTo(
                new[] { (0, (string?)"app.seen") },
                "plus one error for the server-only event; an unknown type is not server-only");
    }

    [Fact]
    public void Ingest_from_a_client_still_accepts_client_types()
    {
        var sut = new IngestEventsValidator();

        // The released app (1.0.17 and this lane alike) can send only these
        // eight. Refusing any of them would break a phone already in a
        // farmer's hand (P11).
        foreach (var type in ClientTypes)
        {
            var outcome = sut.ValidateFromClient(Batch(WellFormed(type)));

            outcome.IsValid.Should().BeTrue($"the app itself sends '{type}'");
            outcome.Errors.Should().BeEmpty();
        }

        var all = sut.ValidateFromClient(Batch(ClientTypes.Select(WellFormed).ToArray()));
        all.IsValid.Should().BeTrue("a batch of all eight client types is an ordinary flush");
        all.Errors.Should().BeEmpty();

        var empty = sut.ValidateFromClient(new IngestEventsCommand(Array.Empty<IngestedEvent>()));
        empty.IsValid.Should().BeTrue("an empty batch has nothing to refuse");
        empty.Errors.Should().BeEmpty();

        // And it is still the shape check underneath: a client event with a
        // required prop missing is refused for that, with the old code.
        var missing = sut.ValidateFromClient(Batch(
            new IngestedEvent("closure.started", new Dictionary<string, object?>
            {
                ["farmId"] = Guid.NewGuid().ToString(),
                ["method"] = "voice",
            })));

        missing.IsValid.Should().BeFalse();
        missing.Errors.Should().ContainSingle();
        missing.Errors[0].Code.Should().Be("analytics.missing_required_prop");
        missing.Errors[0].MissingProps.Should().NotBeNull().And.Contain("ts");
    }

    // -----------------------------------------------------------------
    // The shape check: Validate
    // -----------------------------------------------------------------

    [Fact]
    public void The_shape_check_still_accepts_server_only_types()
    {
        var sut = new IngestEventsValidator();

        // Validate answers one question: is this a known type with its
        // required props. It is the check any producer can use, the server's
        // own included, so it must not start refusing the server's own rows.
        foreach (var type in ServerOnlyTypes)
        {
            var outcome = sut.Validate(Batch(WellFormed(type)));

            outcome.IsValid.Should().BeTrue(
                $"'{type}' with its required props is a well-shaped event; who may send it is "
                + "ValidateFromClient's question, not this one's");
            outcome.Errors.Should().BeEmpty();
        }

        var everything = sut.Validate(Batch(ServerOnlyTypes.Concat(ClientTypes).Select(WellFormed).ToArray()));
        everything.IsValid.Should().BeTrue();
        everything.Errors.Should().NotContain(e => e.Code == ServerOnlyCode,
            "the shape check never reports the server-only code");
    }

    // -----------------------------------------------------------------
    // The handler behind POST /analytics/ingest
    // -----------------------------------------------------------------

    [Fact]
    public async Task A_refused_batch_writes_nothing()
    {
        foreach (var type in ServerOnlyTypes)
        {
            var writer = new RecordingWriter();
            var handler = new IngestEventsHandler(
                writer,
                new IngestEventsValidator(),
                new FixedClock(new DateTime(2026, 11, 12, 10, 0, 0, DateTimeKind.Utc)),
                NullLogger<IngestEventsHandler>.Instance);

            // An honest event first, then the forbidden one: the batch is
            // refused whole, so the honest event is not written either.
            var result = await handler.HandleAsync(
                Batch(WellFormed("closure.started"), WellFormed(type)),
                Farmer);

            result.IsFailure.Should().BeTrue($"a client batch carrying '{type}' is refused");
            result.Error.Code.Should().Be(ServerOnlyCode);
            result.Error.Kind.Should().Be(ErrorKind.Validation,
                "a validation failure is what the route answers 400 for; the app drops the batch and does not retry");

            writer.Calls.Should().Be(0, $"nothing is handed to the writer for a batch carrying '{type}'");
            writer.Events.Should().BeEmpty(
                "not the forbidden row, and not the honest one beside it: a half-written batch "
                + "would be retried by nobody and explained by nothing");

            // The control: the same handler and the same writer do write when
            // the batch is one a client may send. Without it, "wrote nothing"
            // would also be true of a writer that can never capture anything.
            var accepted = await handler.HandleAsync(Batch(WellFormed("closure.started")), Farmer);

            accepted.IsSuccess.Should().BeTrue();
            writer.Events.Should().ContainSingle();
            writer.Events[0].EventType.Should().Be("closure.started");
        }
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    private static IngestEventsCommand Batch(params IngestedEvent[] events) => new(events);

    /// <summary>
    /// The named event with every required prop present and non-null, taken
    /// from the vocabulary itself. The validators check presence only, so a
    /// placeholder value is enough.
    /// </summary>
    private static IngestedEvent WellFormed(string eventType)
    {
        var props = EventVocabulary.Registry[eventType].RequiredProps.ToDictionary(
            keySelector: p => p,
            elementSelector: object? (_) => "synthetic");

        return new IngestedEvent(eventType, props);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class RecordingWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();

        public int Calls { get; private set; }

        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
        {
            Calls++;
            Events.Add(analyticsEvent);
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
        {
            Calls++;
            Events.AddRange(events);
            return Task.CompletedTask;
        }
    }
}
