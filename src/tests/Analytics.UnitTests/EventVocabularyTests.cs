using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Xunit;

namespace Analytics.UnitTests;

/// <summary>
/// Lockdown coverage for the frozen 13-event vocabulary (DWC v2 §2.3 +
/// ADR-2026-05-02). Three classes of assertion:
/// </summary>
/// <list type="number">
/// <item><b>Registry shape</b> — exactly 13 entries, every name matches the ADR.</item>
/// <item><b>Validator rejects</b> — unknown event_type and missing required prop.</item>
/// <item><b>Round-trip</b> — every entry validates with its own RequiredProps populated.</item>
/// </list>
public sealed class EventVocabularyTests
{
    // -----------------------------------------------------------------
    // Registry shape — guards against silent ADR drift
    // -----------------------------------------------------------------

    [Fact]
    public void Registry_Has_Exactly_13_Entries()
    {
        // Adding a 14th event without a new ADR is a process violation —
        // bump this number deliberately and only after the ADR is signed.
        EventVocabulary.Registry.Should().HaveCount(13,
            "ADR-2026-05-02 freezes the vocabulary at 13 events; a new ADR is required to extend it");
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
        };

        EventVocabulary.Registry.Keys.Should().BeEquivalentTo(expected,
            "every ADR row must have a registry entry — drift here is a parity-gate failure waiting to happen");
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
    public void Validator_Accepts_ApiError_With_Empty_Props_Bag()
    {
        // api.error has zero RequiredProps because pre-auth failures fire
        // before farmId is known. The validator MUST accept an empty bag for
        // it; rejecting would force pre-auth code to invent placeholder
        // values, defeating the point.
        var sut = new IngestEventsValidator();
        var cmd = new IngestEventsCommand(new[]
        {
            new IngestedEvent("api.error", new Dictionary<string, object?>()),
        });

        var result = sut.Validate(cmd);

        result.IsValid.Should().BeTrue();
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
