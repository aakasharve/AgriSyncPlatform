using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

public sealed record VerifyLogCommand(
    Guid DailyLogId,
    VerificationStatus TargetStatus,
    string? Reason,
    Guid VerifiedByUserId,
    Guid? VerificationEventId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
    // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I27; founder D-44, D-46) — how the
    // confirmer reviewed the record (ReviewBasis.Heard / ReviewBasis.Read; null = not stated,
    // every older phone) and the record version he saw (null = not stated: the version current
    // when the server accepts it is recorded). Added LAST with defaults (P11).
    string? ReviewBasis = null,
    int? ExpectedLogVersion = null,
    // spec: plr-d10 (I27) — true when the request came as verify_log_v2 WITHOUT a review basis:
    // the shape of the I13 result screen's "पक्कं आहे". From the record's own speaker that tap
    // meant "I confirm my own words" (I13); D-44 changed the meaning, so it is kept as his mark.
    // Every build from I27 on states the basis on a confirmation. False on every other path.
    bool ReviewBasisOmittedOnV2 = false);
