namespace ShramSafal.Domain.Tests;

/// <summary>
/// Category of analytical test the protocol prescribes. See CEI §4.5.
/// </summary>
public enum TestProtocolKind
{
    Soil = 0,
    Petiole = 1,
    Drainage = 2,
    Residue = 3,
    LandAmendment = 4,
    Custom = 5
}
