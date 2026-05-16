namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

public sealed record CreateAttachmentCommand(
    Guid FarmId,
    Guid LinkedEntityId,
    string LinkedEntityType,
    string FileName,
    string MimeType,
    Guid CreatedByUserId,
    Guid? AttachmentId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
    // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
