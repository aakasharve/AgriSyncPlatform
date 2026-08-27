// spec: 2026-07-13-labour-attendance-approval-design
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR PHASE 2 — <b>the outbox must record a NAME, not a position.</b>
///
/// <para><b>The rule being guarded.</b> <c>ssf.daily_logs.scope</c> stores the
/// name (<c>'MultiPlot'</c>). The outbox payload is a second DURABLE record of
/// the same fact, and it is written once and read years later. If it stores the
/// ordinal, then inserting a member into <see cref="DailyLogScope"/> silently
/// re-maps every historical payload: the row still says <c>MultiPlot</c> while
/// the payload for the same log now decodes to whatever member moved into that
/// position. Two durable records of one fact disagree and nothing errors.
/// Doctrine <c>P8</c> — provenance over precision — is the principle; this is
/// its serialization form.</para>
///
/// <para><b>Why the options object is specified so exactly.</b>
/// <c>DomainEventToOutboxInterceptor</c> builds
/// <c>new JsonSerializerOptions(JsonSerializerDefaults.Web)</c> and serializes
/// against the event's RUNTIME type. Web defaults carry camelCase naming and
/// case-insensitive reads but <b>no</b> string-enum converter, so a test that
/// helpfully adds <c>JsonStringEnumConverter</c> to its own options proves
/// nothing about what the interceptor writes. These tests therefore construct
/// the same options object the interceptor does and nothing else — that is the
/// whole point of the test. (P2.1 report §11.7 #17 states this constraint in
/// the same words.)</para>
///
/// <para><b>Independence note.</b> Expectations come from the plan's Plot /
/// MultiPlot / Farm names (§C1-AMENDED, handoff §1) and from §11.7 #17/#18.
/// The enum declaration and the interceptor body were not relied on for the
/// expected VALUES — only the serializer configuration, which is the contract
/// under test.</para>
/// </summary>
public sealed class DailyLogCreatedEventOutboxPayloadTests
{
    /// <summary>The interceptor's exact options object — deliberately unconfigured.</summary>
    private static readonly JsonSerializerOptions InterceptorOptions = new(JsonSerializerDefaults.Web);

    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly Guid PlotA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid PlotB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid CycleA = Guid.Parse("dddddddd-0000-0000-0000-00000000000d");

    [Theory]
    [InlineData(DailyLogScope.Plot, "Plot")]
    [InlineData(DailyLogScope.MultiPlot, "MultiPlot")]
    [InlineData(DailyLogScope.Farm, "Farm")]
    public void The_outbox_payload_records_the_scope_by_name(DailyLogScope scope, string expectedName)
    {
        var payload = SerializeAsTheInterceptorDoes(MakeEvent(scope));

        payload.Should().Contain($"\"scope\":\"{expectedName}\"",
            "the durable payload must name the farmer's assertion — a reader five years from now must not need " +
            "to know which member index this enum happened to have on the day the row was written");
    }

    [Fact]
    public void The_outbox_payload_never_records_the_scope_as_a_bare_number()
    {
        foreach (var scope in new[] { DailyLogScope.Plot, DailyLogScope.MultiPlot, DailyLogScope.Farm })
        {
            var payload = SerializeAsTheInterceptorDoes(MakeEvent(scope));

            payload.Should().NotContain("\"scope\":0")
                .And.NotContain("\"scope\":1")
                .And.NotContain("\"scope\":2",
                    $"an ordinal payload for {scope} silently re-maps the moment anyone inserts a member into the enum, " +
                    "and inserting a member is a source change nobody would flag as a data migration");
        }
    }

