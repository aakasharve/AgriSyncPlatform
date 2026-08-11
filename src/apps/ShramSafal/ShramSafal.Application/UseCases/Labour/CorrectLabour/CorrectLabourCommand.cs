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
    IReadOnlyList<Guid>? AttributionRemovals);

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
