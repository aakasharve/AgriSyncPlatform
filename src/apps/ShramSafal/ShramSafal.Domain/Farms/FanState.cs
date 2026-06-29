namespace ShramSafal.Domain.Farms;

/// <summary>Blower fan state (plan §3.2i). Stored on a NULLABLE column — null means
/// the farmer did not mention it (no-guess; never an "Unknown" fabrication).</summary>
public enum FanState
{
    On,
    Off,
}
