// spec: data-principle-spine-2026-05-05/08.1
//
// Sub-phase 08.1 — DPDP §12 erasure request aggregate. Self-serve or
// admin-on-behalf-of (OQ-2). Status FSM:
//   Requested → InProgress → Completed
//                       └→ Failed
//
// The aggregate is async-by-design (OQ-6 verdict — 48h SLA): the
// endpoint enqueues a row and returns 202 immediately. ErasureWorker
// (sub-phase 08.2) polls Requested rows, marks InProgress, runs the
// DS-017 5-rule ANONYMIZE manifest against the user's surviving farm
// data, then stamps Completed with row counts.
//
// Per DS-017 binding contract (2026-05-17): the worker does NOT
// hard-delete. It REPLACES user-id columns with
// SystemActor.ErasedFarmer and NULLs PII free-text — the request row
// itself carries the audit of what happened, plus per-row AuditEvent
// rows emitted via AuditEventFactory.
//
// RLS exemption: lives in ssf.erasure_requests; user-keyed not farm-
// keyed; admin-elevated read path via IAdminDbContextFactory. Allow-
// listed in RlsExemptionAllowlistTests.

namespace ShramSafal.Domain.Privacy;

public sealed class ErasureRequest
{
    public Guid Id { get; private set; }

    /// <summary>
    /// Who initiated the request. Self-serve flow: equals
    /// <see cref="OnBehalfOfUserId"/>'s value (or rather,
    /// <see cref="OnBehalfOfUserId"/> is null and this is the principal).
    /// Admin-on-behalf-of flow: admin's user id.
    /// </summary>
    public Guid RequestedByUserId { get; private set; }

    /// <summary>
    /// Null = self-serve (the requester IS the data principal).
    /// Non-null = admin acting on behalf of this principal (OQ-2).
    /// </summary>
    public Guid? OnBehalfOfUserId { get; private set; }

    public ErasureStatus Status { get; private set; }

    public DateTime RequestedAtUtc { get; private set; }

    public DateTime? CompletedAtUtc { get; private set; }

    /// <summary>
    /// Populated when <see cref="Status"/> reaches Completed. Counts the
    /// rows the worker anonymized across all tables in the manifest.
    /// </summary>
    public int? RowsAnonymizedCount { get; private set; }

    /// <summary>
    /// Non-null only when <see cref="Status"/> = Failed. Carries the
    /// reason for triage (short string; the AuditEvent payload carries
    /// the structured details).
    /// </summary>
    public string? FailureReason { get; private set; }

    private ErasureRequest()
    {
        // EF Core materialisation; do not call.
    }

    /// <summary>
    /// Submit a fresh erasure request. <paramref name="onBehalfOfUserId"/>
    /// is null for self-serve; non-null when an admin is requesting on
    /// behalf of a target user (OQ-2 admin-override flow).
    /// </summary>
    public static ErasureRequest Submit(
        Guid requestedByUserId,
        Guid? onBehalfOfUserId,
        DateTime nowUtc)
    {
        if (requestedByUserId == Guid.Empty)
        {
            throw new ArgumentException("requestedByUserId required", nameof(requestedByUserId));
        }

        if (onBehalfOfUserId is { } target && target == Guid.Empty)
        {
            throw new ArgumentException(
                "onBehalfOfUserId, when set, must be a non-empty Guid", nameof(onBehalfOfUserId));
        }

        return new ErasureRequest
        {
            Id = Guid.NewGuid(),
            RequestedByUserId = requestedByUserId,
            OnBehalfOfUserId = onBehalfOfUserId,
            Status = ErasureStatus.Requested,
            RequestedAtUtc = nowUtc,
            CompletedAtUtc = null,
            RowsAnonymizedCount = null,
            FailureReason = null,
        };
    }

    /// <summary>
    /// Convenience: the user whose data is being erased. For self-serve
    /// flows this equals <see cref="RequestedByUserId"/>; for admin-on-
    /// behalf-of flows this is <see cref="OnBehalfOfUserId"/>.
    /// </summary>
    public Guid TargetUserId => OnBehalfOfUserId ?? RequestedByUserId;

    public void MarkInProgress()
    {
        if (Status != ErasureStatus.Requested)
        {
            throw new InvalidOperationException(
                $"ErasureRequest {Id} cannot transition to InProgress from {Status}.");
        }
        Status = ErasureStatus.InProgress;
    }

    public void MarkCompleted(int rowsAnonymizedCount, DateTime nowUtc)
    {
        if (Status != ErasureStatus.InProgress)
        {
            throw new InvalidOperationException(
                $"ErasureRequest {Id} cannot transition to Completed from {Status}.");
        }
        if (rowsAnonymizedCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(rowsAnonymizedCount), rowsAnonymizedCount,
                "rowsAnonymizedCount must be >= 0");
        }
        Status = ErasureStatus.Completed;
        RowsAnonymizedCount = rowsAnonymizedCount;
        CompletedAtUtc = nowUtc;
    }

    public void MarkFailed(string reason, DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("reason required", nameof(reason));
        }
        Status = ErasureStatus.Failed;
        FailureReason = reason.Trim();
        CompletedAtUtc = nowUtc;
    }
}

/// <summary>
/// Phase 08 — DPDP §12 erasure request FSM. Linear progression
/// Requested → InProgress → Completed. Failed is a terminal sibling
/// of Completed reachable only from InProgress.
/// </summary>
public enum ErasureStatus
{
    Requested = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,
}
