namespace ShramSafal.Domain.Farms;

/// <summary>Type of machine used (maps frontend MachineryEvent.type).</summary>
public enum MachineType
{
    Tractor,
    Tiller,
    Harvester,
    Drone,
    Sprayer,
    Unknown,
}
