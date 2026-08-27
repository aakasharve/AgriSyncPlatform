using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 10) —
/// <see cref="FieldOperatorWorkRow"/> is an attribution overlay, never the work
/// itself. Two invariants dominate this file: attribution never changes the
/// reported quantity (Constraint 3), and
/// <see cref="FieldOperatorWorkRow.DisplayNameAtAttach"/> is a snapshot that
/// renaming must never rewrite (Scenario 7).
/// </summary>
public sealed class FieldOperatorWorkRowTests
{
    private static readonly FarmId Farm = new(Guid.Parse("99999999-9999-9999-9999-999999999999"));
    private static readonly UserId RecordedBy = new(Guid.Parse("88888888-8888-8888-8888-888888888888"));
    private static readonly DateTime CreatedAt = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly WorkDate = new(2026, 8, 11);

    private static FieldOperatorWorkRow Attach(
        Guid? id = null,
        Guid? fieldOperatorId = null,
        Guid? labourAssignmentId = null,
        DateOnly? workDate = null,
        string displayNameAtAttach = "बाळू") =>
        FieldOperatorWorkRow.Create(
            id ?? Guid.NewGuid(),
            fieldOperatorId ?? Guid.NewGuid(),
            labourAssignmentId ?? Guid.NewGuid(),
            Farm,
            workDate ?? WorkDate,
            displayNameAtAttach,
            RecordedBy,
            CreatedAt);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_throws_on_blank_display_name_at_attach(string blank)
    {
        Assert.Throws<ArgumentException>(() => Attach(displayNameAtAttach: blank));
    }

    [Fact]
    public void Create_stores_the_attach_time_display_name_verbatim()
    {
        // Snapshot, not a search key: no normalization, no honorific stripping.
        // The whole point is that the row still reads the way the farmer saw it.
        var row = Attach(displayNameAtAttach: "श्री. सुरेश");

        Assert.Equal("श्री. सुरेश", row.DisplayNameAtAttach);
    }

    [Fact]
    public void Create_preserves_every_attribution_field()
    {
        var operatorId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        var row = FieldOperatorWorkRow.Create(
            Guid.Parse("11111111-1111-1111-1111-111111111111"),
            operatorId,
            assignmentId,
            Farm,
            WorkDate,
            "बाळू",
            RecordedBy,
            CreatedAt);

        Assert.Equal(Guid.Parse("11111111-1111-1111-1111-111111111111"), row.Id);
        Assert.Equal(operatorId, row.FieldOperatorId);
        Assert.Equal(assignmentId, row.LabourAssignmentId);
        Assert.Equal(Farm, row.FarmId);
        Assert.Equal(WorkDate, row.WorkDate);
        Assert.Equal(RecordedBy, row.RecordedByUserId);
        Assert.Equal(CreatedAt, row.CreatedAtUtc);
    }

    /// <summary>
    /// Scenario 9 — grain is FieldOperator x LabourAssignment, NOT x day. One
    /// person can work a morning engagement and an evening engagement on the
    /// same date; that is two rows, and neither is a duplicate of the other.
    /// </summary>
    [Fact]
    public void Same_operator_on_two_assignments_the_same_day_yields_two_distinct_rows()
    {
        var operatorId = Guid.NewGuid();
        var morning = Guid.NewGuid();
        var evening = Guid.NewGuid();

        var first = Attach(fieldOperatorId: operatorId, labourAssignmentId: morning, workDate: WorkDate);
        var second = Attach(fieldOperatorId: operatorId, labourAssignmentId: evening, workDate: WorkDate);

        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(first.FieldOperatorId, second.FieldOperatorId);
        Assert.Equal(first.WorkDate, second.WorkDate);
        Assert.NotEqual(first.LabourAssignmentId, second.LabourAssignmentId);

        // The unique index is on (FieldOperatorId, LabourAssignmentId), so two
        // rows sharing a person AND a date are legitimate as long as the
        // engagements differ. A per-day grain would have collapsed these.
        Assert.NotEqual(
            (first.FieldOperatorId, first.LabourAssignmentId),
            (second.FieldOperatorId, second.LabourAssignmentId));
    }

    /// <summary>
    /// Scenario 8 — a returning worker reuses ONE FieldOperatorId across dates.
    /// Identity is durable; only the attribution row is per-engagement.
    /// </summary>
    [Fact]
    public void Same_operator_across_two_dates_reuses_one_field_operator_id()
    {
        var operatorId = Guid.NewGuid();

        var monday = Attach(fieldOperatorId: operatorId, workDate: new DateOnly(2026, 8, 10));
        var tuesday = Attach(fieldOperatorId: operatorId, workDate: new DateOnly(2026, 8, 11));

        Assert.Equal(operatorId, monday.FieldOperatorId);
        Assert.Equal(operatorId, tuesday.FieldOperatorId);
        Assert.NotEqual(monday.WorkDate, tuesday.WorkDate);
        Assert.NotEqual(monday.Id, tuesday.Id);
    }

    /// <summary>
    /// Scenario 7 — renaming the operator must NOT rewrite recorded history.
    /// DisplayNameAtAttach is a snapshot with no setter and no rename hook;
    /// this test pins that the two names diverge after a rename.
    /// </summary>
    [Fact]
    public void Renaming_the_operator_leaves_the_attach_time_snapshot_unchanged()
    {
        var op = FieldOperator.Create(
            Guid.NewGuid(), "बाळू", fullName: null, Farm, RecordedBy, CreatedAt);

        var row = Attach(fieldOperatorId: op.Id, displayNameAtAttach: op.DisplayName);

        op.Rename("बाळासाहेब", CreatedAt.AddDays(30));

        Assert.Equal("बाळासाहेब", op.DisplayName);
        Assert.Equal("बाळू", row.DisplayNameAtAttach);
        Assert.NotEqual(op.DisplayName, row.DisplayNameAtAttach);
        // Identity itself is unchanged — only the label moved on.
        Assert.Equal(op.Id, row.FieldOperatorId);
    }

    /// <summary>
    /// Constraint 3 / doctrine P7 — attribution is an OVERLAY. This type carries
    /// no count, no wage and no money, so there is no path by which naming
    /// people can shrink a reported headcount. Pinned by reflection because the
    /// invariant is the ABSENCE of such a member: a future "WorkerCount" or
    /// "Share" property would silently reintroduce exactly the coupling
    /// Constraint 3 forbids.
    /// </summary>
    [Fact]
    public void Work_row_carries_no_quantity_or_money_field()
    {
        var forbidden = new[] { "count", "worker", "wage", "cost", "amount", "rate", "share", "hours", "duration" };

        var offending = typeof(FieldOperatorWorkRow)
            .GetProperties()
            .Where(p => forbidden.Any(f => p.Name.Contains(f, StringComparison.OrdinalIgnoreCase)))
            .Select(p => p.Name)
            .ToList();

        Assert.True(
            offending.Count == 0,
            "FieldOperatorWorkRow must stay a pure attribution overlay — attribution never "
            + "changes reported quantity (Constraint 3). Offending members: "
            + string.Join(", ", offending));
    }
}
