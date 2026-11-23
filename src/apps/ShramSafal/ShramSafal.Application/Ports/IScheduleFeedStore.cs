using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन")

/// <summary>
/// The plans made from a farmer's own schedule (<c>ssf.planned_work</c> rows with an own work) and the answers about a work's sign
/// (<c>ssf.schedule_task_events</c>). Shares the request's unit of work: what is staged here is saved by the caller's one save. A port of its own, like
/// <see cref="IOwnScheduleStore"/>, so the implementors of <see cref="IShramSafalRepository"/> are untouched (F7).
/// </summary>
public interface IScheduleFeedStore
{
    /// <summary>Every plan made from these own works (every occurrence, open and closed), TRACKED, read under the request's farm scope.</summary>
    Task<IReadOnlyList<PlannedWork>> GetPlansOfItemsAsync(IReadOnlyCollection<Guid> ownItemIds, CancellationToken ct = default);

    /// <summary>The plans from the own schedule that link this daily log (on the task or on one of its plot rows), TRACKED.</summary>
    Task<IReadOnlyList<PlannedWork>> GetSchedulePlansLinkingLogAsync(Guid dailyLogId, CancellationToken ct = default);

    /// <summary>Every answer about the signs of one plot-season's own works, oldest first: the saved ones (NOT tracked) and the ones staged in this unit of work.</summary>
    Task<IReadOnlyList<ScheduleTaskEvent>> GetEventsAsync(Guid plotId, Guid cropCycleId, CancellationToken ct = default);

    /// <summary>One answer by its id, or null (a re-sent answer is the same answer).</summary>
    Task<ScheduleTaskEvent?> GetEventAsync(Guid eventId, CancellationToken ct = default);

    void Stage(ScheduleTaskEvent taskEvent);
}
