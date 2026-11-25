using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice")

/// <summary>
/// The owner's messages (<c>ssf.schedule_owner_messages</c>), their clips' metadata (<c>ssf.schedule_owner_clips</c>) and what a farm's plots did with them
/// (<c>ssf.schedule_owner_message_states</c>). Shares the request's unit of work: what is staged here is saved by the caller's one save. A port of its own, like
/// <see cref="IOwnScheduleStore"/>, so the implementors of <see cref="IShramSafalRepository"/> are untouched (F7). Every read is under the request's row security: under a farm's
/// scope a message of a schedule the farm does not follow is simply not there.
/// </summary>
public interface IOwnerVoiceStore
{
    /// <summary>One message by id, or null (also when row security hides it).</summary>
    Task<ScheduleOwnerMessage?> GetMessageAsync(Guid messageId, CancellationToken ct = default);

    /// <summary>One clip's metadata by id, or null (also when row security hides it).</summary>
    Task<ScheduleOwnerClip?> GetClipAsync(Guid clipId, CancellationToken ct = default);

    /// <summary>Every message of one schedule version's chain that the current scope sees, oldest first (the staff list), NOT tracked.</summary>
    Task<IReadOnlyList<ScheduleOwnerMessage>> GetMessagesOfChainAsync(Guid chainId, CancellationToken ct = default);

    /// <summary>The clips of these messages, NOT tracked.</summary>
    Task<IReadOnlyList<ScheduleOwnerClip>> GetClipsAsync(IReadOnlyCollection<Guid> clipIds, CancellationToken ct = default);

    /// <summary>
    /// Every message of a schedule that one of these farms follows (an Active choice of one of its plots) or owns a copy from (an own work with an origin in that schedule's chain),
    /// oldest first, NOT tracked: the pull's read.
    /// </summary>
    Task<IReadOnlyList<ScheduleOwnerMessage>> GetMessagesForFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>Every state row of these farms, NOT tracked, oldest first: the pull's read.</summary>
    Task<IReadOnlyList<ScheduleOwnerMessageState>> GetStatesOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>The state rows of one message on one plot (saved and staged), oldest first.</summary>
    Task<IReadOnlyList<ScheduleOwnerMessageState>> GetStatesAsync(Guid plotId, Guid messageId, CancellationToken ct = default);

    /// <summary>
    /// Does this plot (in this crop season, when given) follow a schedule of <paramref name="chainId"/> (an Active choice), or own a copy of one of its works (an own work whose
    /// current origin is in that chain)?
    /// </summary>
    Task<bool> FollowsChainAsync(Guid farmId, Guid plotId, Guid? cropCycleId, Guid chainId, CancellationToken ct = default);

    /// <summary>One revision of an own work by its number, NOT tracked, or null.</summary>
    Task<OwnScheduleItemRevision?> GetRevisionAsync(Guid itemId, int revisionNumber, CancellationToken ct = default);

    void Stage(ScheduleOwnerClip clip);

    void Stage(ScheduleOwnerMessage message);

    void Stage(ScheduleOwnerMessageState state);
}
