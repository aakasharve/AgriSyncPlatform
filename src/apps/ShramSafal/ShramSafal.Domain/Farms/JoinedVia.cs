namespace ShramSafal.Domain.Farms;

/// <summary>
/// How a <see cref="FarmMembership"/> came to exist. Audit-only signal,
/// never an authorization input (spec §8.5.1).
/// </summary>
public enum JoinedVia
{
    PrimaryOwnerBootstrap = 1,
    OwnerManualAdd = 2,
    QrScan = 3,
    SelfJoin = 4,

    /// <summary>spec: plr-d10 lane MU-2 — claimed from a personal invitation (label, plots and authorities chosen first).</summary>
    PersonalInvitation = 5,
}