    /// <summary>
    /// §11.7 #18 — the backward-compatibility half. Payloads written before the
    /// converter existed carry <c>"scope":0</c> and no <c>plotIds</c> member.
    /// They must still read, and they must read as <c>Plot</c> with an empty
    /// set — which is TRUE of every log that could exist at that time, since
    /// the migration classifies all of them as <c>scope='Plot'</c>.
    /// </summary>
    [Fact]
    public void A_legacy_payload_carrying_the_ordinal_and_no_plot_set_still_deserializes()
    {
        const string legacyPayload = """
        {
          "eventId": "eeeeeeee-0000-0000-0000-0000000000ee",
          "occurredOnUtc": "2026-08-01T10:00:00Z",
          "dailyLogId": "ffffffff-0000-0000-0000-0000000000ff",
          "farmId": "11111111-1111-1111-1111-111111111111",
          "scope": 0,
          "plotId": "aaaaaaaa-0000-0000-0000-00000000000a",
          "cropCycleId": "dddddddd-0000-0000-0000-00000000000d",
          "logDate": "2026-08-01"
        }
        """;

        var restored = JsonSerializer.Deserialize<DailyLogCreatedEvent>(legacyPayload, InterceptorOptions);

        restored.Should().NotBeNull(
            "the fix must be two-way: a payload already sitting in ssf.outbox_messages cannot be re-written");
        restored!.Scope.Should().Be(DailyLogScope.Plot,
            "every log that existed before this change was plot-scoped, and the migration classifies all of them as Plot");
        restored.PlotIds.Should().BeEmpty(
            "a legacy payload carries no plotIds member, and the absence must read as an empty set — never as null");
        restored.PlotId.Should().Be(PlotA, "the legacy single-plot projection still reads");
        restored.CropCycleId.Should().Be(CycleA);
    }

    [Fact]
    public void A_round_trip_through_the_interceptors_options_preserves_the_whole_spatial_assertion()
    {
        foreach (var original in new[]
                 {
                     MakeEvent(DailyLogScope.Plot),
                     MakeEvent(DailyLogScope.MultiPlot),
                     MakeEvent(DailyLogScope.Farm),
                 })
        {
            var restored = JsonSerializer.Deserialize<DailyLogCreatedEvent>(
                SerializeAsTheInterceptorDoes(original), InterceptorOptions);

            restored.Should().NotBeNull();
            restored!.Scope.Should().Be(original.Scope);
            restored.PlotIds.Should().BeEquivalentTo(original.PlotIds,
                "the event carries the same spatial assertion as the row it describes");
            restored.PlotId.Should().Be(original.PlotId);
            restored.CropCycleId.Should().Be(original.CropCycleId);
        }
    }

    private static string SerializeAsTheInterceptorDoes(DailyLogCreatedEvent domainEvent)
        => JsonSerializer.Serialize(domainEvent, domainEvent.GetType(), InterceptorOptions);

    private static DailyLogCreatedEvent MakeEvent(DailyLogScope scope) => scope switch
    {
        DailyLogScope.Plot => new DailyLogCreatedEvent(
            eventId: Guid.NewGuid(), occurredOnUtc: new DateTime(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc),
            dailyLogId: Guid.NewGuid(), farmId: AnyFarmId, scope: DailyLogScope.Plot,
            plotIds: new[] { PlotA }, plotId: PlotA, cropCycleId: CycleA,
            logDate: new DateOnly(2026, 8, 12)),
        DailyLogScope.MultiPlot => new DailyLogCreatedEvent(
            eventId: Guid.NewGuid(), occurredOnUtc: new DateTime(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc),
            dailyLogId: Guid.NewGuid(), farmId: AnyFarmId, scope: DailyLogScope.MultiPlot,
            plotIds: new[] { PlotA, PlotB }, plotId: null, cropCycleId: null,
            logDate: new DateOnly(2026, 8, 12)),
        _ => new DailyLogCreatedEvent(
            eventId: Guid.NewGuid(), occurredOnUtc: new DateTime(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc),
            dailyLogId: Guid.NewGuid(), farmId: AnyFarmId, scope: DailyLogScope.Farm,
            plotIds: [], plotId: null, cropCycleId: null,
            logDate: new DateOnly(2026, 8, 12)),
    };
}
