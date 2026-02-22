namespace ShramSafal.Domain.Location;

public sealed record LocationSnapshot
{
    public decimal Latitude { get; init; }
    public decimal Longitude { get; init; }
    public decimal AccuracyMeters { get; init; }
    public decimal? Altitude { get; init; }
    public DateTime CapturedAtUtc { get; init; }
    public string Provider { get; init; } = "unknown";
    public string PermissionState { get; init; } = "prompt";
}
