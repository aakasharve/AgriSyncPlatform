// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR PHASE 2 A2a — <b>a pulled log must reconstruct as exactly what the
/// farmer said, not a lossy projection of it.</b>
///
/// <para><b>The defect these tests pin.</b> Before this change
/// <c>DailyLogDto</c> carried no <c>Scope</c> and no <c>PlotIds</c>. A device
/// could therefore only rebuild a log's context from the single
/// <c>PlotId</c> — which is NULL for both non-plot scopes — so the first pull
/// after a <c>MultiPlot</c> log was acknowledged rewrote that log's context from
/// <c>{A,B,C}</c> to <c>{}</c>, i.e. into a farm-wide log, on the originating
/// device. That is a silent rewrite of the farmer's own spatial assertion, and
/// it is the same guess-scope-from-an-absence fabrication founder decision O-1
/// closed at the database.</para>
///
/// <para><b>Three shapes, and the third is not a gap.</b> <c>Plot</c> carries one
/// plot and its cycle; <c>MultiPlot</c> carries EVERY plot and no cycle;
/// <c>Farm</c> carries the EMPTY set with no plot and no cycle. The empty set is
/// the complete, correct record of संपूर्ण शेत — never a sentinel, never "the
/// first plot", never an invented cycle (P4).</para>
///
/// <para><b>Why the options object is specified so exactly.</b> These tests
/// serialize with <c>new JsonSerializerOptions(JsonSerializerDefaults.Web)</c>
/// and nothing else — the same defaults ASP.NET Core minimal APIs use for a
/// response body, which carry camelCase naming but <b>no</b> string-enum
/// converter. A test that helpfully added <c>JsonStringEnumConverter</c> to its
/// own options would prove nothing about what a device actually receives. The
/// ordinal-on-the-wire trap one layer in already cost the outbox payload a fix
/// (see <c>DailyLogCreatedEventOutboxPayloadTests</c>); this is the same trap one
/// layer out.</para>
/// </summary>
public sealed class DailyLogDtoScopeProjectionTests
{
    /// <summary>The response pipeline's exact options object — deliberately unconfigured.</summary>
    private static readonly JsonSerializerOptions WireOptions = new(JsonSerializerDefaults.Web);

