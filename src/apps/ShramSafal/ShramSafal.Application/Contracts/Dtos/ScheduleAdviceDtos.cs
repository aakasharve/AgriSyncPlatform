namespace ShramSafal.Application.Contracts.Dtos;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV; founder D-74 note, D-87 = 1, D-83 = 1, D-24d; R10, R12, R28; P4)

/// <summary>
/// What the schedules a plot follows ask for ONE work in the stage that holds a day, read while he plans that work. It reads schedules
/// only - never a record - and holds no quantity and no dose (a schedule stores none, P4); nothing in it is ever copied into the task
/// (D-24d). <see cref="NeedsSchedule"/> true = he must choose a schedule first (D-83 = 1): no lines. <see cref="NotRecognised"/> true =
/// his words name no work (R12): no lines, never a guess. <see cref="Part"/> (<c>irrigation | nutrition | spray | work</c>) and
/// <see cref="OperationKey"/> are the work the words were read as. <see cref="Stage"/> is the stage panel's window; <see cref="Lines"/>
/// are the panel's order (slots 1, 2, 3, his own last), one per followed schedule - none while there is no stage to speak of (P4: no
/// invented stage).
/// </summary>
public sealed record ScheduleAdviceDto(
    DateTime ServerTimeUtc,
    bool NeedsSchedule,
    bool NotRecognised,
    string? Part,
    string? OperationKey,
    StagePlanWindowDto? Stage,
    IReadOnlyList<ScheduleAdviceLineDto> Lines);

/// <summary>
/// One followed schedule. <see cref="Items"/> are the stage panel's own items (the same count, the same days) of THIS work only;
/// <see cref="NothingInStage"/> is true when the schedule asks no such work in the stage. <see cref="Slot"/> and <see cref="Check"/>
/// are the panel's: a null slot is never shown as a place it does not hold, his own has no check (D-82 = 3).
/// </summary>
public sealed record ScheduleAdviceLineDto(
    Guid SubscriptionId,
    string ScheduleName,
    short? Slot,
    string Origin,
    ScheduleCheckDto? Check,
    IReadOnlyList<StagePlanItemDto> Items,
    bool NothingInStage);
