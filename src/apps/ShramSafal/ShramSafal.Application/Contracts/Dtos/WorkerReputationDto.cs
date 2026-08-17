// spec: dfes-companion-2026-07-11 (wave-4.4)

namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// What a worker carries with him — and the only thing that ever leaves the farm that
/// recorded it. Founder model, 2026-08-17.
///
/// <para>Two things, and nothing else: <see cref="Statements"/> is tier 2, the employers'
/// own words; <see cref="CompletedTasks"/> and <see cref="FieldWorkHours"/> are tier 3,
/// what Shram Safal itself counted. There is no tier-1 field here and none may be added —
/// no plot, no crop, no spray, no dose, no cost. Adding one would put a farm's business
/// record into the thing designed to travel.</para>
///
/// <para>The nullable counts are load-bearing. Null is "Shram Safal cannot honestly say",
/// and it must render as nothing at all — not as a zero, which a reader takes for a
/// judgement on the man. Doctrine P4.</para>
/// </summary>
/// <param name="Statements">
/// TIER 2. Empty means the farms said nothing, and silence is a perfectly ordinary
/// outcome — writing a statement is optional. It must never be rendered as an unrated
/// badge, a zero score, or "no reviews yet" phrasing that implies one was owed.
/// </param>
/// <param name="CompletedTasks">TIER 3. Null when none could be derived. Never a default.</param>
/// <param name="FieldWorkHours">
/// TIER 3. Null today, always — nothing in the model records hours actually worked. See
/// <c>WorkerDerivedCounts.WhyFieldWorkHoursAreNotCounted</c>.
/// </param>
/// <param name="CrossedFarmBoundary">
/// True only when this record left the farms the caller already stands in, on the worker's
/// own recorded consent. Reported so the answer carries its own provenance rather than
/// leaving a reader to guess how far the data travelled.
/// </param>
public sealed record WorkerReputationDto(
    Guid WorkerUserId,
    IReadOnlyList<WorkerStatementDto> Statements,
    int? CompletedTasks,
    decimal? FieldWorkHours,
    bool CrossedFarmBoundary);

/// <summary>
/// One farm's word about a worker, with the farm attached. TIER 2.
///
/// <para><see cref="FarmId"/> and <see cref="FarmName"/> are not optional garnish — a
/// reader has to know WHO is vouching before the words are worth anything, so a statement
/// is never rendered detached from its author.</para>
/// </summary>
public sealed record WorkerStatementDto(
    Guid FarmId,
    string FarmName,
    Guid AuthoredByUserId,
    string Remark,
    DateTime AuthoredAtUtc);
