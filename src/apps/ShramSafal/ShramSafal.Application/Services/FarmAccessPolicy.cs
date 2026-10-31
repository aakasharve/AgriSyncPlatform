using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, plan §2 #1), lane 2b — one person's standing on one
/// farm, as the access rule needs it: the label (role), the seat status, whether they are the farm's
/// registrant (<c>farms.owner_user_id</c>, the primary account holder, who always holds every
/// authority), and what the primary account holder stored: the permission bits, the labour grant
/// (take हजेरी) with its end, and the per-authority ends. Loaded by
/// <see cref="IShramSafalRepository.GetFarmAccessForUserAsync"/>.
/// </summary>
public sealed record FarmAccess(
    AppRole Role,
    MembershipStatus Status,
    bool IsRegistrant,
    FarmPermission? StoredPermissions,
    bool LabourGrant = false,
    DateTime? LabourGrantExpiresAtUtc = null,
    string? AuthorityExpiresAtJson = null);

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b (MU design §2, §11.1, §11.2) — THE rule
/// for "may this person do X on this farm". Pure: the async load lives in
/// <see cref="FarmAuthorityGate"/>, so the rule is enumerated without a database.
/// <list type="bullet">
/// <item>No standing (not a member) → nothing.</item>
/// <item>The registrant → everything, whatever any row says.</item>
/// <item>A seat that is not Active (waiting, paused) → nothing.</item>
/// <item>Otherwise <see cref="FarmAuthorities.IsHeld"/>: the primary owner's label holds all; every
/// other label (सहमालक and कुटुंब included) holds exactly what is stored and not yet ended.</item>
/// </list>
/// </summary>
public static class FarmAccessPolicy
{
    /// <summary>Does this standing hold <paramref name="authority"/> at <paramref name="atUtc"/>?</summary>
    public static bool Holds(FarmAccess? access, FarmAuthority authority, DateTime atUtc)
    {
        if (access is null)
        {
            return false;
        }

        if (access.IsRegistrant)
        {
            return true;
        }

        return access.Status == MembershipStatus.Active
            && FarmAuthorities.IsHeld(
                access.Role,
                access.StoredPermissions,
                access.LabourGrant,
                access.LabourGrantExpiresAtUtc,
                access.AuthorityExpiresAtJson,
                authority,
                atUtc);
    }

    /// <summary>Is this the primary account holder (people and permissions, transfer, deletion — D-26)?</summary>
    public static bool IsPrimaryAccountHolder(FarmAccess? access) =>
        access is not null
        && (access.IsRegistrant
            || (access.Status == MembershipStatus.Active && access.Role == AppRole.PrimaryOwner));

    /// <summary>
    /// The stored-bit set this standing holds at <paramref name="atUtc"/> (expiry and "needs see
    /// money" applied), for the legacy <c>permissions</c> names on the wire.
    /// </summary>
    public static FarmPermission EffectiveBits(FarmAccess? access, DateTime atUtc)
    {
        var bits = FarmPermission.None;
        foreach (var authority in FarmAuthorities.All)
        {
            var bit = FarmAuthorities.BitOf(authority);
            if (bit != FarmPermission.None && Holds(access, authority, atUtc))
            {
                bits |= bit;
            }
        }

        return bits;
    }

    /// <summary>Every authority this standing holds at <paramref name="atUtc"/>, with its end (<c>null</c> = कायम).</summary>
    public static IReadOnlyList<KeyValuePair<FarmAuthority, DateTime?>> HeldAuthorities(FarmAccess? access, DateTime atUtc)
    {
        if (access is null)
        {
            return [];
        }

        var expiries = FarmAuthorities.ParseExpiries(access.AuthorityExpiresAtJson);
        var everything = access.IsRegistrant || access.Role == AppRole.PrimaryOwner;
        return FarmAuthorities.All
            .Where(a => Holds(access, a, atUtc))
            .Select(a => new KeyValuePair<FarmAuthority, DateTime?>(
                a,
                everything
                    ? null
                    : FarmAuthorities.ExpiryOf(
                        access.StoredPermissions, access.LabourGrant, access.LabourGrantExpiresAtUtc, expiries, a)))
            .ToList();
    }
}

