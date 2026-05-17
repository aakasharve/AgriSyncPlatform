// spec: voice-diary-e2e-2026-05-17 (B.9)

namespace ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;

/// <summary>
/// Wave 1.B — Voice Diary persist command. Fields mirror the Dexie
/// <c>voiceClips</c> row + the AES-GCM envelope produced by
/// <c>voiceEnvelope.seal()</c> on the frontend. ClipId is
/// CLIENT-SUPPLIED (Dexie PK) per supervisor risk #1.
/// </summary>
public sealed record PersistVoiceClipRetainedCommand(
    Guid ClipId,
    Guid UserId,
    DateTime RecordedAtUtc,
    string CipherBase64,
    string DekId,
    string IvBase64,
    string AuthTagBase64,
    int DurationSeconds,
    string Language);
