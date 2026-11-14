using System.Reflection;
using AgriSync.BuildingBlocks.Analytics;
using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Xunit;

namespace Analytics.UnitTests;

/// <summary>
/// Lockdown coverage for the frozen event vocabulary (DWC v2 §2.3 +
/// ADR-2026-05-02, which froze it at 13 events; ADR 0027 D1 extends it with
/// the server-only <c>api.refused</c>, making 14; ADR 0028 adds the
/// server-only <c>app.seen</c>, making 15; ADR 0027 D2 adds the client event
/// <c>sync.push_outcome</c>, making 16). Three classes of assertion:
/// </summary>
/// <list type="number">
/// <item><b>Registry shape</b> — exactly 16 entries, every name matches the ADRs.</item>
/// <item><b>Validator rejects</b> — unknown event_type and missing required prop.</item>
/// <item><b>Shape check</b> — every entry passes <c>Validate</c> with its own RequiredProps populated.</item>
/// </list>
/// <remarks>
/// Every validator test in this class calls <c>IngestEventsValidator.Validate</c>,
/// the SHAPE check: is the type in the vocabulary, and are its required props
/// there. Since review round 2 of spec control-room-app-versions-2026-11-12
/// that is no longer the same question as "may a client send this": seven of
/// the sixteen types are server-only, and <c>ValidateFromClient</c> refuses
/// them at <c>POST /analytics/ingest</c>. That door is held in
/// <see cref="ServerOnlyEventTypeTests"/>.
/// </remarks>
public sealed class EventVocabularyTests
{
    // -----------------------------------------------------------------
    // Registry shape — guards against silent ADR drift
    // -----------------------------------------------------------------

    [Fact]
    public void Registry_Has_Exactly_16_Entries()
    {
        // Adding an event without a new ADR is a process violation — bump
        // this number deliberately and only after the ADR is signed.
        //
        // 13 -> 14 on 2026-11-11: ADR 0027 D1 adds api.refused (spec
        // control-room-go-live-must-haves-2026-11-10, plan CR-1a Task K3).
        // This test was Registry_Has_Exactly_13_Entries; it is the same pin,
        // moved by name, not a new one.
        //
        // 14 -> 15 on 2026-11-12: ADR 0028 adds app.seen (spec
        // control-room-app-versions-2026-11-12, plan CR-1c Task V1). This
        // test was Registry_Has_Exactly_14_Entries; again the same pin, moved
        // by name.
        //
        // 15 -> 16 on 2026-11-14: ADR 0027 D2 and D6 add sync.push_outcome
        // (spec control-room-go-live-must-haves-2026-11-10, plan CR-1a Task
        // C2). This test was Registry_Has_Exactly_15_Entries; once more the
        // same pin, moved by name. The app-versions work landed on this lane
        // first, so this is the move the note that stood here said the
        // second lane would make.
        EventVocabulary.Registry.Should().HaveCount(16,
            "ADR-2026-05-02 froze the vocabulary at 13 events, ADR 0027 adds api.refused and "
            + "sync.push_outcome, and ADR 0028 adds app.seen; a new ADR is required to extend it further");
    }

    [Fact]
    public void Registry_Contains_All_ADR_Event_Names()
    {
        var expected = new[]
        {
            "closure.started", "closure.submitted", "closure.abandoned",
            "proof.attached", "closure_summary.viewed", "closure.verified",
            "next_action.created", "log.created", "ai.invocation",
            "api.error", "client.error", "worker.named", "admin.farmer_lookup",
            // ADR 0027 D1 (server-only; written by RequestObservabilityMiddleware).
            "api.refused",
            // ADR 0028 (server-only; written by AppSeenMiddleware).
            "app.seen",
            // ADR 0027 D2 (a client event; sent by the farmer app's sync worker).
            "sync.push_outcome",
        };

        EventVocabulary.Registry.Keys.Should().BeEquivalentTo(expected,
            "every ADR row must have a registry entry — drift here is a parity-gate failure waiting to happen");
    }

    [Fact]
    public void ApiError_requires_the_error_to_name_itself_and_state_the_work_outcome()
    {
        var def = EventVocabulary.Registry["api.error"];

        def.RequiredProps.Should().Contain("errorCode",
            "an error that cannot say which error it was is the defect this contract exists to prevent");
        def.RequiredProps.Should().Contain("workKept",
            "whether the farmer's work survived is the difference between an annoyance and a lost day");
        def.RequiredProps.Should().Contain("statusCode",
            "AdminOpsRepository and AdminFarmerHealthRepository read "
            + "props->>'statusCode'; this registry said 'status' for months while the emitter "
            + "said 'statusCode'");
        def.RequiredProps.Should().NotContain("status",
            "nothing has ever emitted or read a key called 'status' — requiring it would have "
            + "broken three live queries");
        def.Optional.Should().Contain(new[] { "farmId", "message", "appVersion" });
    }

