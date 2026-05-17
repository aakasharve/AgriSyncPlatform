// spec: voice-diary-e2e-2026-05-17 (B.10)

using ShramSafal.Application.Privacy.Ports;

namespace ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;

/// <summary>
/// Wave 1.B — result wrapping the projected list-items the frontend
/// renders in the Voice Diary calendar. Ciphertext bytes are NOT
/// included; the client fetches them on demand via /by-id when the
/// user taps play.
/// </summary>
public sealed record GetVoiceDiaryByRangeResult(
    IReadOnlyList<VoiceClipRetainedListItem> Clips);
