using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// The APPEND-ONLY record of what a <see cref="AttendanceMark"/> used to say,
/// who changed it and when. Never updated, never deleted.
/// </summary>
/// <remarks>
/// <para>
/// <b>Founder ruling 2026-08-31: "remember it."</b> Corrections are expected
/// and fine; silent ones are not. A confirmed record that can be quietly edited
/// manufactures false confidence with a second person's name attached to it,
/// which is worse than no confirmation at all.
/// </para>
/// <para>
/// <b>Three entities, three questions</b> — the same split
/// <see cref="LabourCorrection"/> draws for engagements:
/// <i>what is true now?</i> the <see cref="AttendanceMark"/>, corrected in
/// place, so every reader sees corrected truth without knowing corrections
/// exist. <i>what was it before?</i> THIS.
/// </para>
/// <para>
/// <b>Why not <see cref="LabourCorrection"/> itself.</b> That entity is keyed
/// by <c>LabourAssignmentId</c> and requires a non-empty one — it corrects an
/// ENGAGEMENT. A हजेरी mark is not an engagement: its grain is person × day,
/// and there may be no engagement involved at all. Widening the engagement
/// correction to carry a second kind of subject would change the meaning of an
/// append-only table that existing readers already interpret, to save one
/// class. This codebase already keeps corrections per aggregate —
/// <see cref="LabourCorrection"/> says of itself that it is modelled on
/// <c>FinanceCorrection</c> rather than sharing one — so a third follows the
/// idiom instead of bending it.
/// </para>
/// <para>
/// <b>One row per changed half.</b> Day and night are independently markable
/// (D-H3), so they are independently correctable and each carries its own
/// before/after. A single row holding both would make "only the night changed"
/// indistinguishable from "both were restated".
/// </para>
/// </remarks>
public sealed class AttendanceMarkCorrection : Entity<Guid>
{
    /// <summary>The day half of a mark. Matches <see cref="AttendanceMark.Day"/>.</summary>
    public const string DayField = "day_mark";

    /// <summary>The night half of a mark. Matches <see cref="AttendanceMark.Night"/>.</summary>
    public const string NightField = "night_mark";

    private AttendanceMarkCorrection() : base(Guid.Empty) { } // EF Core

    private AttendanceMarkCorrection(
        Guid id,
        Guid attendanceMarkId,
        FarmId farmId,
        string changedField,
        string originalValue,
        string newValue,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
        : base(id)
    {
        AttendanceMarkId = attendanceMarkId;
        FarmId = farmId;
        ChangedField = changedField;
        OriginalValue = originalValue;
        NewValue = newValue;
        CorrectedByUserId = correctedByUserId;
        CorrectedAtUtc = correctedAtUtc;
    }

    public Guid AttendanceMarkId { get; private set; }

    public FarmId FarmId { get; private set; }

    /// <summary><see cref="DayField"/> or <see cref="NightField"/>.</summary>
    public string ChangedField { get; private set; } = string.Empty;

    /// <summary>
    /// The enum name it USED to hold, e.g. <c>Half</c>. Stored as the NAME, not
    /// the number: a correction has to stay readable years later, and an enum
    /// whose members are renumbered would silently rewrite history recorded as
    /// integers.
    /// </summary>
    public string OriginalValue { get; private set; } = string.Empty;

    public string NewValue { get; private set; } = string.Empty;

    /// <summary>Who changed it. Never the app.</summary>
    public UserId CorrectedByUserId { get; private set; }

    public DateTime CorrectedAtUtc { get; private set; }

    public static AttendanceMarkCorrection Create(
        Guid id,
        Guid attendanceMarkId,
        FarmId farmId,
        string changedField,
        string originalValue,
        string newValue,
        UserId correctedByUserId,
        DateTime correctedAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Correction id is required.", nameof(id));
        }

        if (attendanceMarkId == Guid.Empty)
        {
            throw new ArgumentException(
                "A correction must point at the mark it corrects.", nameof(attendanceMarkId));
        }

        if (changedField != DayField && changedField != NightField)
        {
            throw new ArgumentException(
                $"A mark has exactly two halves: '{DayField}' or '{NightField}'.",
                nameof(changedField));
        }

        if (string.IsNullOrWhiteSpace(originalValue) || string.IsNullOrWhiteSpace(newValue))
        {
            // A correction that cannot say what it changed FROM is not a record
            // of a change, it is the change happening quietly — the exact thing
            // this entity exists to prevent.
            throw new ArgumentException(
                "A correction must state both the original and the new value.", nameof(originalValue));
        }

        if (originalValue == newValue)
        {
            // Recording a non-change would pad the history and make a real
            // correction harder to find among restatements of the same fact.
            throw new ArgumentException(
                "Nothing changed — a correction row must record an actual change.",
                nameof(newValue));
        }

        return new AttendanceMarkCorrection(
            id, attendanceMarkId, farmId, changedField, originalValue, newValue,
            correctedByUserId, correctedAtUtc);
    }
}
