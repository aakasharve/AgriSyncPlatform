using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2). The ONE rule for "who may open तुलना": the primary account
/// holder, or a seat that holds <see cref="FarmAuthority.SeeCompare"/> now. Moved here unchanged from the compare read so that a WRITE that needs the very same
/// authority (<c>logreason.set</c>) can ask the rule without naming the read itself (a record door never asks the compare read, which waits for a schedule).
/// A Worker label can never hold the bit (<see cref="FarmAuthorities.CanBeHeldBy"/>), a paused or waiting seat holds nothing, no standing holds nothing.
/// </summary>
public static class FarmCompareGate
{
    public static bool Gate(FarmAccess? access, DateTime atUtc) =>
        FarmAccessPolicy.IsPrimaryAccountHolder(access) || FarmAccessPolicy.Holds(access, FarmAuthority.SeeCompare, atUtc);
}
