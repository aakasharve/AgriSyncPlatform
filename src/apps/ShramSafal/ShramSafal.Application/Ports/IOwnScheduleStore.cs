using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Ports;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")

/// <summary>
/// The works of a farmer's own schedule while it is built (<c>ssf.own_schedule_items</c>) and their history (<c>ssf.own_schedule_item_revisions</c>). Shares the
/// request's unit of work: what is staged here is saved by the caller's one save, with the version and the place it may go with (one transaction).
/// A port of its own (like <see cref="IScheduleStepMoveStore"/>) so the 28 implementors of <see cref="IShramSafalRepository"/> are untouched (F7).
/// </summary>
public interface IOwnScheduleStore
{
    /// <summary>One work by id, TRACKED (the caller changes it), or null. Read under the request's farm scope.</summary>
    Task<OwnScheduleItem?> GetAsync(Guid itemId, CancellationToken ct = default);

    /// <summary>Every work of one plot-season (active and removed), TRACKED, by stage, order and key.</summary>
    Task<IReadOnlyList<OwnScheduleItem>> GetSeasonAsync(Guid plotId, Guid cropCycleId, CancellationToken ct = default);

    /// <summary>Every work of these farms (active and removed), NOT tracked: the pull's read, under the reader's user scope.</summary>
    Task<IReadOnlyList<OwnScheduleItem>> GetOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>Every revision of the works of these farms, NOT tracked, oldest first: the pull's read (the phone's copy of each work's history).</summary>
    Task<IReadOnlyList<OwnScheduleItemRevision>> GetRevisionsOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>The (plot, crop season) pairs of these farms that hold at least one ACTIVE work (the planning gate's fact, SM-7).</summary>
    Task<IReadOnlySet<(Guid PlotId, Guid CropCycleId)>> SeasonsWithWorkAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    void Stage(OwnScheduleItem item);

    void Stage(OwnScheduleItemRevision revision);

    /// <summary>The CURRENT origin of one own work (its latest take, the highest sequence), or null when the work was made by hand (slice 9).</summary>
    Task<OwnScheduleItemOrigin?> GetOriginAsync(Guid itemId, CancellationToken ct = default);

    /// <summary>Every origin row (every take) of the works of these farms, NOT tracked, oldest first; the current origin of a work is its highest sequence.</summary>
    Task<IReadOnlyList<OwnScheduleItemOrigin>> GetOriginsOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>Stages the origin of a work taken from a schedule (written once with the work, never changed).</summary>
    void Stage(OwnScheduleItemOrigin origin);

    /// <summary>Every season-end answer of one plot for the pair of seasons (slice 11), NOT tracked; empty = the review was never answered.</summary>
    Task<IReadOnlyList<OwnScheduleSeasonCarry>> GetCarriesAsync(Guid plotId, Guid fromCropCycleId, Guid cropCycleId, CancellationToken ct = default);

    /// <summary>Every season-end answer of these farms, NOT tracked: the pull's read.</summary>
    Task<IReadOnlyList<OwnScheduleSeasonCarry>> GetCarriesOfFarmsAsync(IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default);

    /// <summary>Stages one season-end answer (written once, never changed).</summary>
    void Stage(OwnScheduleSeasonCarry carry);
}
