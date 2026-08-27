namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// LABOUR_PHASE2 Phase 3 — one <c>LabourAssignment</c> as a device reads it back
/// on <c>/sync/pull</c>. Nested on <see cref="DailyLogDto"/> as a sibling of
/// <c>Tasks</c> and <c>VerificationEvents</c>, so labour rides the pull machinery
/// that already exists rather than a second channel.
/// </summary>
/// <remarks>
/// <para><b>Why this exists.</b> Labour was written and never read back. A farmer
/// recorded 8 workers on Phone A; Phone B, freshly installed, saw the log with no
/// labour on it at all. Founder decision B4: labour read-back is a launch
/// requirement, proven by a clean-device journey.</para>
///
/// <para><b>CURRENT TRUTH ONLY. History is not here and must never be added.</b>
/// <c>LabourAssignment</c> is mutated in place, so this record IS the corrected
/// truth; <c>ssf.labour_corrections</c> answers a different question ("what was it
/// before?") and is fetched on demand, never on the pull. <c>LabourCorrection</c>'s
/// own remarks state the split verbatim: readers see corrected truth <i>"without
/// knowing corrections exist."</i> The everyday labour view must not consume an
/// audit ledger.</para>
///
/// <para><b><see cref="WorkerCount"/> is projected, never recomputed (doctrine
/// P7).</b> There is no resolved <c>headcount</c> member and there must never be
/// one: 8 workers with 3 people named is still 8. A projection that recounted
/// heads from <see cref="AttributedOperators"/> would shrink the farmer's own
/// number for being helpful — which is exactly how P7 breaks, and it would pass
/// every test that only checks the database.</para>
///
/// <para><b>No per-person money.</b> <see cref="WagePerPerson"/> and
/// <see cref="TotalCost"/> are the engagement's own stated figures, carried
/// verbatim (NO-MULTIPLY: <c>TotalCost</c> is null unless the farmer stated one,
/// and is never rate × count). Nothing here divides money by people.</para>
///
/// <para><b>The id is the client's.</b> <see cref="LabourAssignmentId"/> is the
/// id the phone minted, which survives as the server primary key
/// (<c>ValueGeneratedNever</c>; proven end-to-end over <c>/sync/push</c> by
/// <c>SyncEndpointsTests.CreateDailyLog_WithLabour_IsAccepted</c>). So the
/// attribution picker and the correction path key on the same id after a round
/// trip, with no mapping layer.</para>
///
/// <para><b>Enums travel as NAMES.</b> <see cref="EngagementType"/>,
/// <see cref="ContractUnit"/>, <see cref="Shift"/> and <see cref="TimeBasis"/> are
/// <c>string</c>, matching every other enum in this DTO layer and making an
/// ordinal on the wire structurally impossible.</para>
/// </remarks>
public sealed record LabourEngagementDto(
    Guid LabourAssignmentId,

    /// <summary>The log this engagement belongs to — the anchor, restated so a flattened client list stays addressable.</summary>
    Guid DailyLogId,

    /// <summary><c>"Hired"</c> / <c>"Contract"</c> / <c>"Self"</c>.</summary>
    string EngagementType,

    /// <summary>
    /// The canonical reported headcount, exactly as stored. <c>null</c> means
    /// "we were not told" and NEVER "zero people worked" — an explicitly stated
    /// 0 stores 0 and stays distinguishable from silence.
    /// </summary>
    int? WorkerCount,

    /// <summary>The gender split exactly as stated; never derived from <see cref="WorkerCount"/>.</summary>
    int? MaleCount,
    int? FemaleCount,

    decimal? WagePerPerson,

    /// <summary><c>"Tree"</c> / <c>"Acre"</c> / <c>"Row"</c> / <c>"LumpSum"</c>, or null.</summary>
    string? ContractUnit,
    decimal? ContractQuantity,

    /// <summary>Stated total only (NO-MULTIPLY) — null when the farmer stated none.</summary>
    decimal? TotalCost,

    // ─────────────────────────────────────────────────────────────────────────
    // DURATION AND ITS PROVENANCE — PAIRED. Doctrine P8: `DurationHours` alone is
    // a lie; `DurationHours + TimeBasis` is a record.
    //
    // Both are REQUIRED positional parameters with no default and no nullability,
    // deliberately: omitting either is a COMPILE ERROR at every construction
    // site, so hours can never travel here without their basis. That is the
    // structural half. The other half is that there is exactly ONE construction
    // site (`DtoMappingExtensions.ToDto(this LabourAssignment, …)`), which reads
    // both from the same entity on two adjacent lines, so they cannot disagree
    // either. `LabourEngagementDtoPairingTests` fails if either property is ever
    // made optional or nullable.
    //
    // Do NOT "tidy" this into `decimal? DurationHours = null` for a caller that
    // does not know the basis: a caller that does not know the basis does not
    // know the duration.
    // ─────────────────────────────────────────────────────────────────────────

    decimal DurationHours,

    /// <summary><c>"Explicit"</c> (the farmer stated it) or <c>"Assumed"</c> (the server filled it in).</summary>
    string TimeBasis,

    /// <summary><c>"Full"</c> / <c>"Half"</c> / <c>"Night"</c>, or null. Descriptive, never money.</summary>
    string? Shift,

    /// <summary>The task as spoken (फवारणी/छाटणी/…). Descriptive, never money.</summary>
    string? Task,

    /// <summary>
    /// LABOUR_PHASE2 O-3 — the farmer's own note, verbatim. <c>null</c> means no
    /// note was written; it is never an empty string.
    /// </summary>
    string? Notes,

    /// <summary>
    /// Worker names AS STATED, free text. Never null — an empty list means the
    /// farmer named nobody, which is a complete record (doctrine P9), not a gap.
    /// This is NOT attribution: these names resolve to no identity and carry no
    /// id. <see cref="AttributedOperators"/> is the identified overlay.
    /// </summary>
    IReadOnlyList<string> WorkerNames,

    DateTime CreatedAtUtc,

    Guid? LinkedActivityId,

    /// <summary>
    /// The LIVE attribution set — who is attributed RIGHT NOW, after every
    /// correction. Empty is normal and complete. It NEVER modifies
    /// <see cref="WorkerCount"/>: three named people on an eight-worker
    /// engagement is still eight (P7).
    /// </summary>
    IReadOnlyList<AttributedOperatorDto> AttributedOperators);

/// <summary>
/// One live attribution row (<c>FieldOperatorWorkRow</c>) as a device reads it.
/// </summary>
/// <remarks>
/// <para><see cref="DisplayNameAtAttach"/> is the SNAPSHOT taken when the person
/// was attached, never the operator's current name — a payout approved for "बाळू"
/// must still read "बाळू" after a rename. <c>FullName</c> is deliberately absent:
/// it is not snapshotted onto work rows, so duplicating PII across every row is
/// not possible from here.</para>
/// <para>No count, no wage, no money — the same reason
/// <c>FieldOperatorWorkRow</c> carries none. Attribution is an overlay on a
/// reported quantity, never a replacement for it.</para>
/// </remarks>
public sealed record AttributedOperatorDto(
    Guid FieldOperatorId,
    string DisplayNameAtAttach);
