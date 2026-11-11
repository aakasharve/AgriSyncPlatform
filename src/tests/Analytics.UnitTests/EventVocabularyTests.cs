using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Xunit;

namespace Analytics.UnitTests;

/// <summary>
/// Lockdown coverage for the frozen event vocabulary (DWC v2 §2.3 +
/// ADR-2026-05-02, which froze it at 13 events; ADR 0027 D1 extends it with
/// the server-only <c>api.refused</c>, making 14). Three classes of assertion:
/// </summary>
/// <list type="number">
/// <item><b>Registry shape</b> — exactly 14 entries, every name matches the ADRs.</item>
/// <item><b>Validator rejects</b> — unknown event_type and missing required prop.</item>
/// <item><b>Round-trip</b> — every entry validates with its own RequiredProps populated.</item>
/// </list>
public sealed class EventVocabularyTests
{
    // -----------------------------------------------------------------
    // Registry shape — guards against silent ADR drift
    // -----------------------------------------------------------------

    [Fact]
    public void Registry_Has_Exactly_14_Entries()
    {
        // Adding an event without a new ADR is a process violation — bump
        // this number deliberately and only after the ADR is signed.
        //
        // 13 -> 14 on 2026-11-11: ADR 0027 D1 adds api.refused (spec
        // control-room-go-live-must-haves-2026-11-10, plan CR-1a Task K3).
        // This test was Registry_Has_Exactly_13_Entries; it is the same pin,
        // moved by name, not a new one. ADR 0027 D6 takes the registry to 15
        // when sync.push_outcome lands (Task C2) — that entry is not pinned
        // here yet, and this number moves again in the commit that adds it.
        EventVocabulary.Registry.Should().HaveCount(14,
            "ADR-2026-05-02 froze the vocabulary at 13 events and ADR 0027 D1 adds api.refused; "
            + "a new ADR is required to extend it further");
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
    // Round-trip — every vocabulary entry validates with its required props
    // -----------------------------------------------------------------

    public static IEnumerable<object[]> AllVocabularyEvents() =>
        EventVocabulary.Registry.Select(kv => new object[] { kv.Key, kv.Value });

    [Theory]
    [MemberData(nameof(AllVocabularyEvents))]
    public void Every_Vocabulary_Event_RoundTrips_With_Its_Required_Props(
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

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeTrue(
            $"event '{eventType}' must validate when every required prop is supplied — failure here means EventVocabulary and IngestEventsValidator have drifted from the ADR");
        result.Errors.Should().BeEmpty();
    }
}
