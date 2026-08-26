// spec: data-principle-spine-2026-05-05/08.1
//
// Sub-phase 08.1 — DPDP §12 erasure request aggregate. Self-serve or
// admin-on-behalf-of (OQ-2). Status FSM:
//   Requested → InProgress → Completed
//                       ├→ CompletedWithResidue
//                       └→ Failed
//
// CompletedWithResidue: the database manifest ran and the row count is
// real, but a named part of the erasure did not happen (today: the
// retained voice clips are still in S3). It is NOT Completed, which
// would falsely claim a clean erasure, and NOT Failed, which would
// falsely claim nothing happened after nine tables were scrubbed.
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
    /// Populated when <see cref="Status"/> reaches <see cref="ErasureStatus.Completed"/>
    /// OR <see cref="ErasureStatus.CompletedWithResidue"/> — the count is just
    /// as real in the residue case, which is the whole point of that state.
    /// Counts the rows the worker anonymized across all tables in the manifest.
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

    /// <summary>
    /// The DPDP §12 database manifest ran to completion, but a named part of
    /// the erasure did NOT — today, deletion of the retained voice clips from
    /// S3. The rows are scrubbed and the count is real; something the farmer
    /// asked to have removed still exists.
    ///
    /// <para>
    /// <b>Why this is not <see cref="MarkCompleted"/>.</b> Calling that would
    /// tell an auditor the erasure finished cleanly when raw audio survives —
    /// a false claim about a data-subject right.
    /// </para>
    ///
    /// <para>
    /// <b>Why this is not <see cref="MarkFailed"/>.</b> That is what the worker
    /// used to do, and it is the defect this method exists to remove. Nine
    /// tables are irreversibly scrubbed by this point. Stamping the request
    /// <c>Failed</c> tells a support person nothing happened, so they truthfully
    /// but wrongly tell the farmer their deletion did not go through — and a
    /// retry would report SMALLER numbers than the truth, because the rows it
    /// would count are already gone.
    /// </para>
    ///
    /// <para>
    /// The specifics of what remains live in the audit event for this request —
    /// <c>entity_type = 'ErasureRequest'</c> with
    /// <c>action = 'CompletedWithResidue'</c>. NOTE the action mirrors the
    /// status: a clean run writes <c>'Completed'</c>, this one does not. Query
    /// on <c>entity_id = &lt;requestId&gt;</c> rather than on the action, or a
    /// handler sent to <c>action = 'Completed'</c> will find nothing for exactly
    /// the requests that need looking at.
    /// </para>
    /// </summary>
    public void MarkCompletedWithResidue(int rowsAnonymizedCount, DateTime nowUtc)
    {
        if (Status != ErasureStatus.InProgress)
        {
            throw new InvalidOperationException(
                $"ErasureRequest {Id} cannot transition to CompletedWithResidue from {Status}.");
        }
        if (rowsAnonymizedCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(rowsAnonymizedCount), rowsAnonymizedCount,
                "rowsAnonymizedCount must be >= 0");
        }
        Status = ErasureStatus.CompletedWithResidue;
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
/// Requested → InProgress → Completed. Failed and CompletedWithResidue are
/// terminal siblings of Completed, both reachable only from InProgress.
///
/// <para>
/// <b>Read the three terminal states as answers to "what is actually gone?"</b>
/// <c>Completed</c> — everything in the manifest. <c>CompletedWithResidue</c> —
/// the database scrub, but a named part survives. <c>Failed</c> — the scrub
/// itself did not complete.
/// </para>
///
/// <para>
/// Persisted as <c>integer</c> with no CHECK constraint
/// (<c>ssf.erasure_requests.status</c>), so adding a member needs no migration.
/// Every BACKEND comparison is <c>== Completed</c> / <c>== Requested</c> /
/// <c>!= Failed</c>, and a value of 4 is correctly NOT treated as clean
/// completion by any of them.
/// </para>
///
/// <para>
/// <b>One frontend consumer IS exhaustive — do not repeat the earlier claim
/// that nothing is.</b>
/// <c>src/clients/mobile-web/src/features/dataRights/RecentRequestsList.tsx:18</c>
/// declares a closed union of the original four names and switches on it with
/// no <c>default</c>, so an unmapped value renders <c>undefined</c>. It is
/// dormant today — no listing endpoint feeds it and the component is imported
/// nowhere — which is why adding the member here was still safe. Anyone wiring
/// that component up must widen the union first. Frontend is owned by another
/// lane, so this is recorded, not fixed.
/// </para>
/// </summary>
public enum ErasureStatus
{
    Requested = 0,
    InProgress = 1,
    Completed = 2,
    Failed = 3,

    /// <summary>
    /// The database manifest completed and <see cref="ErasureRequest.RowsAnonymizedCount"/>
    /// is real, but something the farmer asked to have removed still exists —
    /// currently: retained voice clips that were neither deleted from S3 nor,
    /// in the no-bucket case, even attempted.
    ///
    /// <para>
    /// For what and why, read the audit event for this request:
    /// <c>entity_type = 'ErasureRequest'</c> AND
    /// <c>entity_id = &lt;requestId&gt;</c>. Query on the id, NOT on the action —
    /// a request in this state writes <c>action = 'CompletedWithResidue'</c>,
    /// so anyone filtering on <c>'Completed'</c> finds nothing for exactly the
    /// requests that need looking at. The payload's <c>retainedVoiceOutcome</c>
    /// and <c>retainedVoiceResidue</c> carry the cause.
    /// </para>
    /// </summary>
    CompletedWithResidue = 4,
}
