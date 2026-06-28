namespace ShramSafal.Domain.Farms;

/// <summary>Kind of a polymorphic <see cref="EventLink"/> between farm operations
/// (and to cost entries) — ADR 0023 §1.3.</summary>
public enum LinkKind
{
    CarrierFor,
    FertigationFor,
    CostOf,
    LabourFor,
    DisturbanceBlocks,
}
