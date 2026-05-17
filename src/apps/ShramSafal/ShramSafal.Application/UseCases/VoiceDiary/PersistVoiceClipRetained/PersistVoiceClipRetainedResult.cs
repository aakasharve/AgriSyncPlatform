// spec: voice-diary-e2e-2026-05-17 (B.9)

namespace ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;

/// <summary>
/// Wave 1.B — Voice Diary persist result. Returns the persisted clip
/// id (echoes the client-supplied PK so the frontend can confirm).
/// </summary>
public sealed record PersistVoiceClipRetainedResult(Guid ClipId);
