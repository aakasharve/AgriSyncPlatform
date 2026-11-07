using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.PersonalInvitations;

/// <summary>spec: plr-d10 lane MU-2 — what the owner asks for. Every field optional on the wire; the service says what is wrong.</summary>
public sealed record CreatePersonalInvitationInput(
    string? Label,
    string? Name,
    string? InvitedPhone,
    Guid? FieldOperatorId,
    string? PlotScope,
    IReadOnlyList<Guid>? PlotIds,
    IReadOnlyList<AuthorityGrantDto>? Authorities);

/// <summary>
/// spec: plr-d10 lane MU-2 — the owner's view of one invitation: the code and link he delivers (QR and link carry the same
/// invitation), what it grants, where it stands, and who claimed it. Only the last four digits of a named number.
/// <para>Fix round 1 (review H-1, L-4): <paramref name="ClaimedByName"/> and <paramref name="ClaimedByPhoneLast4"/> are the
/// CLAIMANT's own (his display name, the last four digits of his proven number) — the owner approves who claimed it, not
/// the name he typed. <paramref name="ClaimedByAnotherNumber"/> = it named a number and the claim came from another (or an
/// unproven) one: the link reached someone else. <paramref name="ClaimOutcome"/> = what became of the claim:
/// <c>WaitsForOwner</c>, <c>Joined</c>, <c>Declined</c> (his नको) or <c>Withdrawn</c> (the claimant took it back).</para>
/// </summary>
public sealed record PersonalInvitationView(
    Guid Id,
    Guid FarmId,
    string Code,
    string Link,
    string Label,
    string? Name,
    string? InvitedPhoneLast4,
    Guid? FieldOperatorId,
    string PlotScope,
    IReadOnlyList<Guid> PlotIds,
    IReadOnlyList<string> PlotNames,
    IReadOnlyList<AuthorityGrantDto> Authorities,
    string Status,
    DateTime CreatedAtUtc,
    DateTime ExpiresAtUtc,
    Guid? ClaimedByUserId,
    DateTime? ClaimedAtUtc,
    bool WaitsForOwner,
    bool WorkerLinked,
    string? ClaimedByName = null,
    string? ClaimedByPhoneLast4 = null,
    bool ClaimedByAnotherNumber = false,
    string? ClaimOutcome = null,
    // spec: plr-d10 lane MU-1 (MU-2 review N-4) - ADDITIVE, last: the invitation ended because the PERSON's data was erased
    // (stored Withdrawn with nobody as the one who ended it). The owner's list says so; it is not "taken back" by him.
    bool PersonErased = false);

/// <summary>Fix round 1 — who claimed an invitation, as the owner's list shows him.</summary>
public sealed record InvitationClaimant(string? Name, string? PhoneLast4, bool AnotherNumber, string? Outcome);

/// <summary>
/// spec: plr-d10 lane MU-2 — the invited person's card: "‹farm› ने तुम्हाला बोलावलं आहे · जबाबदारी: … · प्लॉट … ·
/// स्वीकारा / नको". What the owner chose, and nothing else of the farm: no code, no farm id, no number.
/// <paramref name="NamesYou"/> = it named this person's proven number (स्वीकारा then lets him in at once).
/// </summary>
public sealed record InvitationCardView(
    Guid InvitationId,
    string FarmName,
    string? InvitedByName,
    string Label,
    string? Name,
    string PlotScope,
    IReadOnlyList<string> PlotNames,
    IReadOnlyList<AuthorityGrantDto> Authorities,
    DateTime ExpiresAtUtc,
    string Status,
    bool NamesYou,
    bool NamesAWorker);

/// <summary>spec: plr-d10 lane MU-2 — the answer to स्वीकारा: Active at once, or a request waiting for the owner.</summary>
public sealed record InvitationAcceptView(
    Guid FarmId,
    string FarmName,
    string Status,
    Guid MembershipId,
    bool WorkerLinked);

/// <summary>spec: plr-d10 lane MU-2 — the ONE place an invitation becomes a view or a card (owner routes, invitee routes,
/// <c>/me/context</c>).</summary>
public static class PersonalInvitationProjection
{
    public static IReadOnlyList<AuthorityGrantDto> AuthorityList(PersonalInvitation invitation) =>
        invitation.Authorities()
            .OrderBy(a => FarmAuthorities.All.ToList().IndexOf(a.Key))
            .Select(a => new AuthorityGrantDto(FarmAuthorities.NameOf(a.Key), a.Value))
            .ToList();

    public static PersonalInvitationView View(PersonalInvitation invitation, DateTime nowUtc, InvitationClaimant? claimant = null) => new(
        Id: invitation.Id,
        FarmId: invitation.FarmId.Value,
        Code: invitation.Code,
        Link: PersonalInvitationCode.LinkOf(invitation.Code),
        Label: invitation.Label.ToString(),
        Name: invitation.PersonName,
        InvitedPhoneLast4: invitation.InvitedPhoneE164 is { } phone ? phone[^4..] : null,
        FieldOperatorId: invitation.FieldOperatorId,
        PlotScope: invitation.PlotScope.ToString(),
        PlotIds: invitation.ScopePlotIds,
        PlotNames: invitation.ScopePlotNames,
        Authorities: AuthorityList(invitation),
        Status: invitation.StatusAt(nowUtc).ToString(),
        CreatedAtUtc: invitation.CreatedAtUtc,
        ExpiresAtUtc: invitation.ExpiresAtUtc,
        ClaimedByUserId: invitation.ClaimedByUserId?.Value,
        ClaimedAtUtc: invitation.ClaimedAtUtc,
        WaitsForOwner: invitation.WaitsForOwner,
        WorkerLinked: invitation.WorkerLinked,
        ClaimedByName: claimant?.Name,
        ClaimedByPhoneLast4: claimant?.PhoneLast4,
        ClaimedByAnotherNumber: claimant?.AnotherNumber ?? false,
        ClaimOutcome: claimant?.Outcome,
        PersonErased: invitation.Status == PersonalInvitationStatus.Withdrawn && invitation.EndedByUserId is null);

    /// <summary>
    /// The card. Fix round 1 (review L-11): a code is often forwarded, so the card says only what its holder needs — the
    /// name the owner typed is shown only to the person whose proven number it named (his own name); an ENDED invitation
    /// says its reason alone (farm and status), with no grant, no plots and no name.
    /// </summary>
    public static InvitationCardView Card(
        PersonalInvitation invitation, DateTime nowUtc, string? inviteePhoneE164, string? invitedByName)
    {
        var status = invitation.StatusAt(nowUtc);
        var live = status == PersonalInvitationStatus.Waiting;
        var namesYou = invitation.Names(inviteePhoneE164);
        return new InvitationCardView(
            InvitationId: invitation.Id,
            FarmName: invitation.FarmName,
            InvitedByName: live ? invitedByName : null,
            Label: invitation.Label.ToString(),
            Name: live && namesYou ? invitation.PersonName : null,
            PlotScope: invitation.PlotScope.ToString(),
            PlotNames: live ? invitation.ScopePlotNames : [],
            Authorities: live ? AuthorityList(invitation) : [],
            ExpiresAtUtc: invitation.ExpiresAtUtc,
            Status: status.ToString(),
            NamesYou: namesYou,
            NamesAWorker: live && invitation.FieldOperatorId is not null);
    }
}
