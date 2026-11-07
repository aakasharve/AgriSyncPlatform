using ShramSafal.Application.UseCases.Memberships.PersonalInvitations;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10 lane MU-2 — the personal invitations (<c>ssf.farm_personal_invitations</c>, FORCE RLS on its own
/// <c>farm_id</c>). Every farm-keyed read names the farm in its predicate as well (doctrine E4: RLS "visible" is not
/// "authorised"); the two invitee reads see only what the invitee door of <see cref="IPersonalInvitationTenantScope"/>
/// opened (the row naming his proven number, or the row whose code he typed).
/// </summary>
public interface IPersonalInvitationRepository
{
    Task AddAsync(PersonalInvitation invitation, CancellationToken ct = default);

    /// <summary>One of THIS farm's invitations, tracked and row-locked for a decision (<c>FOR UPDATE</c>).</summary>
    Task<PersonalInvitation?> GetForFarmForUpdateAsync(Guid farmId, Guid invitationId, CancellationToken ct = default);

    /// <summary>This farm's invitations made since <paramref name="sinceUtc"/>, newest first.</summary>
    Task<IReadOnlyList<PersonalInvitation>> ListForFarmAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>How many invitations this farm made since <paramref name="sinceUtc"/> (the daily cap).</summary>
    Task<int> CountCreatedSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default);

    /// <summary>This farm's still-waiting invitations that named <paramref name="phoneE164"/>, tracked.</summary>
    Task<IReadOnlyList<PersonalInvitation>> GetWaitingForPhoneAsync(Guid farmId, string phoneE164, CancellationToken ct = default);

    /// <summary>Under the invitee door: the invitation with exactly this code, or <c>null</c>. Not tracked.</summary>
    Task<PersonalInvitation?> FindVisibleByCodeAsync(string code, CancellationToken ct = default);

    /// <summary>
    /// Under the invitee door: the still-waiting, unexpired invitations it shows (those naming his proven number), newest
    /// first, at most 50 — filtered BEFORE the 50 are taken (fix round 1, L-12), so ended ones never push a live card out.
    /// Not tracked.
    /// </summary>
    Task<IReadOnlyList<PersonalInvitation>> ListVisibleWaitingAsync(DateTime nowUtc, CancellationToken ct = default);

    /// <summary>Under the invitee door: the invitation with this id, or <c>null</c>. Not tracked.</summary>
    Task<PersonalInvitation?> FindVisibleByIdAsync(Guid invitationId, CancellationToken ct = default);

    /// <summary>
    /// Saves a NEW invitation. A clash on the unique code is <see cref="PersonalInvitationSaveOutcome.CodeTaken"/> (the
    /// caller makes a fresh code and tries again); a clash on the one-waiting-per-(farm, mobile) index is
    /// <see cref="PersonalInvitationSaveOutcome.NumberBusy"/> (another invitation for that number was made at the same
    /// moment). Either way nothing of the attempt is written (rolled back to a savepoint, so the request's transaction lives
    /// on).
    /// </summary>
    Task<PersonalInvitationSaveOutcome> TrySaveNewAsync(PersonalInvitation invitation, CancellationToken ct = default);

    /// <summary>
    /// Fix round 1 (review M-5) — saves a claim (the seat, the invitation, the audit row and any identity rows a worker link
    /// staged) as one unit. A lost race on the one-live-seat-per-(farm, person) index is
    /// <see cref="InvitationClaimSaveOutcome.SeatTaken"/>; on WID's verified-number indexes (one holder per number, one
    /// verified number per person) <see cref="InvitationClaimSaveOutcome.IdentityClash"/>. Either way nothing is written
    /// (rolled back to a savepoint; the request's transaction stays usable) and every staged change is dropped.
    /// </summary>
    Task<InvitationClaimSaveOutcome> TrySaveClaimAsync(CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}

/// <summary>Fix round 1 — how saving a new invitation ended.</summary>
public enum PersonalInvitationSaveOutcome
{
    Saved,
    CodeTaken,
    NumberBusy,
}

/// <summary>Fix round 1 (review M-5) — how saving a claim ended.</summary>
public enum InvitationClaimSaveOutcome
{
    Saved,
    SeatTaken,
    IdentityClash,
}

/// <summary>
/// spec: plr-d10 lane MU-2 — the tenant scope of the invitee's requests, staged like the typed farm-code join
/// (<see cref="IJoinCodeTenantScope"/>): the person is, by definition, not a member of the farm yet.
/// <list type="number">
/// <item><see cref="OpenInviteeDoorAsync"/> — silences the tenant interceptor and opens two SELECT-only doors on
/// <c>ssf.farm_personal_invitations</c>: the rows naming HIS proven number (the server's own record, never the request's)
/// and the one row whose code he typed. No farm id is set, so nothing else of any farm is visible.</item>
/// <item><see cref="PublishInvitationFarmScopeAsync"/> — called only with the farm of the row stage 1 found: closes both
/// doors and opens that farm's scope for the seat, the invitation update and the audit row — that farm, no other.</item>
/// </list>
/// </summary>
public interface IPersonalInvitationTenantScope
{
    /// <summary>Stage 0: silences the tenant interceptor only (no setting written), so the caller's own proven number can
    /// be read from the global user directory before any door opens. Must run before the request's first command.</summary>
    Task BeginInviteeLookupAsync(CancellationToken ct = default);

    Task OpenInviteeDoorAsync(string? inviteePhoneE164, string? code, CancellationToken ct = default);

    Task PublishInvitationFarmScopeAsync(Guid invitationFarmId, Guid claimantUserId, CancellationToken ct = default);
}

/// <summary>
/// spec: plr-d10 lane MU-2 (MU design §6, "one read model") — the waiting invitations that named a person's proven number,
/// read outside the request pipeline (<c>/me/context</c>), with the same projection the invitee routes answer with.
/// </summary>
public interface IPersonalInvitationInviteeReader
{
    Task<IReadOnlyList<InvitationCardView>> ListWaitingForUserAsync(Guid userId, CancellationToken ct = default);
}
