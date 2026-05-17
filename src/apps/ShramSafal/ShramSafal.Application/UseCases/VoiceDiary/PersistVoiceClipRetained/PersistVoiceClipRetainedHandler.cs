// spec: voice-diary-e2e-2026-05-17 (B.9)
//
// Wave 1.B — handler for the Voice Diary persist surface. Flow:
//   1. Caller-shape validation (every field non-empty / non-default)
//   2. Consent gate via IConsentEnforcer (FullHistoryJournal must be
//      granted; on deny return ConsentRequired)
//   3. Build VoiceClipRetained aggregate (factory enforces invariants)
//   4. Persist via IRetainedBlobStore.PersistAsync (idempotent on
//      ClipId — Dexie PK reuse per supervisor risk #1)
//
// No outer SaveChangesAsync here; the adapter saves the unit of work
// itself because the S3 write + DB insert must succeed together or
// not at all.

using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;

public sealed class PersistVoiceClipRetainedHandler(
    IConsentEnforcer consentEnforcer,
    IRetainedBlobStore retainedBlobStore,
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

        return Result.Success(new PersistVoiceClipRetainedResult(persistedId));
    }
}
