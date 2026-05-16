namespace ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

public sealed record GeneratePlanFromTemplateCommand(
    Guid ActorUserId,
    Guid CropCycleId,
    string TemplateName,
    string Stage,
    DateOnly PlanStartDate,
    IReadOnlyList<TemplateActivityInput> Activities,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // propagated to the chained ScheduleTestDueDatesCommand so the
    // TestInstance audit row inherits the same X-Device-Id / IP hash /
    // X-App-Version trio as the originating /plan/generate call. This
    // handler itself does not emit an AuditEvent today; the fields exist
    // solely for downstream propagation. Defaults match the worker /
    // unknown path so direct-construction unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

public sealed record TemplateActivityInput(string ActivityName, int OffsetDays);