    [Fact]
    public void Api_refused_requires_endpoint_and_status_code()
    {
        // ADR 0027 D1 — spec control-room-go-live-must-haves-2026-11-10, plan
        // CR-1a Task K3. A refused write on a route outside the critical list,
        // from a signed-in person. It is deliberately NOT an api.error, so it
        // does not inherit api.error's contract.
        var def = EventVocabulary.Registry["api.refused"];

        def.RequiredProps.Should().BeEquivalentTo(new[] { "endpoint", "statusCode" },
            "a refusal always knows where it happened and how it was answered, and nothing "
            + "else is guaranteed: errorCode is present only when a mapper stamped one, and "
            + "nobody observed a work outcome, so requiring errorCode or workKept would force "
            + "the middleware to invent a value");
        def.RequiredProps.Should().NotContain("status",
            "the key is statusCode, as on api.error — nothing has ever emitted or read 'status'");

        def.Optional.Should().BeEquivalentTo(
            new[]
            {
                "errorCode", "route", "appVersion", "serverBuild",
                "personId", "routeFarmId", "latencyMs", "traceId",
            },
            "these are the keys ADR 0027 D1 lists, and analytics.events is append-only: a key "
            + "that is not in the ADR should not reach a row through this entry unreviewed");
    }

    [Fact]
    public void App_seen_requires_app_version_and_person()
    {
        // ADR 0028 — spec control-room-app-versions-2026-11-12, plan CR-1c
        // Task V1. A signed-in person used the app on a version: written by
        // the server at most once per person, version and UTC day.
        var def = EventVocabulary.Registry["app.seen"];

        def.RequiredProps.Should().BeEquivalentTo(new[] { "appVersion", "personId" },
            "the row exists to say WHO used WHICH version, so it is never written without "
            + "both; the person is a prop because the actor_user_id column stays empty, or "
            + "merely opening the app would count as weekly-active");

        def.Optional.Should().BeEquivalentTo(new[] { "platform" },
            "the platform is written only when the app reported android, and that is the whole "
            + "list: analytics.events is append-only, so no device identifier, farm or endpoint "
            + "may reach a row through this entry unreviewed (ADR 0027 D7)");
    }

    [Fact]
    public void Sync_push_outcome_requires_its_three_counts_and_the_app_version()
    {
        // ADR 0027 D2 — spec control-room-go-live-must-haves-2026-11-10, plan
        // CR-1a Task C2. The farmer app's own report, at most once per sync
        // cycle, of what happened to work that had failed.
        var def = EventVocabulary.Registry["sync.push_outcome"];

        def.RequiredProps.Should().BeEquivalentTo(
            new[] { "recoveredCount", "needsReviewCount", "pendingAfter", "appVersion" },
            "the three counts are the report; and the row carries a person, not a phone, so "
            + "the app version is what tells a 1.0.18 report from anything else");

        def.Optional.Should().BeEquivalentTo(new[] { "firstFailedAtUtc" },
            "that is the whole list (ADR 0027 D2: it carries nothing else). There is no "
            + "attempts count, because the queue's counter is reset when a backoff is cleared, "
            + "and no dropped count, because nothing in a push cycle drops a save; and "
            + "analytics.events is append-only, so no farmer text, phone number or device id "
            + "may reach a row through this entry unreviewed (D7)");

        var sut = new IngestEventsValidator();

        // A full bag is accepted.
        var full = sut.Validate(Outcome(FullOutcome()));

        full.IsValid.Should().BeTrue("a report with its three counts and its app version is complete");
        full.Errors.Should().BeEmpty();

        // The optional first-failure time may be absent: a report of saves
        // sent for review only has no recovered save to date.
        var noFirstFailure = FullOutcome();
        noFirstFailure.Remove("firstFailedAtUtc");

        sut.Validate(Outcome(noFirstFailure)).IsValid.Should().BeTrue();

        // Zero is a count, not a missing value: "nothing is left waiting" is
        // exactly what a good report says.
        var zeros = FullOutcome();
        zeros["recoveredCount"] = 0;
        zeros["pendingAfter"] = 0;

        sut.Validate(Outcome(zeros)).IsValid.Should().BeTrue(
            "a count of 0 is present and not null; refusing it would refuse the report the "
            + "founder's acceptance walk expects (still waiting 0)");

        // A bag missing any one required key is refused, and the refusal
        // names that key and no other.
        foreach (var key in new[] { "pendingAfter", "appVersion", "recoveredCount", "needsReviewCount" })
        {
            var bag = FullOutcome();
            bag.Remove(key);

            var outcome = sut.Validate(Outcome(bag));

            outcome.IsValid.Should().BeFalse($"a report with no {key} is not a report");
            outcome.Errors.Should().ContainSingle();
            outcome.Errors[0].Code.Should().Be("analytics.missing_required_prop");
            outcome.Errors[0].EventType.Should().Be("sync.push_outcome");
            outcome.Errors[0].MissingProps.Should().BeEquivalentTo(new[] { key });
        }

        // A null value is a missing value.
        var nullVersion = FullOutcome();
        nullVersion["appVersion"] = null;

        var refused = sut.Validate(Outcome(nullVersion));

        refused.IsValid.Should().BeFalse();
        refused.Errors[0].MissingProps.Should().BeEquivalentTo(new[] { "appVersion" });
    }

