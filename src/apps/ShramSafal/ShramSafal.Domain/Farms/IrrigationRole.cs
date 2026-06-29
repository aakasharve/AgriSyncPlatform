namespace ShramSafal.Domain.Farms;

/// <summary>Discriminates how water was used (ADR 0023 / plan §3.2e): a spray
/// carrier (excluded from irrigation coverage), plain irrigation, or fertigation.</summary>
public enum IrrigationRole
{
    SprayCarrier,
    Irrigation,
    Fertigation,
}
