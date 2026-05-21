// spec: voice-diary-e2e-2026-05-17 (B.9)
//        + data-principle-spine-2026-05-05/phase-07-spine-hardening
//
// Wave 1.B — handler for the Voice Diary persist surface. Flow:
//   1. Caller-shape validation (every field non-empty / non-default)
//   2. Consent gate via IConsentEnforcer (FullHistoryJournal must be
//      granted; on deny return ConsentRequired)
//   3. Build VoiceClipRetained aggregate (factory enforces invariants)
//   4. Persist via IRetainedBlobStore.PersistAsync (idempotent on
//      ClipId — Dexie PK reuse per supervisor risk #1)
//   5. ADR-DS-009 audit-payload kid stamp (Phase 07): emit one
//      AuditEvent(entityType="VoiceClipRetained", action="Persisted")
//      carrying consentTokenKid in payload so DPDP §11 export can
//      prove which signed consent token authorized this persist.
//
// No outer SaveChangesAsync needed for the persist itself; the
// S3RetainedBlobStore adapter saves its own unit of work because the
// S3 write + DB insert must succeed together. The audit emission goes
// through IShramSafalRepository.AddAuditEventAsync + repository
// SaveChangesAsync so the audit row is committed in its own
// transaction AFTER the blob store call returns success.

using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;

public sealed class PersistVoiceClipRetainedHandler(
    IConsentEnforcer consentEnforcer,
    IRetainedBlobStore retainedBlobStore,
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<PersistVoiceClipRetainedResult>> HandleAsync(
        PersistVoiceClipRetainedCommand command,
        CancellationToken ct = default)
    {
        if (command.ClipId == Guid.Empty
            || command.UserId == Guid.Empty
            || command.RecordedAtUtc == default
            || string.IsNullOrWhiteSpace(command.CipherBase64)
            || string.IsNullOrWhiteSpace(command.DekId)
            || string.IsNullOrWhiteSpace(command.IvBase64)
            || string.IsNullOrWhiteSpace(command.AuthTagBase64)
            || command.DurationSeconds < 1
            || string.IsNullOrWhiteSpace(command.Language))
        {
            return Result.Failure<PersistVoiceClipRetainedResult>(ShramSafalErrors.InvalidCommand);
        }

        // RecordedAtUtc must arrive as UTC; the domain factory rejects
        // otherwise. Normalise here so wire-shaped DateTime kinds
        // (Unspecified from JSON deserialisation) don't trip the
        // invariant.
        var recordedAtUtc = DateTime.SpecifyKind(command.RecordedAtUtc, DateTimeKind.Utc);

        var decision = await consentEnforcer
            .RequireGrantAsync(command.UserId, ConsentPurpose.FullHistoryJournal, ct)
            .ConfigureAwait(false);
        if (!decision.IsAllowed)
        {
            return Result.Failure<PersistVoiceClipRetainedResult>(ShramSafalErrors.ConsentRequired);
        }

        byte[] cipher;
        try
        {
            cipher = Convert.FromBase64String(command.CipherBase64.Trim());
        }
        catch (FormatException)
        {
            return Result.Failure<PersistVoiceClipRetainedResult>(ShramSafalErrors.InvalidCommand);
        }

        if (cipher.Length == 0)
        {
            return Result.Failure<PersistVoiceClipRetainedResult>(ShramSafalErrors.InvalidCommand);
        }

        var s3Key = VoiceClipRetained.BuildS3Key(command.UserId, command.ClipId);
        var metadata = VoiceClipRetained.Create(
            clipId: command.ClipId,
            userId: command.UserId,
            recordedAtUtc: recordedAtUtc,
            s3Key: s3Key,
            dekId: command.DekId,
            ivBase64: command.IvBase64,
            authTagBase64: command.AuthTagBase64,
            durationSeconds: command.DurationSeconds,
            language: command.Language,
            // ConsentAuditId is reserved for a future enhancement —
            // wiring the most-recent grant audit row id here would
            // require a fresh repository read on every persist.
            // Phase 07 may surface this via a denormalised projection.
            consentAuditId: null,
            nowUtc: clock.UtcNow);

        var persistedId = await retainedBlobStore
            .PersistAsync(metadata, cipher, ct)
            .ConfigureAwait(false);

        // ADR-DS-009 audit-payload kid stamp (Phase 07 spine-hardening).
        // Re-read consent state to source CurrentTokenKid; the
        // IConsentEnforcer.RequireGrantAsync call above did not surface
        // it (returns ConsentDecision only). One extra read per
        // successful persist is acceptable — the persist path is
        // bounded by user-initiated voice clip count, not request fan-out.
        var consentState = await repository
            .GetUserConsentStateAsync(command.UserId, ct)
            .ConfigureAwait(false);

        var auditRow = AuditEventFactory.Create(
            entityType: "VoiceClipRetained",
            entityId: persistedId,
            action: "Persisted",
            actorUserId: command.UserId,
            actorRole: "operator",
            payload: new
            {
                consentTokenKid = consentState?.CurrentTokenKid, // ADR-DS-009 audit-payload kid stamp
                clipId = persistedId,
                userId = command.UserId,
                s3Key = metadata.S3Key,
                recordedAtUtc = recordedAtUtc,
                durationSeconds = command.DurationSeconds,
                language = command.Language,
            },
            farmId: null,
            clientCommandId: null,
            appVersion: AppVersionProvider.Current,
            deviceId: "voice-diary-persist",
            ipHash: "sha256:voice-diary-persist",
            sourceAiJobId: null);
        await repository.AddAuditEventAsync(auditRow, ct).ConfigureAwait(false);
        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new PersistVoiceClipRetainedResult(persistedId));
    }
}
