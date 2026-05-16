using ShramSafal.Domain.Location;

namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

public sealed record CreateDailyLogCommand(
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
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
    string AuditIpHash = "sha256:unknown")
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
