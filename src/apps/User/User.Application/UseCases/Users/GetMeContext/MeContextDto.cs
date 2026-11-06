namespace User.Application.UseCases.Users.GetMeContext;

/// <summary>
/// Response contract for <c>GET /user/auth/me/context</c>.
/// Shape is deliberately pre-computed so the semi-literate-user frontend
/// is a dumb renderer: no role→permission mapping, no plan→badge logic,
/// no stale-data conditionals in React.
/// </summary>
public sealed record MeContextDto(
    MeIdentityDto Me,
    IReadOnlyList<MeFarmDto> Farms,
    MeShareDto Share,
    IReadOnlyList<MeAlertDto> Alerts,
    DateTime ServerTimeUtc,
    // spec: plr-d10 lane MU-2 (MU design §6) — ADDITIVE, last: the waiting personal invitations that named the person's
    // proven number (his card: स्वीकारा / नको). Only with includePending (this release's phone); absent otherwise. A
    // waiting invitation is never a farm: it is not in Farms and carries nothing of the farm's data.
    IReadOnlyList<MeInvitationDto>? Invitations = null);

/// <summary>spec: plr-d10 lane MU-2 — one waiting invitation on the wire (no code, no farm id, no number).</summary>
public sealed record MeInvitationDto(
    Guid InvitationId,
    string FarmName,
    string? InvitedByName,
    string Label,
    string? Name,
    string PlotScope,
    IReadOnlyList<string> PlotNames,
    IReadOnlyList<MeAuthorityDto> Authorities,
    DateTime ExpiresAtUtc,
    bool NamesAWorker);

public sealed record MeIdentityDto(
    Guid UserId,
    string DisplayName,
    string PhoneMasked,
    DateTime? PhoneVerifiedAtUtc,
    string PreferredLanguage,
    string AuthMode);

public sealed record MeFarmDto(
    Guid FarmId,
    string Name,
    string? FarmCode,
    Guid OwnerAccountId,
    string Role,
    string Status,
    string JoinedVia,
    string Plan,
    DateTime? PlanValidUntilUtc,
    MeCapabilitiesDto Capabilities,
    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE, last (older phones ignore them):
    // the seat's effective permission names ("AddCost", "PlanWork", ...; empty unless Active) and
    // the owner's reason for a pause.
    IReadOnlyList<string>? Permissions = null,
    string? StatusReason = null,
    // lane 2b (MU design §2, §6) — ADDITIVE, last: every authority this seat holds now on this
    // farm (the label grants none), each with its end (null = कायम); empty unless Active. The
    // phone reads its doors from this, never from the label.
    IReadOnlyList<MeAuthorityDto>? Authorities = null);

/// <summary>lane 2b — one authority on the wire: the FarmAuthority NAME and its end (null = कायम).</summary>
public sealed record MeAuthorityDto(string Name, DateTime? ExpiresAtUtc);

public sealed record MeCapabilitiesDto(
    bool CanInvite,
    bool CanVerify,
    bool CanAddCost,
    bool CanSeeBilling);

public sealed record MeShareDto(
    string? ReferralCode,
    int ReferralsTotal,
    int ReferralsQualified,
    int BenefitsEarned);

public sealed record MeAlertDto(
    string Kind,
    string Severity,
    Guid? FarmId,
    int? DaysLeft);
