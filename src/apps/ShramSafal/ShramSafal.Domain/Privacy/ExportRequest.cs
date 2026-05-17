// spec: data-principle-spine-2026-05-05/08.1
//
// Sub-phase 08.1 — DPDP §11 (right to access) + §11(1)(c) (portability)
// export request aggregate. Symmetric with ErasureRequest (OQ-9 verdict
// — async + presigned URL). Status FSM:
//   Requested → InProgress → Completed
//                        └→ Failed
//
// On Completed, PresignedUrl + ExpiresAtUtc are populated. The URL is
// a 24h TTL pre-signed S3 link the user can use to download the ZIP
// bundle assembled by ExportWorker per the OQ-3 manifest:
//   /voice/, /transcripts/, /parsed/, /consent_audit.json,
//   /audit_events.json, /cross_border_transfers.json,
//   /dpa_registry.json, /README.md (LRP-tagged).

namespace ShramSafal.Domain.Privacy;

public sealed class ExportRequest
{
    public Guid Id { get; private set; }

    public Guid RequestedByUserId { get; private set; }

    /// <summary>
    /// Phase 08 self-serve only at the §11 access flow — admins do not
    /// initiate exports on behalf of a user (export goes back to the
    /// user, not the admin). Reserved for symmetry with ErasureRequest;
    /// today it is always null in production code paths.
    /// </summary>
    public Guid? OnBehalfOfUserId { get; private set; }

    public ExportRequestStatus Status { get; private set; }

    public DateTime RequestedAtUtc { get; private set; }

    public DateTime? CompletedAtUtc { get; private set; }

    /// <summary>
    /// Presigned download URL for the assembled ZIP, populated when
    /// <see cref="Status"/> reaches Completed. Null until then; null
    /// permanently when <see cref="Status"/> = Failed.
    /// </summary>
    public string? PresignedUrl { get; private set; }

    /// <summary>
    /// Expiry of <see cref="PresignedUrl"/>. 24h TTL per OQ-9 verdict.
    /// </summary>
    public DateTime? ExpiresAtUtc { get; private set; }

    public string? FailureReason { get; private set; }

    private ExportRequest()
    {
        // EF Core materialisation; do not call.
    }

    public static ExportRequest Submit(
        Guid requestedByUserId,
        DateTime nowUtc)
    {
        if (requestedByUserId == Guid.Empty)
        {
            throw new ArgumentException("requestedByUserId required", nameof(requestedByUserId));
        }

        return new ExportRequest
        {
            Id = Guid.NewGuid(),
            RequestedByUserId = requestedByUserId,
            OnBehalfOfUserId = null,
            Status = ExportRequestStatus.Requested,
            RequestedAtUtc = nowUtc,
            CompletedAtUtc = null,
            PresignedUrl = null,
            ExpiresAtUtc = null,
            FailureReason = null,
        };
    }

    public Guid TargetUserId => OnBehalfOfUserId ?? RequestedByUserId;

    public void MarkInProgress()
    {
        if (Status != ExportRequestStatus.Requested)
        {
            throw new InvalidOperationException(
                $"ExportRequest {Id} cannot transition to InProgress from {Status}.");
        }
        Status = ExportRequestStatus.InProgress;
    }

    public void MarkCompleted(string presignedUrl, DateTime expiresAtUtc, DateTime nowUtc)
    {
        if (Status != ExportRequestStatus.InProgress)
        {
            throw new InvalidOperationException(
                $"ExportRequest {Id} cannot transition to Completed from {Status}.");
        }
        if (string.IsNullOrWhiteSpace(presignedUrl))
        {
            throw new ArgumentException("presignedUrl required", nameof(presignedUrl));
        }
        Status = ExportRequestStatus.Completed;
        PresignedUrl = presignedUrl.Trim();
        ExpiresAtUtc = expiresAtUtc;
        CompletedAtUtc = nowUtc;
    }

    public void MarkFailed(string reason, DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("reason required", nameof(reason));
        }
        Status = ExportRequestStatus.Failed;
        FailureReason = reason.Trim();
        CompletedAtUtc = nowUtc;
    }
}

public enum ExportRequestStatus
{
    Requested = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,
}
