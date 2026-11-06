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
    bool WorkerLinked);

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

    public static PersonalInvitationView View(PersonalInvitation invitation, DateTime nowUtc) => new(
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
        WorkerLinked: invitation.WorkerLinked);

    public static InvitationCardView Card(
        PersonalInvitation invitation, DateTime nowUtc, string? inviteePhoneE164, string? invitedByName) => new(
        InvitationId: invitation.Id,
        FarmName: invitation.FarmName,
        InvitedByName: invitedByName,
        Label: invitation.Label.ToString(),
        Name: invitation.PersonName,
        PlotScope: invitation.PlotScope.ToString(),
        PlotNames: invitation.ScopePlotNames,
        Authorities: AuthorityList(invitation),
        ExpiresAtUtc: invitation.ExpiresAtUtc,
        Status: invitation.StatusAt(nowUtc).ToString(),
        NamesYou: invitation.Names(inviteePhoneE164),
        NamesAWorker: invitation.FieldOperatorId is not null);
}
