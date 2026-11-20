namespace ShramSafal.Domain.ControlRoom;

/// <summary>
/// A starting role: it only pre-fills the per-person ticks. The founder is never a starting role.
/// Unrelated to the Labour field-operator entity.
/// </summary>
public enum ControlRoomRole
{
    Admin,
    FieldOperator,
    Viewer
}

public static class ControlRoomRoles
{
    public static string Key(ControlRoomRole role) => role switch
    {
        ControlRoomRole.Admin => "admin",
        ControlRoomRole.FieldOperator => "field_operator",
        ControlRoomRole.Viewer => "viewer",
        _ => throw new ArgumentOutOfRangeException(nameof(role), role, "Unknown control-room role.")
    };

    /// <summary>Lower-case keys only; "founder", "Admin" and anything else do not parse.</summary>
    public static bool TryParse(string? key, out ControlRoomRole role)
    {
        switch (key)
        {
            case "admin": role = ControlRoomRole.Admin; return true;
            case "field_operator": role = ControlRoomRole.FieldOperator; return true;
            case "viewer": role = ControlRoomRole.Viewer; return true;
            default: role = default; return false;
        }
    }

    public static IReadOnlyList<string> PresetTicks(ControlRoomRole role) => role switch
    {
        ControlRoomRole.Admin =>
        [
            ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth, ControlRoomTicks.ApiErrors,
            ControlRoomTicks.AllFarms, ControlRoomTicks.FarmsToCall, ControlRoomTicks.FarmerHealth,
            ControlRoomTicks.Schedules, ControlRoomTicks.Users,
            ControlRoomTicks.FarmerPhones, ControlRoomTicks.Downloads, ControlRoomTicks.GiveVisits
        ],
        // H13: the phone tick is pre-filled on purpose, so the founder ticks it knowingly.
        ControlRoomRole.FieldOperator =>
        [
            ControlRoomTicks.MyVisits, ControlRoomTicks.FarmerPhones, ControlRoomTicks.Downloads
        ],
        ControlRoomRole.Viewer =>
        [
            ControlRoomTicks.CompanyNumbers, ControlRoomTicks.ServerHealth
        ],
        _ => throw new ArgumentOutOfRangeException(nameof(role), role, "Unknown control-room role.")
    };
}
