namespace ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;

// spec: dfes-companion-2026-07-11 (Slice 3a). Per-day read of the active farm's
// Day Understanding Score. LocalDate is the farm-local calendar day the caller
// wants (the endpoint defaults it to farm-local today). CallerUserId scopes the
// membership check so no cross-farm read leaks.
public sealed record GetDayUnderstandingQuery(Guid FarmId, DateOnly LocalDate, Guid CallerUserId);
