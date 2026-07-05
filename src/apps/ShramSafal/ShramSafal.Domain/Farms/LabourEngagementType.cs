namespace ShramSafal.Domain.Farms;

/// <summary>How labour was engaged (maps frontend LabourEvent.type, plan §3.2d).</summary>
public enum LabourEngagementType
{
    Hired,
    Contract,
    Self,
}
