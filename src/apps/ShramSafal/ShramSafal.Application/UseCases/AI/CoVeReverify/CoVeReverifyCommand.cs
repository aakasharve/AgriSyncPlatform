// spec: data-principle-spine-2026-05-05/05.1
//
// Sub-phase 05.1.2 — server-side CoVe re-verification.
// The frontend used to re-query Gemini directly to score a Chain-of-Verification
// pass; Phase 01 wave-0 deleted the VITE_GEMINI_API_KEY path. This command is
// the request envelope that flows from CoVeWrapper.ts → AgriSyncClient.coveReverify
// → POST /shramsafal/ai/cove-reverify. The handler builds the CoVe prompt
// server-side, calls Gemini via the existing IAiProvider port, and returns a
// verificationScore plus a lowConfidence flag.

namespace ShramSafal.Application.UseCases.AI.CoVeReverify;

public sealed record CoVeReverifyCommand(
    Guid UserId,
    Guid FarmId,
    string Transcript,
    // Original structured parse, serialized as JSON. The handler does not
    // mutate it; it's part of the verification prompt input only.
    string ParsedJson,
    // Optional correlation id back to the source AiJob (the parse that
    // produced ParsedJson). Stamped on the AuditEvent.SourceAiJobId so the
    // verification row joins back to the parse it scored.
    Guid? SourceAiJobId,
    // Endpoint-sourced provenance (mirrors UpdateProviderConfigCommand pattern
    // from sub-phase 04.3b). Defaults keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string ActorRole = "Unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
