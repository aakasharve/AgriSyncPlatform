using AgriSync.BuildingBlocks.Analytics;
using Analytics.Application.UseCases.IngestEvents;
using Analytics.Domain.Vocabulary;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// api.error is server-only: the middleware writes it through IAnalyticsWriter
/// and never passes IngestEventsValidator, so "required" would otherwise be
/// enforced for client-submitted events and silently optional for our own —
/// exactly the class of gap this plan closes.
///
/// The vocabulary is the judge here, not a list of key names copied into the
/// test. If EventVocabulary and RequestObservabilityProps ever disagree, this
/// goes red rather than one of them quietly winning.
/// </summary>
public sealed class ApiErrorContractParityTests
{
    private static Dictionary<string, object?> BuiltApiErrorProps(
        string? stampedCode, int status, int? rejected)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.Path = "/shramsafal/logs";
        ctx.Response.StatusCode = status;
        if (stampedCode is not null)
        {
            ctx.Items[RequestObservabilityKeys.ErrorCode] = stampedCode;
        }

        return RequestObservabilityProps.Build(
            ctx,
            eventType: AnalyticsEventType.ApiError,
            status: status,
            latencyMs: 7,
            rejectedWorkItems: rejected,
            rejectedWorkReason: rejected > 0 ? "sync.mutation_rejected" : null,
            farmId: null,
            traceId: "trace-1",
            unhandledExceptionType: null);
    }

    [Theory]
    // A catalogued failure.
    [InlineData("ShramSafal.CropCycleOverlap", 409, null)]
    // A failure with no catalogued Error — still has to name itself, honestly.
    [InlineData(null, 500, null)]
    // A 200 that refused work inside it (RG5).
    [InlineData("ShramSafal.LabourAssignment.Conflict", 200, 3)]
    public void The_middleware_payload_satisfies_the_vocabulary(
        string? stampedCode, int status, int? rejected)
    {
        var props = BuiltApiErrorProps(stampedCode, status, rejected);

        var outcome = new IngestEventsValidator().Validate(
            new IngestEventsCommand(new[] { new IngestedEvent("api.error", props) }));

        outcome.IsValid.Should().BeTrue(
            "the middleware bypasses IngestEventsValidator at runtime, so this test is the "
            + "only thing holding the api.error contract on the path that actually produces "
            + "them. Missing: "
            + string.Join(", ", outcome.Errors.SelectMany(e => e.MissingProps ?? [])));
    }

    [Fact]
    public void The_gate_can_actually_fail()
    {
        // A test that cannot fail is not a gate. Drop each required prop in turn
        // and prove the validator rejects — otherwise the theory above is
        // asserting nothing.
        var required = EventVocabulary.Registry["api.error"].RequiredProps;
        required.Should().NotBeEmpty();

        foreach (var key in required)
        {
            var mutilated = BuiltApiErrorProps("ShramSafal.CropCycleOverlap", 409, null);
            mutilated.Remove(key);

            var outcome = new IngestEventsValidator().Validate(
                new IngestEventsCommand(new[] { new IngestedEvent("api.error", mutilated) }));

            outcome.IsValid.Should().BeFalse($"'{key}' is required, so removing it must be rejected");
            outcome.Errors[0].MissingProps.Should().Contain(key);
        }
    }

    [Fact]
    public void Every_required_prop_is_supplied_with_a_non_null_value()
    {
        // IngestEventsValidator treats a null VALUE as missing
        // (IngestEventsValidator.cs:82), so presence alone is not enough.
        var props = BuiltApiErrorProps(null, 500, null);

        foreach (var key in EventVocabulary.Registry["api.error"].RequiredProps)
        {
            props.Should().ContainKey(key);
            props[key].Should().NotBeNull($"'{key}' is required and a null value counts as missing");
        }
    }
}
