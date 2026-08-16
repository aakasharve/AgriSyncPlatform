// spec: dfes-companion-2026-07-11 (wave-1.5)
namespace ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — run the one-time repair over days
/// recorded before wave-1.3 taught the server to self-attest an owner's own log.
/// </summary>
/// <param name="BatchSize">
/// Ceiling on logs examined in one pass. The caller re-runs until
/// <see cref="BackfillOwnerAttestationsResult.Scanned"/> comes back below the ceiling,
/// carrying the previous pass's cursor forward each time.
/// </param>
/// <param name="AfterCreatedAtUtc">
/// Cursor from the previous pass (<see cref="BackfillOwnerAttestationsResult.LastCreatedAtUtc"/>).
/// Null starts at the oldest candidate.
///
/// <para><b>Why the pass needs a cursor at all (wave-1.5 review, I1).</b> The repair is
/// self-limiting for logs it ATTESTS — they gain events and stop being candidates. It is
/// NOT self-limiting for logs it REFUSES: a mukadam's day, or one whose creator has left
/// the farm, stays a candidate permanently. Candidates come back oldest-first, so a run of
/// refusals occupies the front of every re-read. Without a cursor a caller looping on
/// "the first N candidates" re-reads those same refusals forever and everything sorting
/// behind them is unreachable — an owner's repairable day behind 500 of them would never
/// be repaired, on any restart.</para>
/// </param>
/// <param name="AfterId">
/// Tie-break half of the cursor (<see cref="BackfillOwnerAttestationsResult.LastId"/>).
/// Required alongside <paramref name="AfterCreatedAtUtc"/> because creation timestamps are
/// not unique.
/// </param>
public sealed record BackfillOwnerAttestationsCommand(
    int BatchSize = 500,
    DateTime? AfterCreatedAtUtc = null,
    Guid? AfterId = null);

/// <summary>
/// What the pass actually did. Deliberately reports the SKIPPED count separately from the
/// attested one: "0 attested" is an unremarkable second run, but "0 attested, 400 left
/// needing a human" is a pilot whose history is still stuck, and the two must never be
/// indistinguishable in a log line.
/// </summary>
/// <param name="Scanned">Logs with no verification history at all that this pass examined.</param>
/// <param name="Attested">Logs whose own creator held owner authority, now Verified.</param>
/// <param name="LeftForReview">
/// Logs deliberately untouched: the creator holds no current membership on the farm, or
/// holds one that cannot vouch for work (a mukadam's day still needs an owner to approve
/// it). These stay in the review inbox, which is the correct outcome, not a failure.
/// </param>
/// <param name="LastCreatedAtUtc">
/// <c>CreatedAtUtc</c> of the last candidate this pass examined — feed straight back in as
/// <see cref="BackfillOwnerAttestationsCommand.AfterCreatedAtUtc"/> to continue past it.
/// A pass that scanned nothing echoes the cursor it was given, so the caller's loop never
/// loses its place.
/// </param>
/// <param name="LastId">
/// Id of that same last candidate — the tie-break half of the cursor.
/// </param>
public sealed record BackfillOwnerAttestationsResult(
    int Scanned,
    int Attested,
    int LeftForReview,
    DateTime? LastCreatedAtUtc = null,
    Guid? LastId = null);
