namespace ShramSafal.Domain.Planning;

/// <summary>
/// spec: plr-d10 lane SCH-A (Task 1) - who a schedule comes from: the phone's own owner types
/// (<c>ScheduleOwnerType</c>, <c>scheduler.types.ts</c>), on the wire as <c>INSTITUTION | EXPERT | USER | SYSTEM_DEFAULT</c>.
/// </summary>
public enum ScheduleOwnerType
{
    Institution = 0,
    Expert = 1,
    User = 2,
    SystemDefault = 3,
}

public static class ScheduleOwnerTypeWire
{
    public static string ToWire(ScheduleOwnerType type) => type switch
    {
        ScheduleOwnerType.Institution => "INSTITUTION",
        ScheduleOwnerType.Expert => "EXPERT",
        ScheduleOwnerType.User => "USER",
        _ => "SYSTEM_DEFAULT",
    };

    public static bool TryParse(string? wire, out ScheduleOwnerType type)
    {
        switch (wire?.Trim().ToUpperInvariant())
        {
            case "INSTITUTION": type = ScheduleOwnerType.Institution; return true;
            case "EXPERT": type = ScheduleOwnerType.Expert; return true;
            case "USER": type = ScheduleOwnerType.User; return true;
            case "SYSTEM_DEFAULT": type = ScheduleOwnerType.SystemDefault; return true;
            default: type = ScheduleOwnerType.User; return false;
        }
    }
}
