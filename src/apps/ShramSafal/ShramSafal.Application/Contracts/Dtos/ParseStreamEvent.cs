namespace ShramSafal.Application.Contracts.Dtos;

// Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7) — SSE event payload streamed from
// /api/ai/parse-voice-stream. Type discriminator drives downstream rendering:
//   text            → raw model token (debug / future progressive prose)
//   field_complete  → a top-level AgriLogResponse field finished arriving
//   complete        → final balanced JSON document (Payload set)
//   error           → stream failure (Error set, terminal)
public sealed record ParseStreamEvent(
    string Type,
    string? Content = null,
    string? FieldPath = null,
    object? FieldValue = null,
    object? Payload = null,
    string? Error = null,
    string? PromptVersion = null,
    long? ModelMs = null);
