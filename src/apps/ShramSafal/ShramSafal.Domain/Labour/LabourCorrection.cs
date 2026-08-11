using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b) —
/// the APPEND-ONLY record of what a labour engagement used to say, who changed
/// it and when. One row per changed field.
/// </summary>
/// <remarks>
/// <para>
/// <b>Three entities, three questions (do not conflate them).</b>
/// <list type="bullet">
/// <item><i>What is true now?</i> — <c>LabourAssignment</c>. Corrected values are
/// written IN PLACE, so every reader (<c>GetLabourDataHandler</c>, exports,
/// future analytics) sees corrected truth without knowing corrections
/// exist.</item>
/// <item><i>Who is attributed now?</i> — <c>FieldOperatorWorkRow</c>, the live
/// set. Adding attaches a row; removing deletes one.</item>
/// <item><i>What was it before?</i> — THIS entity. Never updated, never
/// deleted.</item>
/// </list>
/// A correction is therefore never a silent mutation: it states this WAS X and,
/// after verification, IS NOW Y.
/// </para>
/// <para>
/// <b>Modelled on <c>FinanceCorrection</c>, deliberately NOT on
/// <c>CorrectionEvent</c>.</b> <c>CorrectionEvent</c> is AI-parse capture — it
/// is keyed by <c>OriginalParseId</c> and carries parse JSON plus a
/// <c>PromptVersion</c>. A manually recorded labour engagement has no parse id,
/// so reusing it would mean fabricating one. <c>FinanceCorrection</c> is the
/// house pattern for correcting a domain record (subject id, original value,
/// corrected value, reason, actor, timestamp) and this is its labour sibling.
/// It is deliberately NOT generalised into a universal correction framework —
/// V1 corrects exactly three things and nothing else.
/// </para>
/// <para>
/// <b>Values are stored as STRINGS, on purpose.</b> The five correctable fields
/// are two different shapes — <c>int?</c> headcounts, and a duration that can
/// never move without its basis (<c>"8|Assumed"</c> → <c>"4|Explicit"</c>) —
/// plus an attribution whose value is a <c>FieldOperatorId</c>. A typed column
/// per shape would either fabricate a value for the shapes it does not fit or
/// force one nullable column per field. <c>null</c> means "absent on this side
/// of the change" (an attribution that did not exist before, or no longer
/// exists after), never "zero".
/// </para>
/// <para>
/// <b>Append-only is structural, not a convention.</b> There is no
/// <c>Modify</c>, no <c>Delete</c>, no setter and no update path anywhere — the
/// migration grants no update or delete route either. Correction history that
/// can itself be rewritten proves nothing.
/// </para>
/// </remarks>
public sealed class LabourCorrection : Entity<Guid>
{
    /// <summary>Correcting the total headcount on the engagement.</summary>
    public const string FieldWorkerCount = "WorkerCount";

    /// <summary>Correcting the male half of the gender split.</summary>
    public const string FieldMaleCount = "MaleCount";

    /// <summary>Correcting the female half of the gender split.</summary>
    public const string FieldFemaleCount = "FemaleCount";

    /// <summary>Correcting hours worked. Values carry their basis: <c>"8|Assumed"</c>.</summary>
    public const string FieldDurationHours = "DurationHours";

    /// <summary>Adding or removing a named person's attribution. Values are <c>FieldOperatorId</c>s.</summary>
    public const string FieldAttribution = "Attribution";

    /// <summary>
    /// The CLOSED set of correctable fields (Task 12b scope, hard): labour
    /// quantity, duration, worker attribution. Widening this set is a scope
    /// change, not a fix — generic log versioning and arbitrary field mutation
    /// are explicitly out of scope.
    /// </summary>
    private static readonly HashSet<string> CorrectableFields = new(StringComparer.Ordinal)
    {
        FieldWorkerCount,
        FieldMaleCount,
        FieldFemaleCount,
        FieldDurationHours,
        FieldAttribution,
    };

    private LabourCorrection() : base(Guid.Empty) { } // EF Core

    private LabourCorrection(
        Guid id,
        Guid labourAssignmentId,
        FarmId farmId,
        string changedField,
        string? originalValue,
        string? newValue,
        string? reason,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
        : base(id)
    {
        LabourAssignmentId = labourAssignmentId;
        FarmId = farmId;
        ChangedField = changedField;
        OriginalValue = originalValue;
        NewValue = newValue;
        Reason = reason;
        CorrectedByUserId = correctedByUserId;
        CorrectedAtUtc = correctedAtUtc;
    }

    /// <summary>The engagement whose truth changed.</summary>
    public Guid LabourAssignmentId { get; private set; }

    /// <summary>Tenancy key — DIRECT farm_id RLS, same shape as <c>FieldOperatorWorkRow</c>.</summary>
    public FarmId FarmId { get; private set; }

    /// <summary>One of the five <c>Field*</c> constants on this type.</summary>
    public string ChangedField { get; private set; } = string.Empty;

    /// <summary>What the field said BEFORE. <c>null</c> = absent before (e.g. a new attribution).</summary>
    public string? OriginalValue { get; private set; }

    /// <summary>What the field says NOW. <c>null</c> = absent after (e.g. a removed attribution).</summary>
    public string? NewValue { get; private set; }

    /// <summary>
    /// Why, in the reviewer's words. Optional — unlike <c>FinanceCorrection</c>,
    /// which requires it. Demanding a typed reason before a semi-literate
    /// farmer may fix "8" to "6" would make correction harder than the mistake,
    /// which is the adoption failure this task exists to prevent.
    /// </summary>
    public string? Reason { get; private set; }

    public UserId CorrectedByUserId { get; private set; }

    public DateTime CorrectedAtUtc { get; private set; }

    public static LabourCorrection Create(
        Guid id,
        Guid labourAssignmentId,
        FarmId farmId,
        string changedField,
        string? originalValue,
        string? newValue,
        string? reason,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Correction id is required.", nameof(id));
        }

        if (labourAssignmentId == Guid.Empty)
        {
            throw new ArgumentException(
                "A correction must point at the engagement it corrects.", nameof(labourAssignmentId));
        }

        if (farmId.IsEmpty)
        {
            throw new ArgumentException(
                "A correction must carry its farm — farm_id is this table's RLS key.", nameof(farmId));
        }

        if (!CorrectableFields.Contains(changedField))
        {
            throw new ArgumentException(
                $"'{changedField}' is not a correctable field. Labour V1 corrects exactly "
                + "quantity (WorkerCount/MaleCount/FemaleCount), DurationHours and Attribution.",
                nameof(changedField));
        }

        if (correctedByUserId.IsEmpty)
        {
            throw new ArgumentException(
                "A correction must name the human who made it — an unattributed correction is "
                + "indistinguishable from a silent mutation.", nameof(correctedByUserId));
        }

        var trimmedReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();

        return new LabourCorrection(
            id,
            labourAssignmentId,
            farmId,
            changedField,
            originalValue,
            newValue,
            trimmedReason,
            correctedByUserId,
            correctedAtUtc);
    }
}
