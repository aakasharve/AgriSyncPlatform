using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

public sealed record CreateDailyLogCommand(
    Guid FarmId,
    // LABOUR_PHASE2 P2.2 — nullable IN PLACE rather than appended, because a
    // `MultiPlot` or `Farm` log genuinely has neither. Widening a positional
    // parameter from Guid to Guid? is source-compatible (every existing caller
    // still passes a Guid, which converts implicitly), so no call site moves.
    // NULL here means "the farmer named no single plot" — it is never a stand-in
    // for one, and nothing downstream may substitute Guid.Empty for it (P4).
    Guid? PlotId,
    Guid? CropCycleId,
    Guid RequestedByUserId,
    Guid OperatorUserId,
    DateOnly LogDate,
    LocationSnapshot? Location,
    string? DeviceId,
    string? ClientRequestId,
    Guid? DailyLogId = null,
    string? ActorRole = null,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — when the farmer Confirms a voice
    // draft, the frontend passes back the AiJob.Id of the original parse so
    // the resulting DailyLog can stamp Provenance(Source.Voice, ...) lifted
    // from that job. Null means a true manual log; the handler falls back to
    // Provenance.Manual(ClientAppVersion).
    Guid? SourceAiJobId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — client app version sourced from
    // the X-App-Version header at the endpoint (fallback "unknown"). Always
    // stamped onto the resulting Provenance.AppVersion.
    string ClientAppVersion = "unknown",
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims()).
    // Distinct from the legacy nullable DeviceId above, which participates
    // only in the idempotency key. AuditDeviceId / AuditIpHash carry the
    // X-Device-Id header + salted remote-IP hash for the audit row's
    // DeviceId / IpHash columns. Default sentinels match the worker /
    // unknown path so direct-construction unit tests stay green.
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // Track B B2.8 — optional weather snapshot captured on the client at log
    // time. Persisted to ssf.weather_stamps by CreateDailyLogHandler on a
    // NON-BLOCKING best-effort basis (a bad/missing stamp never rejects the
    // log). Added at the END so existing callers/tests compile unchanged.
    WeatherStampItem? WeatherStamp = null,
    // Labour V1 Task 5 — structured manual labour entries carried on the
    // create_daily_log mutation. Transport only: nothing in this task
    // persists them (Task 6 adds the write path via LabourAssignmentFactory).
    // Added at the END, after WeatherStamp, so existing positional
    // construction keeps compiling.
    IReadOnlyList<LabourItem>? Labour = null,
    // LABOUR_PHASE2 P2.2 — what the farmer asserted about WHERE the work
    // happened. Added at the END with a default, after Labour, so existing
    // positional construction keeps compiling and keeps meaning exactly what it
    // meant before: DailyLogScope.Plot, the Labour V1 shape.
    //
    // The default is safe precisely BECAUSE it is the restrictive value — a
    // caller who says nothing gets the plot-scoped path, which still demands a
    // real PlotId and a real CropCycleId. There is no default that could
    // accidentally produce a farm-wide log.
    DailyLogScope Scope = DailyLogScope.Plot,
    // The canonical spatial set. NULL means "not supplied": for Scope.Plot the
    // handler derives it from PlotId, so no existing caller has to change. For
    // Scope.MultiPlot it must carry two or more distinct real plots; for
    // Scope.Farm it must be absent or empty.
    IReadOnlyList<Guid>? PlotIds = null)
{
    public string? IdempotencyKey
    {
        get
        {
            if (string.IsNullOrWhiteSpace(ClientRequestId))
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(DeviceId))
            {
                return ClientRequestId.Trim();
            }

            return $"{DeviceId.Trim()}:{ClientRequestId.Trim()}";
        }
    }
}