    private const string SentinelGuid = "00000000-0000-0000-0000-000000000000";

    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId AnyOperator = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly Guid PlotA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid PlotB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly Guid PlotC = Guid.Parse("cccccccc-0000-0000-0000-00000000000c");
    private static readonly Guid CycleA = Guid.Parse("dddddddd-0000-0000-0000-00000000000d");
    private static readonly DateOnly LogDate = new(2026, 8, 12);
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc);

    // ─────────────────────────────────────────────────────────────────────
    // The three shapes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_plot_log_projects_the_one_plot_the_farmer_named()
    {
        var dto = MakeLog(DailyLogScope.Plot).ToDto();

        dto.Scope.Should().Be("Plot");
        dto.PlotIds.Should().Equal(new[] { PlotA },
            "the canonical assertion of a plot-scoped log is the one-element set — and it must agree with PlotId, " +
            "because a reader using one and a reader using the other must never return different plots for the same log");
        dto.PlotId.Should().Be(PlotA, "the compatibility projection is unchanged; every single-plot reader keeps working");
        dto.CropCycleId.Should().Be(CycleA);
    }

    [Fact]
    public void A_multi_plot_log_projects_every_plot_the_farmer_named_not_the_first()
    {
        var dto = MakeLog(DailyLogScope.MultiPlot).ToDto();

        dto.Scope.Should().Be("MultiPlot");
        dto.PlotIds.Should().Equal(new[] { PlotA, PlotB, PlotC },
            "ONE shared engagement over three plots is one engagement carrying the WHOLE selection (founder decision " +
            "O-2). Projecting the first plot, or one plot, is exactly the loss that rewrites {A,B,C} into a " +
            "farm-wide log on the farmer's own device");
        dto.PlotId.Should().BeNull("a multi-plot log has no single plot, and we do not elect one");
        dto.CropCycleId.Should().BeNull("cross-cycle attribution is deferred by decision — recording it wrongly is worse than absent");
    }

    [Fact]
    public void A_farm_log_projects_the_empty_set_and_no_plot_or_cycle()
    {
        var dto = MakeLog(DailyLogScope.Farm).ToDto();

        dto.Scope.Should().Be("Farm", "the scope NAMES the intent, so a reader never has to know that {} means farm-wide");
        dto.PlotIds.Should().BeEmpty(
            "संपूर्ण शेत is an empty set — that IS the complete record (O-1), not a gap for a later reader to fill");
        dto.PlotIds.Should().NotBeNull("absence of plots is an empty set on the wire, never null");
        dto.PlotId.Should().BeNull();
        dto.CropCycleId.Should().BeNull();
    }

    // ─────────────────────────────────────────────────────────────────────
    // The wire.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(DailyLogScope.Plot, "Plot")]
    [InlineData(DailyLogScope.MultiPlot, "MultiPlot")]
    [InlineData(DailyLogScope.Farm, "Farm")]
    public void The_scope_travels_as_a_name_never_as_an_ordinal(DailyLogScope scope, string expectedName)
    {
        var json = JsonSerializer.Serialize(MakeLog(scope).ToDto(), WireOptions);

        json.Should().Contain($"\"scope\":\"{expectedName}\"",
            "the device must receive the farmer's assertion by name — the same string ssf.daily_logs.scope stores " +
            "and create_daily_log.zod.ts accepts, so one contract travels in both directions");

        json.Should().NotContain("\"scope\":0")
            .And.NotContain("\"scope\":1")
            .And.NotContain("\"scope\":2",
                $"an ordinal for {scope} silently re-maps the moment anyone inserts a member into the enum, and " +
                "inserting a member is a source change nobody would flag as a data migration");

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("scope").ValueKind.Should().Be(JsonValueKind.String,
            "asserted structurally as well as textually — a number that happened not to match the three literals " +
            "above would still be an ordinal on the wire");
    }

    [Theory]
    [InlineData(DailyLogScope.Plot)]
    [InlineData(DailyLogScope.MultiPlot)]
    [InlineData(DailyLogScope.Farm)]
    public void No_shape_puts_a_fabricated_plot_cycle_or_sentinel_on_the_wire(DailyLogScope scope)
    {
        var json = JsonSerializer.Serialize(MakeLog(scope).ToDto(), WireOptions);

        json.Should().NotContain(SentinelGuid,
            "doctrine P4 — `log.PlotId ?? Guid.Empty` is the obvious compile fix and it puts a fabricated plot " +
            "reference on the wire and from there into canonical client state, which every other test would pass");

        using var doc = JsonDocument.Parse(json);
        var plotIds = doc.RootElement.GetProperty("plotIds");
        plotIds.ValueKind.Should().Be(JsonValueKind.Array, "the plot set is always an array, even when it is empty");
        plotIds.EnumerateArray().Select(x => x.GetGuid()).Should().NotContain(Guid.Empty);
    }

    /// <summary>
    /// The regression that matters most: single-plot logging is untouched. The
    /// new members are APPENDED, so a plot log's response body is byte-for-byte
    /// yesterday's document up to its closing brace, then the new members.
    /// Compared against a shadow record carrying exactly the pre-A2a field list
    /// in the pre-A2a order, so a rename, a reorder, a changed value or an
    /// inserted field all fail here.
    ///
    /// <para><b>Updated for LABOUR_PHASE2 Phase 3, which appends a THIRD member.</b>
    /// <c>labour</c> serialises as <c>null</c> here on purpose: this DTO was built
    /// by the parameterless <c>ToDto()</c>, i.e. by a caller that never loaded the
    /// engagements. <c>null</c> is that caller saying nothing about labour. Only
    /// the pull, which fetches them, sends an array — and an EMPTY array there is a
    /// real statement. If this assertion ever reads <c>"labour":[]</c>, a caller
    /// that did not look has started claiming a log has no labour, which is the
    /// V1 data-loss bug rebuilt.</para>
    ///
    /// <para><b>Updated again for task-0b, which appends a FOURTH member.</b>
    /// <c>dayOutcome</c> serialises as <c>null</c> here because <c>MakeLog</c> never
    /// calls <c>SetDayOutcome</c> — this is what an ordinary work day looks like on
    /// the wire, and it must stay <c>null</c>, never <c>"WORK_RECORDED"</c> (P4).</para>
    /// </summary>
    [Fact]
    public void A_plot_logs_wire_shape_is_yesterdays_bytes_plus_the_new_members()
    {
        var dto = MakeLog(DailyLogScope.Plot).ToDto();

        var legacyJson = JsonSerializer.Serialize(
            new LegacyDailyLogDto(
                dto.Id,
                dto.FarmId,
                dto.PlotId,
                dto.CropCycleId,
                dto.OperatorUserId,
                dto.LogDate,
                dto.IdempotencyKey,
                dto.CreatedAtUtc,
                dto.ModifiedAtUtc,
                dto.Location,
                dto.LastVerificationStatus,
                dto.Tasks,
                dto.VerificationEvents),
            WireOptions);

        var actualJson = JsonSerializer.Serialize(dto, WireOptions);

        actualJson.Should().Be(
            $"{legacyJson[..^1]},\"scope\":\"Plot\",\"plotIds\":[\"{PlotA}\"],\"labour\":null,\"dayOutcome\":null}}",
            "additive and inert: every field that shipped before A2a keeps its exact position, name and value, and " +
            "the only difference a shipped client can observe is members it does not yet read");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The pre-A2a <c>DailyLogDto</c> field list, in the pre-A2a order. This is
    /// a pin, not a duplicate: its only job is to fail when the shape that
    /// already shipped changes.
    /// </summary>
    private sealed record LegacyDailyLogDto(
        Guid Id,
        Guid FarmId,
        Guid? PlotId,
        Guid? CropCycleId,
        Guid OperatorUserId,
        DateOnly LogDate,
        string? IdempotencyKey,
        DateTime CreatedAtUtc,
        DateTime ModifiedAtUtc,
        LocationDto? Location,
        string? LastVerificationStatus,
        IReadOnlyList<LogTaskDto> Tasks,
        IReadOnlyList<VerificationEventDto> VerificationEvents);

    private static DailyLog MakeLog(DailyLogScope scope) => scope switch
    {
        DailyLogScope.Plot => DailyLog.Create(
            Guid.Parse("ffffffff-0000-0000-0000-0000000000f1"),
            AnyFarmId,
            PlotA,
            CycleA,
            AnyOperator,
            LogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: CreatedAtUtc),
        DailyLogScope.MultiPlot => DailyLog.CreateForMultiPlot(
            Guid.Parse("ffffffff-0000-0000-0000-0000000000f2"),
            AnyFarmId,
            new[] { PlotA, PlotB, PlotC },
            AnyOperator,
            LogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: CreatedAtUtc),
        _ => DailyLog.CreateForFarm(
            Guid.Parse("ffffffff-0000-0000-0000-0000000000f3"),
            AnyFarmId,
            AnyOperator,
            LogDate,
            idempotencyKey: null,
            location: null,
            createdAtUtc: CreatedAtUtc),
    };
}
