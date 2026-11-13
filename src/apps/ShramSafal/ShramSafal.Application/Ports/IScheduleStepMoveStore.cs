using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29). The moves of followed-schedule steps ("पुढे ठरवा"):
/// <c>ssf.schedule_step_moves</c>, append-only. A separate port (not <see cref="IShramSafalRepository"/>) so no existing fake of the
/// big repository changes; the Infrastructure store shares the repository's DbContext, so a staged move is saved by the caller's one
/// <see cref="IShramSafalRepository.SaveChangesAsync"/> together with its audit row.
/// </summary>
public interface IScheduleStepMoveStore
{
    /// <summary>Stages one new move row. Never an update, never a delete; the caller saves.</summary>
    void Stage(ScheduleStepMove move);

    /// <summary>Every move (history included) of the given subscriptions, oldest first. One read, whatever the number of subscriptions.</summary>
    Task<IReadOnlyList<ScheduleStepMove>> GetForSubscriptionsAsync(
        IReadOnlyCollection<Guid> subscriptionIds, CancellationToken ct = default);
}
