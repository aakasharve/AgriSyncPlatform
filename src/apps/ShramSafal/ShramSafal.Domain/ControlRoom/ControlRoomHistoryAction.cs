namespace ShramSafal.Domain.ControlRoom;

/// <summary>
/// History row names for the control room (spec: trusted-control-room-2026-11-20). History is <c>ssf.audit_events</c>:
/// <c>entity_type = "control_room"</c>, <c>actor_role = "control_room"</c>.
/// </summary>
public static class ControlRoomHistoryAction
{
    public const string EntityType = "control_room";
    public const string ActorRole = "control_room";

    public const string PersonAdded = "person_added";
    public const string PersonChanged = "person_changed";
    public const string PersonRemoved = "person_removed";
    public const string PersonKept = "person_kept";
    public const string SeatBound = "seat_bound";
    public const string DoorRefused = "door_refused";
    public const string CodeNotSent = "code_not_sent";
    public const string SignedIn = "signed_in";
    public const string PhonesShown = "phones_shown";
    public const string VisitsGiven = "visits_given";
    public const string VisitDone = "visit_done";
    public const string DaySheetDownloaded = "day_sheet_downloaded";
    public const string DaySheetPrinted = "day_sheet_printed";
}
