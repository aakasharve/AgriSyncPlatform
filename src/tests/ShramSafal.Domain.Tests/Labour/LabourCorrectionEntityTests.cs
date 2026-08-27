using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b.1 +
/// 12b.1b) — the two domain pieces correction rests on:
/// <list type="number">
/// <item><see cref="LabourCorrection"/>, the append-only history row;</item>
/// <item><see cref="LabourAssignment"/>'s two — and only two — mutators.</item>
/// </list>
/// </summary>
public sealed class LabourCorrectionEntityTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly UserId Reviewer = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));

    private static LabourAssignment MakeAssignment(
        int? workerCount = 8, int? maleCount = null, int? femaleCount = null, LabourTime? time = null) =>
        LabourAssignment.Create(
            Guid.NewGuid(), Guid.NewGuid(), LabourEngagementType.Hired,
            maleCount: maleCount, femaleCount: femaleCount, workerCount: workerCount,
            wagePerPerson: null, contractUnit: null, contractQuantity: null, totalCost: null,
            linkedActivityId: null, createdAtUtc: Now, time: time ?? LabourTime.ServerAssumed());

    // ── LabourCorrection ─────────────────────────────────────────────────────

    [Fact]
    public void Records_what_it_was_who_changed_it_and_when()
    {
        var assignmentId = Guid.NewGuid();

        var correction = LabourCorrection.Create(
            Guid.NewGuid(), assignmentId, Farm, LabourCorrection.FieldWorkerCount,
            originalValue: "8", newValue: "6", reason: "मोजून पाहिलं",
            correctedByUserId: Reviewer, correctedAtUtc: Now);

        correction.LabourAssignmentId.Should().Be(assignmentId);
        correction.FarmId.Should().Be(Farm);
        correction.ChangedField.Should().Be("WorkerCount");
        correction.OriginalValue.Should().Be("8");
        correction.NewValue.Should().Be("6");
        correction.Reason.Should().Be("मोजून पाहिलं");
        correction.CorrectedByUserId.Should().Be(Reviewer);
        correction.CorrectedAtUtc.Should().Be(Now);
    }

    [Fact]
    public void Null_on_either_side_means_absent_not_zero()
    {
        var operatorId = Guid.NewGuid();

        var removed = LabourCorrection.Create(
            Guid.NewGuid(), Guid.NewGuid(), Farm, LabourCorrection.FieldAttribution,
            originalValue: operatorId.ToString(), newValue: null, reason: null,
            correctedByUserId: Reviewer, correctedAtUtc: Now);

        var added = LabourCorrection.Create(
            Guid.NewGuid(), Guid.NewGuid(), Farm, LabourCorrection.FieldAttribution,
            originalValue: null, newValue: operatorId.ToString(), reason: null,
            correctedByUserId: Reviewer, correctedAtUtc: Now);

        removed.NewValue.Should().BeNull("an attribution that no longer exists is ABSENT, not zero");
        added.OriginalValue.Should().BeNull("an attribution that did not exist before is ABSENT, not zero");
    }

    [Theory]
    [InlineData("TotalCost")]
    [InlineData("EngagementType")]
    [InlineData("")]
    [InlineData("workercount")]
    public void Only_the_five_scoped_fields_are_correctable(string changedField)
    {
        var act = () => LabourCorrection.Create(
            Guid.NewGuid(), Guid.NewGuid(), Farm, changedField,
            "a", "b", null, Reviewer, Now);

        act.Should().Throw<ArgumentException>(
            "Labour V1 corrects exactly quantity, duration and attribution — arbitrary field "
            + "mutation and generic log versioning are explicitly out of scope");
    }

    [Fact]
    public void A_correction_must_name_the_human_who_made_it()
    {
        var act = () => LabourCorrection.Create(
            Guid.NewGuid(), Guid.NewGuid(), Farm, LabourCorrection.FieldWorkerCount,
            "8", "6", null, new UserId(Guid.Empty), Now);

        act.Should().Throw<ArgumentException>(
            "an unattributed correction is indistinguishable from a silent mutation");
    }

    [Fact]
    public void Exposes_no_update_or_delete_path()
    {
        var forbidden = typeof(LabourCorrection)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
            .Select(m => m.Name)
            .Where(name => name is "Modify" or "Delete" or "Update" or "Correct" or "Revoke")
            .ToArray();

        forbidden.Should().BeEmpty(
            "correction history that can itself be rewritten proves nothing — append-only is "
            + "structural here, not a convention");

        typeof(LabourCorrection).GetProperties()
            .Where(p => p.SetMethod is { IsPublic: true })
            .Should().BeEmpty("no public setter may exist on an append-only row");
    }

    // ── LabourAssignment.CorrectHeadcount (12b.1b / 12b.2) ───────────────────

    [Fact]
    public void CorrectHeadcount_writes_the_corrected_count_in_place()
    {
        var assignment = MakeAssignment(workerCount: 8);

        assignment.CorrectHeadcount(6, null, null);

        assignment.WorkerCount.Should().Be(6);
    }

    [Fact]
    public void CorrectHeadcount_resolves_so_the_row_can_never_land_contradictory()
    {
        var assignment = MakeAssignment(workerCount: 8);

        // The parser emits count AND the split for "५ बायका", so adding them
        // would double-count; a stated count > 0 wins outright.
        assignment.CorrectHeadcount(workerCount: 6, maleCount: 5, femaleCount: 4);

        assignment.WorkerCount.Should().Be(6, "a stated count wins outright over the split");
        assignment.MaleCount.Should().Be(5, "the split is stored exactly as stated");
        assignment.FemaleCount.Should().Be(4);
    }

    [Fact]
    public void CorrectHeadcount_derives_the_total_from_a_split_when_no_count_is_stated()
    {
        var assignment = MakeAssignment(workerCount: 8);

        assignment.CorrectHeadcount(workerCount: null, maleCount: 2, femaleCount: 3);

        assignment.WorkerCount.Should().Be(5);
    }

    [Fact]
    public void CorrectHeadcount_preserves_silence_as_null_rather_than_fabricating_zero()
    {
        var assignment = MakeAssignment(workerCount: 8);

        assignment.CorrectHeadcount(null, null, null);

        assignment.WorkerCount.Should().BeNull(
            "nothing stated means 'we were not told', never 'zero people worked' — and there is "
            + "no backfill job in this system, so a fabricated 0 would be permanent");
    }

    [Fact]
    public void CorrectHeadcount_still_stores_an_explicitly_stated_zero()
    {
        var assignment = MakeAssignment(workerCount: 8);

        assignment.CorrectHeadcount(0, null, null);

        assignment.WorkerCount.Should().Be(0, "an explicit 0 stays distinguishable from silence");
    }

    // ── LabourAssignment.CorrectDuration (12b.1b / 12b.3) ────────────────────

    [Fact]
    public void CorrectDuration_moves_hours_and_basis_together()
    {
        var assignment = MakeAssignment(time: LabourTime.ServerAssumed());
        assignment.DurationHours.Should().Be(8m);
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Assumed);

        assignment.CorrectDuration(LabourTime.Explicit(4m));

        assignment.DurationHours.Should().Be(4m);
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Explicit,
            "a stated duration is Explicit — hours can never move without their basis");
    }

    [Fact]
    public void CorrectDuration_rejects_the_reachable_default_LabourTime()
    {
        var assignment = MakeAssignment();

        var act = () => assignment.CorrectDuration(default);

        act.Should().Throw<ArgumentException>(
            "default(LabourTime) is reachable through the struct's implicit parameterless "
            + "constructor, so CorrectDuration must validate on the same rules as Create");
        assignment.DurationHours.Should().Be(8m, "a rejected correction changes nothing");
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Assumed);
    }

    /// <summary>
    /// 12b.1b — exactly two mutators, and no general-purpose <c>Update</c>. A
    /// widened mutation surface on the canonical labour record is the failure
    /// this pin exists to catch.
    /// </summary>
    [Fact]
    public void LabourAssignment_exposes_exactly_two_mutators_and_no_public_setters()
    {
        var mutators = typeof(LabourAssignment)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
            .Where(m => !m.IsSpecialName && m.DeclaringType == typeof(LabourAssignment))
            .Select(m => m.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        mutators.Should().BeEquivalentTo(["CorrectDuration", "CorrectHeadcount"],
            "correction is the ONLY reason LabourAssignment may be mutated, and it is expressed "
            + "as two intention-named methods — never a general-purpose Update");

        typeof(LabourAssignment).GetProperties()
            .Where(p => p.SetMethod is { IsPublic: true })
            .Should().BeEmpty("correction must not be a licence to widen the property setters");
    }
}