    [Fact]
    public void Sync_push_outcome_has_its_event_type_constant()
    {
        // Plan CR-1a Task C2: AnalyticsEventType.SyncPushOutcome. Read by
        // reflection so that this project still builds, and this one test is
        // red, until the constant exists; nothing else here depends on it.
        var field = typeof(AnalyticsEventType).GetField(
            "SyncPushOutcome", BindingFlags.Public | BindingFlags.Static);

        field.Should().NotBeNull(
            "server code that reads or writes the type must name it through one constant, "
            + "as it does for api.refused and app.seen");
        field!.IsLiteral.Should().BeTrue("it is a const, like its neighbours");
        field.GetRawConstantValue().Should().Be("sync.push_outcome",
            "the constant and the vocabulary key are one name; a difference of one character "
            + "would write rows no reader finds");

        EventVocabulary.IsKnown((string)field.GetRawConstantValue()!).Should().BeTrue();
    }

    /// <summary>A report as the 1.0.18 app sends it: three counts, its version, and the time of the first failure.</summary>
    private static Dictionary<string, object?> FullOutcome() => new()
    {
        ["recoveredCount"] = 2,
        ["needsReviewCount"] = 1,
        ["pendingAfter"] = 0,
        ["appVersion"] = "1.0.18",
        ["firstFailedAtUtc"] = "2026-11-14T06:30:00.000Z",
    };

    private static IngestEventsCommand Outcome(Dictionary<string, object?> props) =>
        new(new[] { new IngestedEvent("sync.push_outcome", props) });

    [Theory]
    [InlineData("closure.started")]
    [InlineData("ai.invocation")]
    [InlineData("admin.farmer_lookup")]
    public void IsKnown_Returns_True_For_Registered_Names(string name)
    {
        EventVocabulary.IsKnown(name).Should().BeTrue();
    }

    [Theory]
    [InlineData("closure.unknown")]
    [InlineData("CLOSURE.STARTED")] // case-sensitive
    [InlineData("")]
    public void IsKnown_Returns_False_For_Unregistered_Names(string name)
    {
        EventVocabulary.IsKnown(name).Should().BeFalse();
    }

    // -----------------------------------------------------------------
    // Validator — rejection paths
    // -----------------------------------------------------------------

    [Fact]
    public void Validator_Rejects_Unknown_Event_Type()
    {
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("closure.never_heard_of_it",
                new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("analytics.unknown_event_type");
        result.Errors[0].EventType.Should().Be("closure.never_heard_of_it");
    }

    [Fact]
    public void Validator_Rejects_Missing_Required_Prop()
    {
        var sut = new IngestEventsValidator();
        // closure.started requires { farmId, method, ts } — drop `ts` to trip
        // the missing-required-prop branch without also tripping unknown-type.
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("closure.started", new Dictionary<string, object?>
            {
                ["farmId"] = Guid.NewGuid().ToString(),
                ["method"] = "voice",
            }),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("analytics.missing_required_prop");
        result.Errors[0].MissingProps.Should().NotBeNull().And.Contain("ts");
    }

    [Fact]
    public void Validator_Treats_Null_Prop_Value_As_Missing()
    {
        // A producer that sends `{ farmId: "..", method: "voice", ts: null }`
        // would land SQL NULL in props->>'ts' and matviews would treat it as
        // absent. Reject at the boundary so the failure surfaces immediately.
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("closure.started", new Dictionary<string, object?>
            {
                ["farmId"] = Guid.NewGuid().ToString(),
                ["method"] = "voice",
                ["ts"] = null,
            }),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors[0].MissingProps.Should().Contain("ts");
    }

    [Fact]
    public void Validator_Reports_Multiple_Missing_Props_In_Single_Error()
    {
        var sut = new IngestEventsValidator();
        // closure.submitted requires 5 props — supply only 1.
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("closure.submitted", new Dictionary<string, object?>
            {
                ["farmId"] = Guid.NewGuid().ToString(),
            }),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].MissingProps.Should().BeEquivalentTo(
            new[] { "logId", "method", "durationMs", "fields_used" });
    }

