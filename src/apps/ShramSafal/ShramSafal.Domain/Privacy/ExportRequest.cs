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

    /// <summary>
    /// Marker a download URL must carry to be accepted here. AWS SigV4 names the
    /// signature <c>X-Amz-Signature</c>; SigV2 named it <c>Signature</c>. Either
    /// proves the URL was minted by something holding credentials.
    /// </summary>
    private static readonly string[] SignatureQueryParameters =
    [
        "X-Amz-Signature=",
        "Signature=",
    ];

    /// <summary>
    /// Complete the request with a download URL that actually carries authority.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this guards more than emptiness.</b> This method used to accept any
    /// non-blank string. That checked the <i>shape</i> of a value whose entire
    /// purpose is to carry <i>authority</i>, and the worker duly handed it a
    /// hand-concatenated URL with no signature and no credential, against a
    /// bucket that does not exist. A 404 was recorded as the download link for a
    /// complete DPDP personal-data export, and every layer above reported the
    /// export as delivered.
    /// </para>
    /// <para>
    /// An unsigned URL is not a weaker link — against a private bucket it is not
    /// a link at all. So it is refused here rather than persisted: a request that
    /// cannot hand the data principal their data must say so
    /// (<see cref="MarkFailed"/>), not record a dead address and call itself
    /// Completed.
    /// </para>
    /// </remarks>
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

        var candidate = presignedUrl.Trim();

        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps)
        {
            throw new ArgumentException(
                "presignedUrl must be an absolute https URL — a personal-data export link is "
                + "never served over anything else.",
                nameof(presignedUrl));
        }

        var query = uri.Query;
        var carriesSignature = SignatureQueryParameters.Any(
            marker => query.Contains(marker, StringComparison.Ordinal));

        if (!carriesSignature)
        {
            throw new ArgumentException(
                "presignedUrl carries no signature, so it grants no access to the export bundle. "
                + "Refusing to record an unsigned URL as a working download link — mark the "
                + "request Failed with the reason instead.",
                nameof(presignedUrl));
        }

        Status = ExportRequestStatus.Completed;
        PresignedUrl = candidate;
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
