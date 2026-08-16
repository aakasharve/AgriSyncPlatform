// spec: dfes-companion-2026-07-11 (wave-1.5)
namespace ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — run the one-time repair over days
/// recorded before wave-1.3 taught the server to self-attest an owner's own log.
/// </summary>
/// <param name="BatchSize">
/// Ceiling on logs examined in one pass. The backfill is self-limiting (an attested log
/// stops being a candidate), so a run that hits the ceiling is simply resumed by the next
/// one — the caller re-runs until <see cref="BackfillOwnerAttestationsResult.Scanned"/>
/// comes back below the ceiling.
/// </param>
public sealed record BackfillOwnerAttestationsCommand(int BatchSize = 500);

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
public sealed record BackfillOwnerAttestationsResult(int Scanned, int Attested, int LeftForReview);
