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
    DateTime ServerTimeUtc);

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
    MeCapabilitiesDto Capabilities);

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
