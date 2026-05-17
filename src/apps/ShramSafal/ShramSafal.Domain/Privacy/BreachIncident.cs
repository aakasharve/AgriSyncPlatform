// spec: data-principle-spine-2026-05-05/08.1
//
// Sub-phase 08.1 (+ 08.5 per OQ-5 scaffolding verdict) — DPDP §8(6)
// + 2025 Rules Rule 7 breach incident record. Phase 08 ships
// scaffolding only: ssf.breach_incidents + POST
// /shramsafal/admin/breach/report + LRP-tagged notification templates.
// No SendGrid wire — the worker stub logs "notification dispatch
// deferred to Phase 12+". Counsel finalizes templates before any
// production breach notification dispatch.
//
// Status FSM:
//   Open → BoardNotified → PrincipalsNotified → Closed
// (each step is monotonic; reverting is not modelled — once the
// dispatcher fires the timestamp is permanent for forensic audit).

namespace ShramSafal.Domain.Privacy;

public sealed class BreachIncident
{
    public Guid Id { get; private set; }

    public DateTime DetectedAt { get; private set; }

    public BreachSeverity Severity { get; private set; }

    /// <summary>
    /// Human-readable description of the scope of the breach (which
    /// surface, which class of data, time window). Free-text for the
    /// scaffolding phase; Phase 12+ may upgrade to a structured shape
    /// once incident response is wired.
    /// </summary>
    public string ScopeDescription { get; private set; } = string.Empty;

    public int AffectedUserCount { get; private set; }

    /// <summary>
    /// Stamped when the dispatcher (Phase 12+) successfully notifies
    /// the Data Protection Board. Null in Open status.
    /// </summary>
    public DateTime? BoardNotifiedAt { get; private set; }

    /// <summary>
    /// Stamped when the dispatcher (Phase 12+) successfully notifies
    /// all affected data principals. Null until then.
    /// </summary>
    public DateTime? PrincipalsNotifiedAt { get; private set; }

    public BreachIncidentStatus Status { get; private set; }

    private BreachIncident()
    {
        // EF Core materialisation; do not call.
    }

    public static BreachIncident Report(
        BreachSeverity severity,
        string scopeDescription,
        int affectedUserCount,
        DateTime detectedAt)
    {
        if (string.IsNullOrWhiteSpace(scopeDescription))
        {
            throw new ArgumentException("scopeDescription required", nameof(scopeDescription));
        }
        if (affectedUserCount < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(affectedUserCount), affectedUserCount,
                "affectedUserCount must be >= 0");
        }

        return new BreachIncident
        {
            Id = Guid.NewGuid(),
            DetectedAt = detectedAt,
            Severity = severity,
            ScopeDescription = scopeDescription.Trim(),
            AffectedUserCount = affectedUserCount,
            BoardNotifiedAt = null,
            PrincipalsNotifiedAt = null,
            Status = BreachIncidentStatus.Open,
        };
    }

    public void StampBoardNotified(DateTime nowUtc)
    {
        if (Status != BreachIncidentStatus.Open)
        {
            throw new InvalidOperationException(
                $"BreachIncident {Id} cannot stamp board-notified from status {Status}.");
        }
        BoardNotifiedAt = nowUtc;
        Status = BreachIncidentStatus.BoardNotified;
    }

    public void StampPrincipalsNotified(DateTime nowUtc)
    {
        if (Status != BreachIncidentStatus.BoardNotified)
        {
            throw new InvalidOperationException(
                $"BreachIncident {Id} cannot stamp principals-notified from status {Status}.");
        }
        PrincipalsNotifiedAt = nowUtc;
        Status = BreachIncidentStatus.PrincipalsNotified;
    }

    public void Close()
    {
        Status = BreachIncidentStatus.Closed;
    }
}

public enum BreachSeverity
{
    Low = 0,
    Medium = 1,
    High = 2,
    Critical = 3,
}

public enum BreachIncidentStatus
{
    Open = 0,
    BoardNotified = 1,
    PrincipalsNotified = 2,
    Closed = 3,
}
