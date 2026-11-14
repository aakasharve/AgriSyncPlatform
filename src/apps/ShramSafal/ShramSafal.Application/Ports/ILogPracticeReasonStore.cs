using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2). The reasons kept on records of work:
/// <c>ssf.log_practice_reasons</c>, append-only. A separate port (not <see cref="IShramSafalRepository"/>) so no existing fake of the big
/// repository changes; the Infrastructure store shares the repository's DbContext, so a staged reason is committed by the caller's one
/// <see cref="IShramSafalRepository.SaveChangesAsync"/> together with its audit row.
/// </summary>
public interface ILogPracticeReasonStore
{
    /// <summary>Stages one new reason row. Never an update, never a delete; the caller saves.</summary>
    void Stage(LogPracticeReason reason);

    /// <summary>The reason with this id (under the farm's own scope: another farm's id is not found), or null.</summary>
    Task<LogPracticeReason?> GetByIdAsync(Guid reasonId, CancellationToken ct = default);

    /// <summary>The latest reason of one item of one record (the one a new reason supersedes), or null when it has none.</summary>
    Task<LogPracticeReason?> GetLatestAsync(Guid dailyLogId, string workKey, CancellationToken ct = default);

    /// <summary>
    /// The LATEST reason of every item of the given records (history is never read here), in ONE read whatever the number of records or of earlier
    /// reasons: newest created_at_utc, then the larger id (the same rule a new reason supersedes by).
    /// </summary>
    Task<IReadOnlyList<LogPracticeReason>> GetForLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default);
}
