// spec: voice-diary-e2e-2026-05-17 (B.10)

namespace ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;

/// <summary>
/// Wave 1.B — list retained voice clips in [From, To] for
/// <see cref="UserId"/>. Caller userId is the authoritative scope —
/// the handler does NOT cross-check farm membership because retained
/// clips are user-keyed (mirrors UserConsentState's user-keyed shape).
/// </summary>
public sealed record GetVoiceDiaryByRangeQuery(
    Guid UserId,
    DateOnly From,
    DateOnly To);
