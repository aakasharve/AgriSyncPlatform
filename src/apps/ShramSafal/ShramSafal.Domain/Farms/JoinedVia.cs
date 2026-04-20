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
}
