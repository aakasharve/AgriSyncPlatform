// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// LABOUR PHASE 2, Phase 3 — <b>labour is written but never read back.</b> A
/// farmer recorded 8 workers on Phone A; Phone B, freshly installed, saw the log
/// with no labour on it at all. These tests pin the wire shape that fixes it.
///
/// <para><b>Every assertion here is at the WIRE DTO, not the database.</b> That is
/// deliberate and it is acceptance journey 7's own wording: "8 workers + 3
/// attributed still reports 8, asserted at the wire DTO, not only in the
/// database." A projection is exactly where a correct database row turns into a
/// wrong number.</para>
///
/// <para><b>Serialised with the response pipeline's real options.</b>
/// <c>new JsonSerializerOptions(JsonSerializerDefaults.Web)</c> and nothing else —
/// the same object a minimal-API response body uses, which carries camelCase but
/// NO string-enum converter. A test that helpfully added one would prove nothing
/// about what a device receives.</para>
/// </summary>
public sealed class LabourEngagementDtoProjectionTests
{
    private static readonly JsonSerializerOptions WireOptions = new(JsonSerializerDefaults.Web);

    private static readonly FarmId AnyFarmId = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId AnyUser = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly Guid LogId = Guid.Parse("dddddddd-1111-1111-1111-111111111111");
    private static readonly Guid AssignmentId = Guid.Parse("eeeeeeee-2222-2222-2222-222222222222");
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 13, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly WorkDate = new(2026, 8, 13);