/// <summary>
/// lane 2b — what the server knows about one person and one authority at one moment, for deciding
/// what to do with work that arrives LATE (MU design §11.2): held now, held when the work happened,
/// or neither.
/// </summary>
public enum AuthorityStanding
{
    /// <summary>Not a member, or never stored — the plain refusal.</summary>
    NotHeld,

    /// <summary>Held now: the work is accepted as usual.</summary>
    HeldNow,

    /// <summary>Not held now, but stored on the (still Active) seat and alive when the work happened: accepted and flagged for the owner.</summary>
    HeldWhenItHappened,
}

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b — the async half of
/// <see cref="FarmAccessPolicy"/>: load the caller's standing on THIS farm and answer. Callers map
/// <c>false</c> to <c>ShramSafalErrors.Forbidden</c> (never NotFound), the posture every gate here
/// takes. The standing is the farm SEAT's — never the account's global role (MU design §2).
/// </summary>
public static class FarmAuthorityGate
{
    public static async Task<bool> HoldsAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        FarmAuthority authority,
        DateTime atUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        return FarmAccessPolicy.Holds(access, authority, atUtc);
    }

    /// <summary>The primary account holder of this farm (D-26: people and permissions are his alone).</summary>
    public static async Task<bool> IsPrimaryAccountHolderAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        return FarmAccessPolicy.IsPrimaryAccountHolder(access);
    }

    /// <summary>
    /// lane 2b (MU design §11.2) — for work that may have been done offline: is the authority held
    /// now, or was it held when the work happened (<paramref name="occurredAtUtc"/>, the client's own
    /// statement, bounded to the past)? Only a seat that is STILL Active can be
    /// <see cref="AuthorityStanding.HeldWhenItHappened"/>: work from a paused or removed seat is kept
    /// as a mark for the owner, never written (the owner stopped that person; the server cannot tell
    /// from the seat whether a later pause came first).
    /// </summary>
    public static async Task<(AuthorityStanding Standing, DateTime? EndedAtUtc)> StandingAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        FarmAuthority authority,
        DateTime nowUtc,
        DateTime? occurredAtUtc,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return (AuthorityStanding.NotHeld, null);
        }

        var access = await repository.GetFarmAccessForUserAsync(farmId, userId, ct);
        if (FarmAccessPolicy.Holds(access, authority, nowUtc))
        {
            return (AuthorityStanding.HeldNow, null);
        }

        if (access is null
            || occurredAtUtc is not { } happened
            || happened >= nowUtc
            || !FarmAccessPolicy.Holds(access, authority, happened))
        {
            return (AuthorityStanding.NotHeld, null);
        }

        // Held then, not now, on a seat that is still Active: the end that passed in between. It is
        // the authority's own end, or the end of what it needs (see money), whichever came first.
        var expiries = FarmAuthorities.ParseExpiries(access.AuthorityExpiresAtJson);
        DateTime? EndOf(FarmAuthority a) => FarmAuthorities.ExpiryOf(
            access.StoredPermissions, access.LabourGrant, access.LabourGrantExpiresAtUtc, expiries, a);
        var ended = new[] { EndOf(authority), FarmAuthorities.RequiredBy(authority) is { } needed ? EndOf(needed) : null }
            .Where(e => e is not null && e > happened && e <= nowUtc)
            .Min();
        return (AuthorityStanding.HeldWhenItHappened, ended);
    }
}

/// <summary>
/// lane 2b (MU design §11.2) — the machine-readable audit actions for work that reached the server
/// after the authority it needed had ended. Stable on purpose (owner surfaces and tests match on
/// them); the farmer-facing words ("जबाबदारी संपल्यानंतर पोहोचलं", PROPOSED) live on the phone.
/// </summary>
public static class LateAuthorityAudit
{
    /// <summary>The work happened while the authority was alive and arrived after it ended: written, and flagged for the owner.</summary>
    public const string AcceptedAfterEnd = "AcceptedAfterResponsibilityEnded";

    /// <summary>The work was refused for want of an authority (or of a working seat): NOT written, kept whole for the owner.</summary>
    public const string KeptForOwner = "WorkKeptForOwner";
}