    [Fact]
    public void Validator_Rejects_Missing_EventType_String()
    {
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("", new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors[0].Code.Should().Be("analytics.event_type_missing");
    }

    [Fact]
    public void Validator_Accumulates_Errors_Across_Batch()
    {
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("closure.unknown", new Dictionary<string, object?>()),
            new IngestedEvent("closure.started", new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().HaveCount(2,
            "the validator must surface every offending event in one pass — partial reporting forces N round trips");
        result.Errors[0].Index.Should().Be(0);
        result.Errors[1].Index.Should().Be(1);
    }

    [Fact]
    public void Validator_Accepts_Empty_Batch()
    {
        var sut = new IngestEventsValidator();

        var result = sut.Validate(new IngestEventsCommand(Array.Empty<IngestedEvent>()));

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void Validator_Rejects_An_ApiError_That_Cannot_Name_Itself()
    {
        // SUPERSEDES Validator_Accepts_ApiError_With_Empty_Props_Bag (2026-05-02),
        // whose rationale was: "api.error has zero RequiredProps because pre-auth
        // failures fire before farmId is known. Rejecting would force pre-auth
        // code to invent placeholder values, defeating the point."
        //
        // That argument survives for farmId — which is exactly why farmId stays
        // OPTIONAL. It does not extend to the other four. A pre-auth failure
        // still knows its endpoint, its status code, and whether it refused any
        // work; and if no catalogued Error produced it, it says so with the
        // literal "Uncatalogued". Nothing is forced to invent anything.
        //
        // Reversed by founder decision 2026-08-30, spec
        // error-capture-engine, Locked decisions. ADR-2026-05-02 amended to match.
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("api.error", new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle();
        result.Errors[0].Code.Should().Be("analytics.missing_required_prop");
        result.Errors[0].MissingProps.Should().BeEquivalentTo(
            new[] { "endpoint", "statusCode", "errorCode", "workKept" });
    }

    // -----------------------------------------------------------------
    // Shape check — every vocabulary entry passes Validate with its required props
    // -----------------------------------------------------------------

    public static IEnumerable<object[]> AllVocabularyEvents() =>
        EventVocabulary.Registry.Select(kv => new object[] { kv.Key, kv.Value });

    /// <summary>
    /// Was <c>Every_Vocabulary_Event_RoundTrips_With_Its_Required_Props</c>;
    /// the same theory, renamed on 2026-11-12 (spec
    /// control-room-app-versions-2026-11-12, plan CR-1c Task V4) to say which
    /// check it exercises.
    ///
    /// <para>
    /// When it was written, <c>Validate</c> was the only check and the ingest
    /// route used it, so this theory passing for <c>app.seen</c> (and for
    /// <c>api.error</c>, <c>log.created</c> and the other server-written
    /// types) read as "the ingest validator accepts it". That reading was the
    /// defect review round 2 found. What the theory holds is narrower and
    /// still wanted: <c>Validate</c> is the SHAPE check any producer can use,
    /// and every entry in the vocabulary, server-only or not, passes it once
    /// its required props are there. It says nothing about who may send the
    /// event.
    /// </para>
    ///
    /// <para>
    /// The last assertion states the other half next to it, so the two are
    /// not confused again: the very same well-shaped event, coming from a
    /// client, is accepted only when its type is not server-only.
    /// </para>
    /// </summary>
    [Theory]
    [MemberData(nameof(AllVocabularyEvents))]
    public void Every_Vocabulary_Event_Passes_The_Shape_Check_With_Its_Required_Props(
        string eventType, EventDefinition def)
    {
        var sut = new IngestEventsValidator();

        // Build a synthetic prop bag that satisfies every required key with
        // a non-null placeholder. The validator only checks presence + non-null,
        // so any sentinel value works.
        var props = def.RequiredProps.ToDictionary(
            keySelector: p => p,
            elementSelector: object? (_) => "synthetic");

        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent(eventType, props),
        });

        // The shape check: Validate, not ValidateFromClient.
        var shape = sut.Validate(cmd);

        shape.IsValid.Should().BeTrue(
            $"event '{eventType}' must pass the shape check when every required prop is supplied — failure here means EventVocabulary and IngestEventsValidator have drifted from the ADR");
        shape.Errors.Should().BeEmpty();

        // The client door is a different check. Passing the shape check does
        // not mean a client may send the event.
        var fromClient = sut.ValidateFromClient(cmd);

        fromClient.IsValid.Should().Be(!EventVocabulary.IsServerOnly(eventType),
            $"a well-shaped '{eventType}' is accepted from a client only if it is not a server-only type; "
            + "the shape check passing for a server-only type is not permission to ingest it");
    }
}
