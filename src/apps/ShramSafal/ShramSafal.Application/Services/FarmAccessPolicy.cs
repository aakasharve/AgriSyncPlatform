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
/// <para>lane MU-3 — <c>AccessChangedAtUtc</c>: when what this seat may read last changed, the later of
/// the seat's creation and its last status / label / authority change; <c>null</c> when unknown (a test
/// double, or the registrant). The sync pull re-sends the farm when it is newer than the phone's cursor.</para>
/// <para>spec: plr-d10 lane MU-4 — <c>PlotScope</c> / <c>ScopePlotIds</c>: which plots the seat covers (the second layer of
/// the MU design §2). Every plot (<see cref="MembershipPlotScope.AllPlots"/>, no ids) for the registrant, for a test double
/// and for every seat made before MU-4.</para>
/// </summary>
public sealed record FarmAccess(
    AppRole Role,
    MembershipStatus Status,
    bool IsRegistrant,
    FarmPermission? StoredPermissions,
    bool LabourGrant = false,
    DateTime? LabourGrantExpiresAtUtc = null,
    string? AuthorityExpiresAtJson = null,
    DateTime? AccessChangedAtUtc = null,
    MembershipPlotScope PlotScope = MembershipPlotScope.AllPlots,
    IReadOnlyCollection<Guid>? ScopePlotIds = null)
{
    /// <summary>
    /// lane MU-4 — the plots this standing covers, or <c>null</c> for every plot: the registrant and the primary owner's
    /// label always cover every plot; a chosen-plots seat covers its chosen plots (an empty set — a row the check
    /// constraint forbids — covers none, failing closed); own work reads by maker, not by plot (<c>null</c> here).
    /// </summary>
    public IReadOnlySet<Guid>? CoveredPlotIds =>
        IsRegistrant || Role == AppRole.PrimaryOwner || PlotScope != MembershipPlotScope.ChosenPlots
            ? null
            : (ScopePlotIds ?? []).ToHashSet();

    /// <summary>lane MU-4 — a seat whose scope is स्वतःचं काम (never the registrant's or the primary owner's).</summary>
    public bool OwnWorkScope =>
        !IsRegistrant && Role != AppRole.PrimaryOwner && PlotScope == MembershipPlotScope.OwnWork;
}

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

        // spec: plr-d10 lane MU-4 (MU design §11.6) — editing the farm's setup (plots, boundary, motors, water) is a
        // whole-farm act: it needs "edit farm setup" AND a seat that covers every plot. Reading the setup stays open.
        if (authority == FarmAuthority.EditFarmSetup && access.PlotScope != MembershipPlotScope.AllPlots
            && access.Role != AppRole.PrimaryOwner)
        {
            return false;
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

    /// <summary>
    /// lane MU-3 — may this standing read ANYTHING of the farm? The registrant, or an Active seat. A
    /// waiting request, a paused seat, an ended one or no standing at all reads nothing (BN-1). What it
    /// may read is <see cref="FarmReadScope"/>.
    /// </summary>
    public static bool MayRead(FarmAccess? access) =>
        access is not null && (access.IsRegistrant || access.Status == MembershipStatus.Active);

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

    /// <summary>
    /// Not held now, but stored on the (still Active) seat, alive when the work happened, the work
    /// happened within <see cref="LateArrivalWindow.DoneWithinDaysBeforeEnd"/> days before the end and
    /// reached the server within <see cref="LateArrivalWindow.ReceivedWithinDaysAfterEnd"/> days after
    /// it: a NEW record is accepted and flagged for the owner (never an overwrite — the caller checks).
    /// </summary>
    HeldWhenItHappened,

    /// <summary>
    /// Stored on the (still Active) seat but ENDED, and the work is outside the late window (or done
    /// after the end): refused and kept whole for the owner by the sync layer, never applied.
    /// </summary>
    Ended,
}

/// <summary>
/// lane 2b fix 1 (HIGH-2; orchestrator's numbers) — how late work from an ENDED authority may be and
/// still count. The server's own clock decides arrival; the work's own date (the phone's statement)
/// must lie inside the days just before the end. Anything else from an ended authority is kept for
/// the owner and not applied (P9, P10).
/// </summary>
public static class LateArrivalWindow
{
    /// <summary>The server must RECEIVE it within this many days after the authority ended.</summary>
    public const int ReceivedWithinDaysAfterEnd = 7;

    /// <summary>The work's own date must lie within this many days before the end.</summary>
    public const int DoneWithinDaysBeforeEnd = 7;
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
    /// lane 2b (MU design §11.2; fix 1 HIGH-2) — for work that may have been done offline: is the
    /// authority held now, or does late work still count? <see cref="AuthorityStanding.HeldWhenItHappened"/>
    /// only inside <see cref="LateArrivalWindow"/>: the authority ended at most
    /// <see cref="LateArrivalWindow.ReceivedWithinDaysAfterEnd"/> days ago by the SERVER's clock, and the
    /// work (<paramref name="occurredAtUtc"/>, the phone's statement) happened before the end and at
    /// most <see cref="LateArrivalWindow.DoneWithinDaysBeforeEnd"/> days before it. A stored authority
    /// outside that is <see cref="AuthorityStanding.Ended"/>. Only a seat that is STILL Active can be
    /// either: work from a paused or removed seat is <see cref="AuthorityStanding.NotHeld"/> (the owner
    /// stopped that person; the server cannot tell from the seat whether a later pause came first).
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
            || access.Status != MembershipStatus.Active
            || !FarmAuthorities.IsStored(access.StoredPermissions, access.LabourGrant, authority))
        {
            return (AuthorityStanding.NotHeld, null);
        }

        // Stored on a working seat, not held now: it ENDED — its own end, or the end of what it needs
        // (see money), whichever passed first. No readable end (a corrupt document) = no late window.
        var expiries = FarmAuthorities.ParseExpiries(access.AuthorityExpiresAtJson);
        DateTime? EndOf(FarmAuthority a) => FarmAuthorities.ExpiryOf(
            access.StoredPermissions, access.LabourGrant, access.LabourGrantExpiresAtUtc, expiries, a);
        var ended = new[] { EndOf(authority), FarmAuthorities.RequiredBy(authority) is { } needed ? EndOf(needed) : null }
            .Where(e => e is not null && e <= nowUtc && e > DateTime.MinValue)
            .Min();
        if (ended is not { } end)
        {
            return (AuthorityStanding.Ended, null);
        }

        var inWindow = occurredAtUtc is { } happened
            && happened < end
            && happened >= end.AddDays(-LateArrivalWindow.DoneWithinDaysBeforeEnd)
            && nowUtc <= end.AddDays(LateArrivalWindow.ReceivedWithinDaysAfterEnd)
            && FarmAccessPolicy.Holds(access, authority, happened);
        return (inWindow ? AuthorityStanding.HeldWhenItHappened : AuthorityStanding.Ended, end);
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
