namespace ShramSafal.Application.UseCases.Finance.SetFarmRate;

/// <summary>
/// spec: plr-d10 lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43) — one change to one rate of one farm's
/// own list, from either door: the queued push (<c>set_farm_rate</c>) or REST (<c>POST /shramsafal/finance/farm-rates</c>).
/// <see cref="Change"/> is <c>set</c> (a new rate, or a new version of one) or <c>retire</c> (stop it; carries no values).
/// Enum values are their wire NAMES (<c>Input</c> / <c>Work</c>; <c>PerUnit</c> … <c>PerTask</c>). There is no version:
/// the server numbers them.
/// </summary>
public sealed record SetFarmRateCommand(
    Guid FarmRateId,
    Guid RateLineId,
    Guid FarmId,
    string? Change,
    string? Kind,
    string? ItemName,
    string? Unit,
    string? Basis,
    string? WorkerCategory,
    decimal? Amount,
    string? CurrencyCode,
    DateOnly? EffectiveFrom,
    string? Season,
    DateOnly? EndsOn,
    Guid? SuggestionId,
    Guid ActorUserId,
    string? ActorRole = null,
    string? ClientRequestId = null,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown")
{
    public const string SetChange = "set";
    public const string RetireChange = "retire";
}
