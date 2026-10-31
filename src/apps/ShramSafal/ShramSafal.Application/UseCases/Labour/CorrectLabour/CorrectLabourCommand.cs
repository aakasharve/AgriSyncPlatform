using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.CorrectLabour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b) —
/// ONE review action on ONE engagement. It may change any combination of the
/// three correctable things and nothing else: labour quantity, duration, worker
/// attribution.
///
/// <para><b>Every correctable section is OPTIONAL, and absent means SILENT.</b>
/// A reviewer who says nothing about hours leaves <see cref="DurationHours"/>
/// null, and the engagement's existing <c>Assumed</c> duration is then left
/// exactly as it was — no correction row, no overwrite. Silence is not a
/// correction. The same applies to <see cref="Quantity"/> and to both
/// attribution lists.</para>
/// </summary>
/// <param name="DeviceId">
/// From the caller's <c>X-Device-Id</c> header. Half of the idempotency key —
/// see <c>CorrectLabourHandler</c>.
/// </param>
/// <param name="ClientRequestId">
/// Client-minted, stable across retries. The other half of the idempotency key.
/// REQUIRED: without it a retried correction would write a second set of
/// <c>labour_corrections</c> rows for one real review action.
/// </param>
public sealed record CorrectLabourCommand(
    FarmId FarmId,
    Guid LabourAssignmentId,
    UserId CallerUserId,
    string DeviceId,
    string ClientRequestId,
    string? Reason,
    LabourQuantityCorrection? Quantity,
    decimal? DurationHours,
    IReadOnlyList<Guid>? AttributionAdds,
    IReadOnlyList<Guid>? AttributionRemovals)
{
    /// <summary>
    /// spec: plr-d10 (lane OF-S) — the record the caller believes this engagement belongs to. When stated, an
    /// engagement on any other log is refused (<c>Forbidden</c>), exactly like one on another farm. Null (every
    /// caller before lane OF-S) = not checked.
    /// </summary>
    public Guid? DailyLogId { get; init; }

    /// <summary>
    /// spec: plr-d10 (lane OF-S) — what the reviewer SAW before changing it. When stated, a correction whose section
    /// no longer matches the engagement (someone corrected it meanwhile) is refused as stale, never written over the
    /// newer correction. Null (every installed phone's online POST) = not checked, exactly as before (P11).
    /// </summary>
    public LabourCorrectionSeen? Seen { get; init; }

    /// <summary>
    /// spec: plr-d10 (lane OF-S) — <c>true</c> when the CALLER owns the (device, request) idempotency key: the queued
    /// path, where <c>/sync/push</c> dedupes every mutation and stores the key in the same transaction. The handler
    /// then neither replays nor stores its own key (two owners would burn two keys for one action) and saves its
    /// changes itself. <c>false</c> (the online route) = the handler's own replay + store, unchanged.
    /// </summary>
    public bool IdempotencyStoredByCaller { get; init; }
}

/// <summary>
/// spec: plr-d10 (lane OF-S) — the engagement's values as the reviewer's phone showed them before his change. Each is
/// optional: a value his phone did not know is left out and not compared (never guessed).
/// </summary>
public sealed record LabourCorrectionSeen(int? WorkerCount, int? MaleCount, int? FemaleCount, decimal? DurationHours);

/// <summary>
/// The three headcount numbers TOGETHER (Task 12b.2). They travel as one value
/// because they are one fact: applying them separately is what lets a row land
/// contradictory, e.g. <c>WorkerCount=6, Male=5, Female=4</c>.
///
/// <para>Each number is individually nullable, and null here means "not stated"
/// — preserved as NULL on the row rather than fabricated as 0 (P4). Sending the
/// section at all is the reviewer asserting the headcount; omitting the whole
/// section is saying nothing about it.</para>
/// </summary>
public sealed record LabourQuantityCorrection(int? WorkerCount, int? MaleCount, int? FemaleCount);