    // ─────────────────────────────────────────────────────────────────────────
    // P7 — attribution never changes reported quantity.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Eight_workers_with_three_people_named_still_reports_eight_on_the_wire()
    {
        var dto = Engagement(workerCount: 8).ToDto(Attributions("बाळू", "गणेश", "सुनीता"));

        dto.WorkerCount.Should().Be(8,
            "naming people is an OVERLAY on a reported quantity, never a replacement — shrinking the number would " +
            "punish the farmer for being helpful (doctrine P7)");
        dto.AttributedOperators.Should().HaveCount(3);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto, WireOptions));
        doc.RootElement.GetProperty("workerCount").GetInt32().Should().Be(8,
            "asserted at the WIRE, because a database row that reads 8 and a projection that sends 3 is exactly " +
            "the failure this journey exists to catch");
    }

    [Fact]
    public void The_projection_offers_no_resolved_headcount_for_a_reader_to_prefer()
    {
        var json = JsonSerializer.Serialize(
            Engagement(workerCount: 8).ToDto(Attributions("बाळू", "गणेश", "सुनीता")),
            WireOptions);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.TryGetProperty("headcount", out _).Should().BeFalse(
            "a second number meaning 'how many people' is how P7 breaks: one of the two will be the attribution " +
            "count, and whichever a screen picks first becomes the farmer's reported figure. workerCount is the " +
            "only headcount on this wire");
    }

    [Fact]
    public void Silence_about_headcount_stays_null_and_never_becomes_zero()
    {
        var dto = Engagement(workerCount: null).ToDto([]);

        dto.WorkerCount.Should().BeNull(
            "null means 'we were not told', never 'zero people worked' — a live shape on the shipping voice path " +
            "(contract work with a quantity and no count)");

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto, WireOptions));
        doc.RootElement.GetProperty("workerCount").ValueKind.Should().Be(JsonValueKind.Null,
            "0 on the wire would be read by every consumer as a real, stated count of nobody");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // P8 — duration never travels without its provenance.
    // ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true, "Explicit")]
    [InlineData(false, "Assumed")]
    public void Duration_always_travels_with_its_basis(bool stated, string expectedBasis)
    {
        var time = stated ? LabourTime.Explicit(6m) : LabourTime.ServerAssumed();

        var json = JsonSerializer.Serialize(Engagement(workerCount: 8, time: time).ToDto([]), WireOptions);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("durationHours").GetDecimal().Should().Be(time.Hours);
        doc.RootElement.GetProperty("timeBasis").GetString().Should().Be(expectedBasis,
            "DurationHours alone is a lie about whether anyone measured it; DurationHours + TimeBasis is a record " +
            "(doctrine P8)");
        doc.RootElement.GetProperty("timeBasis").ValueKind.Should().Be(JsonValueKind.String,
            "an ordinal here silently re-maps the moment anyone inserts a member into LabourTimeBasis");
    }

    /// <summary>
    /// The STRUCTURAL half of P8, asserted against the type rather than an
    /// instance: <c>durationHours</c> and <c>timeBasis</c> are required positional
    /// parameters with no default and no nullability, so omitting either is a
    /// COMPILE error at every construction site. This test fails the moment
    /// someone makes either optional — which is the only way one could ever start
    /// travelling without the other.
    /// </summary>
    [Fact]
    public void Neither_half_of_the_duration_pair_can_be_made_optional_without_failing_here()
    {
        var ctor = typeof(LabourEngagementDto).GetConstructors().Single();
        var parameters = ctor.GetParameters();

        var hours = parameters.Single(p => p.Name == "DurationHours");
        var basis = parameters.Single(p => p.Name == "TimeBasis");

        hours.HasDefaultValue.Should().BeFalse("a defaulted duration is a duration a caller can forget to state");
        basis.HasDefaultValue.Should().BeFalse("a defaulted basis is a fabricated provenance");
        hours.ParameterType.Should().Be(typeof(decimal), "a nullable duration invites a row that has hours but no basis");
        basis.ParameterType.Should().Be(typeof(string));
        new NullabilityInfoContext().Create(basis).WriteState.Should().Be(NullabilityState.NotNull,
            "a nullable basis is the same lie as an absent one");

        (basis.Position - hours.Position).Should().Be(1,
            "they are adjacent on purpose — a reader editing one must see the other");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // O-3 — the farmer's note survives.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_note_the_farmer_wrote_comes_back_verbatim()
    {
        var dto = Engagement(workerCount: 8, notes: "पाऊस आला, अर्धाच दिवस काम").ToDto([]);

        dto.Notes.Should().Be("पाऊस आला, अर्धाच दिवस काम");

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto, WireOptions));
        doc.RootElement.GetProperty("notes").GetString().Should().Be("पाऊस आला, अर्धाच दिवस काम",
            "O-3: if the product lets a farmer enter a note it must survive capture -> write -> read-back. It has " +
            "been on the wire since Labour V1 and was discarded for want of a column");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_note_is_no_note_at_all(string? written)
    {
        Engagement(workerCount: 8, notes: written).ToDto([]).Notes.Should().BeNull(
            "an empty string would be indistinguishable from a farmer who wrote a space, and every reader would " +
            "render a note that does not exist");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Money, names, and what is deliberately absent.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void No_per_person_money_is_computed_anywhere_on_the_wire()
    {
        // Rate stated, total NOT stated — the NO-MULTIPLY shape.
        var dto = Engagement(workerCount: 8, wagePerPerson: 350m).ToDto([]);

        dto.WagePerPerson.Should().Be(350m, "the stated rate is carried exactly as given");
        dto.TotalCost.Should().BeNull(
            "NO-MULTIPLY: a total is stored and sent only when the farmer stated one, never rate x count");

        var json = JsonSerializer.Serialize(dto, WireOptions);
        json.Should().NotContain("2800", "350 x 8 is the fabricated total this rule exists to prevent");

        var attributedJson = JsonSerializer.Serialize(
            Engagement(workerCount: 8, wagePerPerson: 350m).ToDto(Attributions("बाळू")), WireOptions);
        using var doc = JsonDocument.Parse(attributedJson);
        var operators = doc.RootElement.GetProperty("attributedOperators").EnumerateArray().Single();
        operators.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["fieldOperatorId", "displayNameAtAttach"],
            "an attribution row carries an identity and the name it had at attach time — no count, no wage, no " +
            "share of anything");
    }

    [Fact]
    public void Worker_names_are_free_text_and_carry_no_identity()
    {
        var dto = Engagement(workerCount: 8, workerNames: ["रमेश", "सीता"]).ToDto([]);

        dto.WorkerNames.Should().Equal("रमेश", "सीता");
        dto.AttributedOperators.Should().BeEmpty(
            "names as stated are NOT attribution — they resolve to no FieldOperator and must never be counted as one");

        // The response pipeline's default encoder escapes non-ASCII as \uXXXX —
        // lossless, and already how `task` and every other Marathi string in this
        // DTO layer travels. (UnsafeRelaxedJsonEscaping applies to the jsonb
        // COLUMN, so the stored value stays human-readable; it is not the wire.)
        // So the assertion is on the DECODED value, which is what a device sees.
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto, WireOptions));
        doc.RootElement.GetProperty("workerNames").EnumerateArray()
            .Select(x => x.GetString())
            .Should().Equal(
                new[] { "रमेश", "सीता" },
                "the names the farmer stated must arrive intact — escaped on the wire, identical after parsing");
    }

    [Fact]
    public void An_engagement_with_nobody_named_sends_empty_lists_never_nulls()
    {
        var dto = Engagement(workerCount: 8).ToDto([]);

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(dto, WireOptions));
        doc.RootElement.GetProperty("workerNames").ValueKind.Should().Be(JsonValueKind.Array);
        doc.RootElement.GetProperty("attributedOperators").ValueKind.Should().Be(JsonValueKind.Array,
            "naming nobody is a COMPLETE record (doctrine P9), not a gap — an optional field never rejects, and " +
            "never nulls, a record");
    }

    [Fact]
    public void The_client_minted_id_is_the_id_that_comes_back()
    {
        var dto = Engagement(workerCount: 8).ToDto([]);

        dto.LabourAssignmentId.Should().Be(AssignmentId,
            "the phone mints this id and it survives as the server primary key (ValueGeneratedNever), which is what " +
            "lets the picker and the correction path key on the same id after a round trip, with no mapping layer");
        dto.DailyLogId.Should().Be(LogId, "the anchor travels with the engagement so a flattened list stays addressable");
    }

    /// <summary>
    /// The current-truth / history boundary, asserted at the type. Current truth
    /// is <c>LabourAssignment</c> plus the live work rows; history is
    /// <c>ssf.labour_corrections</c>, fetched on demand and NEVER on the pull.
    /// The everyday labour view must not consume an audit ledger.
    /// </summary>
    [Fact]
    public void The_read_model_carries_no_correction_history()
    {
        var names = typeof(LabourEngagementDto).GetProperties().Select(p => p.Name).ToList();

        names.Should().NotContain(n => n.Contains("Correction", StringComparison.OrdinalIgnoreCase));
        names.Should().NotContain(n => n.Contains("Original", StringComparison.OrdinalIgnoreCase));
        names.Should().NotContain(n => n.Contains("History", StringComparison.OrdinalIgnoreCase));
        names.Should().NotContain(n => n.Contains("Previous", StringComparison.OrdinalIgnoreCase));

        typeof(LabourEngagementDto).GetConstructors().Single().GetParameters()
            .Select(p => p.ParameterType)
            .Should().NotContain(typeof(LabourCorrection),
                "corrections are mutated INTO the engagement, so this record already IS the corrected truth — " +
                "readers see it 'without knowing corrections exist'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DailyLogDto's three labour states.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_caller_that_never_loaded_labour_makes_no_statement_about_it()
    {
        var json = JsonSerializer.Serialize(PlotLog().ToDto(), WireOptions);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("labour").ValueKind.Should().Be(JsonValueKind.Null,
            "POST /logs, verify and add-task never load the engagements. `[]` there would say 'this log has no " +
            "labour' on a response that did not look, and a client guard keyed on 'the response carried the field' " +
            "would then wipe the farmer's own labour — the V1 data loss, rebuilt");
    }

    [Fact]
    public void A_reader_that_did_load_labour_states_the_empty_case_explicitly()
    {
        var json = JsonSerializer.Serialize(PlotLog().ToDto([]), WireOptions);

        using var doc = JsonDocument.Parse(json);
        var labour = doc.RootElement.GetProperty("labour");
        labour.ValueKind.Should().Be(JsonValueKind.Array,
            "the pull DID look, so 'there is none' is a real statement it is entitled to make — and it is how a " +
            "genuine 'the labour was removed' reaches a second device");
        labour.GetArrayLength().Should().Be(0);
    }

    [Fact]
    public void A_log_with_labour_carries_it_nested_beside_tasks_and_verification_events()
    {
        var log = PlotLog();
        var json = JsonSerializer.Serialize(
            log.ToDto([Engagement(workerCount: 8).ToDto(Attributions("बाळू"))]),
            WireOptions);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.TryGetProperty("tasks", out _).Should().BeTrue();
        root.TryGetProperty("verificationEvents", out _).Should().BeTrue();

        var engagement = root.GetProperty("labour").EnumerateArray().Single();
        engagement.GetProperty("labourAssignmentId").GetGuid().Should().Be(AssignmentId);
        engagement.GetProperty("workerCount").GetInt32().Should().Be(8);
        engagement.GetProperty("attributedOperators").EnumerateArray().Single()
            .GetProperty("displayNameAtAttach").GetString().Should().Be("बाळू");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────────

    private static DailyLog PlotLog() => DailyLog.Create(
        LogId,
        AnyFarmId,
        Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a"),
        Guid.Parse("cccccccc-0000-0000-0000-00000000000c"),
        AnyUser,
        WorkDate,
        idempotencyKey: null,
        location: null,
        createdAtUtc: CreatedAtUtc);

    private static LabourAssignment Engagement(
        int? workerCount,
        LabourTime? time = null,
        decimal? wagePerPerson = null,
        string? notes = null,
        IReadOnlyList<string>? workerNames = null)
        => LabourAssignment.Create(
            id: AssignmentId,
            dailyLogId: LogId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: workerCount,
            wagePerPerson: wagePerPerson,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: CreatedAtUtc,
            time: time ?? LabourTime.ServerAssumed(),
            shift: null,
            task: "छाटणी",
            workerNames: workerNames,
            notes: notes);

    private static IReadOnlyList<FieldOperatorWorkRow> Attributions(params string[] displayNames)
        => displayNames
            .Select((name, index) => FieldOperatorWorkRow.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                AssignmentId,
                AnyFarmId,
                WorkDate,
                name,
                AnyUser,
                CreatedAtUtc.AddSeconds(index)))
            .ToList();
}
