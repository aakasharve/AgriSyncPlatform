namespace ShramSafal.Infrastructure.Integrations.Gemini;

// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.9 (Safeguard S3 — Anti-Corruption
// Layer). This file is the frozen wire shape for every Gemini API
// integration adapter in this folder. The records here mirror the shape
// returned by Google's Generative Language REST API (best-effort: only
// the fields AgriSync actually consumes). Adapters convert these wire
// DTOs into canonical Application-layer DTOs (TranscribeResult /
// StructureResult / OcrResult) before returning to callers, so domain
// code never imports from this namespace.
//
// Adding a new field: add it here AND extend the adapter's mapping
// method. Never reference these records from domain or application
// projects.
//
// At Phase 2 Slice A, the existing GeminiAiProvider.cs does its JSON
// shaping inline via anonymous types on the request side and
// JsonDocument.TryGetProperty on the response side — no typed records
// were declared in the .cs body. The convention captured here is for
// the Phase 2.4 orchestrator rewrite which will introduce
// IStructurerProvider + IOcrProvider adapter classes; their typed wire
// shapes land in this file as they are written.
//
// Placeholder is intentional: Task 2.9 mandates the dedicated DTO file
// exists at this path so the ACL convention is visibly enforced for
// the next implementor.
//
// TODO(spec: SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.4): the
// orchestrator rewrite must replace this marker class with real typed
// wire records (e.g., GeminiGenerateContentRequest /
// GeminiGenerateContentResponse / GeminiCandidate) extracted from the
// current inline anonymous-type construction in GeminiAiProvider.cs.
// Tracked as a slice-A debt; logged in _COFOUNDER/memory/corrections.md.

/// <summary>
/// Reserved namespace marker. Wire-shape records for Gemini integration
/// adapters land here as the Phase 2 orchestrator rewrite progresses
/// (Tasks 2.3 onward). Domain code MUST NEVER reference this namespace.
/// </summary>
internal static class GeminiApiDtosMarker
{
    internal const string AclVersion = "phase-2-slice-a";
}
