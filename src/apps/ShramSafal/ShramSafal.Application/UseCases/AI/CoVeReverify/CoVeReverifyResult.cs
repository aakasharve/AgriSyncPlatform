// spec: data-principle-spine-2026-05-05/05.1
//
// CoVe re-verification result. The score is the model's own confidence
// (0..1) clamped to that range; lowConfidence is a derived boolean using
// the same demotion threshold the old browser-side wrapper applied
// (CoVeWrapper.ts treats anything under 0.7 as low-confidence). When the
// score is below the threshold the handler also sets demotionReason so
// callers can surface a human-readable hint.

namespace ShramSafal.Application.UseCases.AI.CoVeReverify;

public sealed record CoVeReverifyResult(
    decimal VerificationScore,
    bool LowConfidence,
    string? DemotionReason);
