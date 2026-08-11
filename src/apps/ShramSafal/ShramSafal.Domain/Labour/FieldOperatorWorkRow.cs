using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 10) — an
/// <b>attribution overlay</b>: it records that a known <see cref="FieldOperator"/>
/// worked a given <c>LabourAssignment</c>. It is never the work itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>Attribution never changes reported quantity.</b> A <c>LabourAssignment</c>
/// with <c>WorkerCount = 8</c> and three people attributed is still <b>8</b>.
/// Naming people must never shrink the reported number — that would punish a
/// farmer for being helpful, and it is why this type carries no count, no
/// wage, and no money at all. The engagement stays the single source of
/// truth for quantity (Constraint 3).
/// </para>
/// <para>
/// <b>Grain is FieldOperator × LabourAssignment, not × day</b> (Scenario 9).
/// The same person on two engagements on the same date yields two rows; the
/// same person across two dates reuses one <see cref="FieldOperatorId"/>
/// (Scenario 8) and yields one row per engagement.
/// </para>
/// <para>
/// <see cref="DisplayNameAtAttach"/> is a <b>snapshot</b>, copied from the
/// operator's <c>DisplayName</c> at attach time and never updated
/// (Scenario 7). Renaming a person via <see cref="FieldOperator.Rename"/>
/// must leave recorded history explainable, not rewrite it — a payout
/// approved for "बाळू" must still read "बाळू" after the operator is renamed.
/// <c>FullName</c> is deliberately <b>not</b> snapshotted, to avoid
/// duplicating PII across every work row.
/// </para>
/// </remarks>
public sealed class FieldOperatorWorkRow : Entity<Guid>
{
    private FieldOperatorWorkRow() : base(Guid.Empty) { } // EF Core

    private FieldOperatorWorkRow(
        Guid id,
        Guid fieldOperatorId,
        Guid labourAssignmentId,
        FarmId farmId,
        DateOnly workDate,
        string displayNameAtAttach,
        UserId recordedByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        FieldOperatorId = fieldOperatorId;
        LabourAssignmentId = labourAssignmentId;
        FarmId = farmId;
        WorkDate = workDate;
        DisplayNameAtAttach = displayNameAtAttach;
        RecordedByUserId = recordedByUserId;
        CreatedAtUtc = createdAtUtc;
    }

    /// <summary>The durable work identity this row attributes work to.</summary>
    public Guid FieldOperatorId { get; private set; }

    /// <summary>
    /// The engagement worked. The engagement's reported headcount is NEVER
    /// derived from, reduced by, or reconciled against the number of work
    /// rows pointing at it.
    /// </summary>
    public Guid LabourAssignmentId { get; private set; }

    /// <summary>Tenancy key — direct RLS, like <see cref="FieldOperator.OriginatingFarmId"/>.</summary>
    public FarmId FarmId { get; private set; }

    public DateOnly WorkDate { get; private set; }

    /// <summary>
    /// Snapshot of the operator's display name AT ATTACH TIME. Never updated
    /// — there is deliberately no setter and no rename hook. See the class
    /// remarks (Scenario 7).
    /// </summary>
    public string DisplayNameAtAttach { get; private set; } = string.Empty;

    public UserId RecordedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static FieldOperatorWorkRow Create(
        Guid id,
        Guid fieldOperatorId,
        Guid labourAssignmentId,
        FarmId farmId,
        DateOnly workDate,
        string displayNameAtAttach,
        UserId recordedByUserId,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(displayNameAtAttach))
        {
            throw new ArgumentException(
                "Display name at attach is required — an attribution row must stay explainable "
                + "after the operator is renamed.",
                nameof(displayNameAtAttach));
        }

        // Stored verbatim: this is a snapshot of what the operator was called
        // at attach time, not a search key. It is never normalized and never
        // matched on (that is DisplayNameNormalized's job, on FieldOperator).
        return new FieldOperatorWorkRow(
            id,
            fieldOperatorId,
            labourAssignmentId,
            farmId,
            workDate,
            displayNameAtAttach,
            recordedByUserId,
            createdAtUtc);
    }
}
